// Assets: each Side's cooldowns and the effects at work on the map. A Command calls one; the effect then works every
// tick until its time runs out. Each kind lives in its own module and joins KINDS (Supply Drop #39, Barrage #40).
import type { Match } from '../index';
import { inHq, insidePolygon } from '../geometry';
import { gridRef } from '../grid-ref';
import type { Mix } from '../state';
import type { Soldier } from '../state';
import { enemyOf, SIDES, type AssetKind, type AssetView, type Command, type EffectView, type SideId, type SimEvent, type Tune, type Vec2 } from '../types';
import { barrage, type Shell } from './barrage';
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
  given?: Record<number, number>; // #74 Supply Drop: Commander Score points each Soldier (by id) drew from this crate
  open?: Record<number, number>; // #74 Supply Drop: of those, what the Console has not heard of yet
}

export interface Assets {
  readyAt: Record<SideId, Partial<Record<AssetKind, number>>>; // first tick each Asset can be called
  effects: Effect[];
}

export interface Kind {
  name: string;
  cooldownSeconds(t: Tune): number;
  seconds(t: Tune): number; // how long the effect works
  radius(t: Tune): number;
  /** Runs once a tick while the effect works. */
  work(m: Match, e: Effect, events: SimEvent[]): void;
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
}

const KINDS: Partial<Record<AssetKind, Kind>> = { scan, supply, barrage };
const ORDER: AssetKind[] = ['scan', 'supply', 'barrage'];
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
  if (m.tick < m.assets.readyAt[c.side][c.asset]!) return 'cooling down';
  if (!insidePolygon(m.map.playArea, c.at.x, c.at.y)) return 'outside the Play Area';
  if (inHq(m, enemyOf(c.side), c.at)) return 'on the enemy HQ';
  return null;
}

/** Starts the cooldown and puts the effect to work from this tick. */
export function call(m: Match, c: Extract<Command, { kind: 'asset' }>, events: SimEvent[]) {
  const kind = KINDS[c.asset]!;
  const t = m.tune;
  m.assets.readyAt[c.side][c.asset] = m.tick + Math.round(kind.cooldownSeconds(t) * t.hz);
  const e: Effect = { side: c.side, asset: c.asset, x: c.at.x, y: c.at.y, until: m.tick + Math.round(kind.seconds(t) * t.hz), told: false };
  kind.start?.(m, e);
  m.assets.effects.push(e);
  assetRadio(m, e, `${kind.name} inbound`, events);
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
  return kinds().map((k) => ({
    asset: k,
    readyIn: Math.max(0, m.assets.readyAt[side][k]! - m.tick) / t.hz,
    cooldown: KINDS[k]!.cooldownSeconds(t),
    radius: KINDS[k]!.radius(t),
  }));
}

const fallView = (m: Match, e: Effect) => {
  const k = KINDS[e.asset]!;
  return k.landsIn && k.fall ? { landsIn: k.landsIn(m, e), fall: k.fall(m.tune) } : {};
};

export function effectViews(m: Match, side: SideId): EffectView[] {
  const t = m.tune;
  return m.assets.effects
    .filter((e) => e.side === side)
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
