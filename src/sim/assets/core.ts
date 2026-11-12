// Assets: each Side's cooldowns and the effects at work on the map. A Command calls one; the effect then works every
// tick until its time runs out. Each kind lives in its own module and joins KINDS (Supply Drop #39, Barrage #40).
// #101: a kind may take a second call while it works as a new spot for the same effect (`retask`: the Gunship's focus).
import type { Match } from '../index';
import { inHq, insidePolygon } from '../geometry';
import { gridRef } from '../grid-ref';
import type { Mix } from '../state';
import type { Soldier } from '../state';
import { enemyOf, SIDES, type AssetKind, type AssetView, type Command, type EffectView, type SideId, type SimEvent, type Tune, type Vec2 } from '../types';
import { barrage, type Shell } from './barrage';
import { gunship } from './gunship';
import { missile } from './missile';
import { scan } from './scan';
import { supply } from './supply';

/** One called Asset at work. `until` is the first tick it no longer works. */
export interface Effect {
  side: SideId;
  asset: AssetKind;
  x: number;
  y: number;
  until: number;
  told: boolean; // its "on effect" radio line went out
  shells?: Shell[]; // #40 Barrage
  from?: Vec2; // #99 Cruise Missile: where it was launched ...
  launch?: number; // ... on this tick ...
  land?: number; // ... and the tick it lands
  given?: Record<number, number>; // #74 Supply Drop: Commander Score points each Soldier (by id) drew from this crate
  open?: Record<number, number>; // #74 Supply Drop: of those, what the Console has not heard of yet
  vehicle?: number; // #101 Gunship: the id of the vehicle it flies ...
  phase?: 'inbound' | 'station' | 'leaving' | 'down'; // ... where it is in its sortie ...
  phaseAt?: number; // ... since this tick ...
  nextShot?: number; // ... the first tick its cannon may fire again ...
  prey?: number; // ... the id of the enemy it flies at (-1: at its focus, `x` and `y`) ...
  turn?: number; // ... which way it turned this tick: 1 left, -1 right, 0 straight on ...
  out?: boolean; // ... and whether it is flying out from a spot too close inside its turn, to come back round onto it
}

export interface Assets {
  readyAt: Record<SideId, Partial<Record<AssetKind, number>>>; // first tick each Asset can be called
  effects: Effect[];
}

export interface Kind {
  name: string;
  /** #99: the radio line at the call; `${name} inbound` when unset. */
  called?: string;
  /** #99: in the sky, so both Sides' views carry its effect (fog hides nothing up there). */
  sky?: boolean;
  cooldownSeconds(t: Tune): number;
  seconds(t: Tune): number; // how long the effect works
  radius(t: Tune): number;
  /** Runs once a tick while the effect works. */
  work(m: Match, e: Effect, events: SimEvent[]): void;
  /** #99: why `side` can't call it right now (the row shows it), or null; the cooldown runs regardless. */
  gate?(m: Match, side: SideId): string | null;
  /** #40: ready this long after the match starts, rather than at once. */
  firstReadySeconds?(t: Tune): number;
  /** #40: runs once as the Asset is called, to set up the effect (seeded draws go here). */
  start?(m: Match, e: Effect): void;
  /** #40: enemies of the caller the effect shows as Contacts for as long as it lasts. */
  contacts?(m: Match, e: Effect): Soldier[];
  /** #40: extra fields for the effect's view. */
  view?(m: Match, e: Effect): Partial<EffectView>;
  hash?(e: Effect, mix: Mix): void;
  // #39: a kind that falls before it works says how long the fall has left and takes in all
  landsIn?(m: Match, e: Effect): number;
  fall?(t: Tune): number;
  /** #101: `side`'s effect of this kind that a call now moves rather than starting another (no cooldown, no gate), if there is one; with `at`, moves it there. */
  retask?(m: Match, side: SideId, at?: Vec2): Effect | undefined;
}

const KINDS: Partial<Record<AssetKind, Kind>> = { scan, supply, barrage, missile, gunship };
const ORDER: AssetKind[] = ['scan', 'supply', 'barrage', 'missile', 'gunship'];
const kinds = () => ORDER.filter((k) => KINDS[k]);

export function newAssets(t: Tune): Assets {
  const ready = () => Object.fromEntries(kinds().map((k) => [k, Math.round((KINDS[k]!.firstReadySeconds?.(t) ?? 0) * t.hz)]));
  return { readyAt: { nato: ready(), pact: ready() }, effects: [] };
}

/** A radio line on the Asset net, located at the effect's spot. */
export function assetRadio(m: Match, e: Effect, text: string, events: SimEvent[]) {
  const grid = m.map.grid && gridRef(m.map.grid, e);
  events.push({ kind: 'radio', side: e.side, squad: null, type: 'asset', text, ...(grid && { grid }), priority: 1 });
}

/** Why the Asset can't be called, or null. */
export function checkCall(m: Match, c: Extract<Command, { kind: 'asset' }>): string | null {
  if (!KINDS[c.asset]) return 'not available';
  if (!KINDS[c.asset]!.retask?.(m, c.side)) {
    if (m.tick < m.assets.readyAt[c.side][c.asset]!) return 'cooling down';
    const off = KINDS[c.asset]!.gate?.(m, c.side);
    if (off) return off;
  }
  if (!insidePolygon(m.map.playArea, c.at.x, c.at.y)) return 'outside the Play Area';
  if (inHq(m, enemyOf(c.side), c.at)) return 'on the enemy HQ';
  return null;
}

/** Starts the cooldown and puts the effect to work from this tick. */
export function call(m: Match, c: Extract<Command, { kind: 'asset' }>, events: SimEvent[]) {
  const kind = KINDS[c.asset]!;
  const t = m.tune;
  const up = kind.retask?.(m, c.side, c.at);
  if (up) return assetRadio(m, up, `${kind.name} retasked`, events);
  m.assets.readyAt[c.side][c.asset] = m.tick + Math.round(kind.cooldownSeconds(t) * t.hz);
  const e: Effect = { side: c.side, asset: c.asset, x: c.at.x, y: c.at.y, until: m.tick + Math.round(kind.seconds(t) * t.hz), told: false };
  kind.start?.(m, e);
  m.assets.effects.push(e);
  assetRadio(m, e, kind.called ?? `${kind.name} inbound`, events);
}

/** The Asset phase: every effect works, then the ones whose time is up go. */
export function assetEffects(m: Match, events: SimEvent[]) {
  for (const e of m.assets.effects) KINDS[e.asset]!.work(m, e, events);
  m.assets.effects = m.assets.effects.filter((e) => e.until > m.tick + 1);
}

/** Enemies of `side` its Assets show as Contacts right now. */
export function assetContacts(m: Match, side: SideId): Soldier[] {
  return m.assets.effects.filter((e) => e.side === side).flatMap((e) => KINDS[e.asset]!.contacts?.(m, e) ?? []);
}

export function assetViews(m: Match, side: SideId): AssetView[] {
  const t = m.tune;
  return kinds().map((k) => {
    const retask = !!KINDS[k]!.retask?.(m, side);
    const off = !retask && KINDS[k]!.gate?.(m, side);
    return {
      asset: k,
      readyIn: Math.max(0, m.assets.readyAt[side][k]! - m.tick) / t.hz,
      cooldown: KINDS[k]!.cooldownSeconds(t),
      radius: KINDS[k]!.radius(t),
      ...(off && { off }),
      ...(retask && { retask }),
    };
  });
}

const fallView = (m: Match, e: Effect) => {
  const k = KINDS[e.asset]!;
  return k.landsIn && k.fall ? { landsIn: k.landsIn(m, e), fall: k.fall(m.tune) } : {};
};

export function effectViews(m: Match, side: SideId): EffectView[] {
  const t = m.tune;
  return m.assets.effects
    .filter((e) => e.side === side || KINDS[e.asset]!.sky)
    .map((e) => ({ asset: e.asset, x: e.x, y: e.y, radius: KINDS[e.asset]!.radius(t), left: (e.until - m.tick) / t.hz, total: KINDS[e.asset]!.seconds(t), ...fallView(m, e), ...KINDS[e.asset]!.view?.(m, e) }));
}

export function hashAssets(m: Match, mix: Mix) {
  for (const side of SIDES) for (const k of kinds()) mix(m.assets.readyAt[side][k]!);
  mix(m.assets.effects.length);
  for (const e of m.assets.effects) {
    mix(SIDES.indexOf(e.side));
    mix(ORDER.indexOf(e.asset));
    mix(Math.round(e.x * 1000));
    mix(Math.round(e.y * 1000));
    mix(e.until);
    mix(e.told ? 1 : 0);
    KINDS[e.asset]!.hash?.(e, mix);
  }
}
