// Assets: each Side's cooldowns and the effects at work on the map. A Command calls one; the effect then works every
// tick until its time runs out. Each kind lives in its own module and joins KINDS (Supply Drop #39, Barrage #40).
// #101: a kind may take a second call while it works as a new spot for the same effect (`retask`: the Gunship's focus).
import type { Match } from '../index';
import { chord, inHq, insidePolygon, lineHits } from '../geometry';
import { gridRef } from '../grid-ref';
import type { Mix } from '../state';
import type { Soldier } from '../state';
import { enemyOf, SIDES, type AssetKind, type AssetView, type Command, type EffectView, type SideId, type SimEvent, type Tune, type Vec2 } from '../types';
import { barrage, type Shell } from './barrage';
import { beacon } from './beacon';
import { creep } from './creep';
import { drone } from './drone';
import { emp } from './emp';
import { feint } from './feint';
import { gunship } from './gunship';
import { missile } from './missile';
import { rapid } from './rapid';
import { recon } from './recon';
import { scan } from './scan';
import { smoke } from './smoke';
import { supply } from './supply';
import { live, sleep, type Vehicle } from '../vehicles';

/** One called Asset at work. `until` is the first tick it no longer works. */
export interface Effect {
  side: SideId;
  asset: AssetKind;
  x: number;
  y: number;
  until: number;
  told: boolean; // its "on effect" radio line went out
  shells?: Shell[]; // #40 Barrage, #138 Smoke Screen and Creeping Barrage
  to?: Vec2; // #138 a line-shaped Asset: the far end of its line, which starts at `x` and `y`
  from?: Vec2; // #99 Cruise Missile: where it was launched ... (#139: a drone's HQ; where the Recon Plane's pass starts, `to` where it ends)
  launch?: number; // ... on this tick ...
  land?: number; // ... and the tick it lands
  given?: Record<number, number>; // #74 Supply Drop: Commander Score points each Soldier (by id) drew from this crate
  open?: Record<number, number>; // #74 Supply Drop: of those, what the Console has not heard of yet
  vehicle?: number; // #101 Gunship: the id of the vehicle it flies ... (#139: a drone's, the Recon Plane's)
  phase?: 'inbound' | 'station' | 'leaving' | 'down'; // ... where it is in its sortie ... (#139: 'inbound' in flight, 'down' shot down)
  phaseAt?: number; // ... since this tick ...
  nextShot?: number; // ... the first tick its cannon may fire again ...
  prey?: number; // ... the id of the enemy it flies at (-1: at its focus, `x` and `y`) ...
  turn?: number; // ... which way it turned this tick: 1 left, -1 right, 0 straight on ...
  out?: boolean; // ... and whether it is flying out from a spot too close inside its turn, to come back round onto it
  found?: number[]; // #139 Recon Plane: the ids of the enemies it has revealed this pass (#143: an EMP Strike's, the enemy vehicles it holds)
  dummy?: number; // #143 Feint: its dummy's id as a shooter, after every Soldier's and vehicle's (crate.ts `dummyOf`)
}

export interface Assets {
  readyAt: Record<SideId, Partial<Record<AssetKind, number>>>; // first tick each Asset can be called
  effects: Effect[];
  dummies: number; // #143: Feint dummies dropped so far, both Sides: each one's id is the next after every vehicle's
}

export interface Kind {
  name: string;
  /** #99: the radio line at the call; `${name} inbound` when unset. */
  called?: string;
  /** #99: in the sky, so both Sides' views carry its effect (fog hides nothing up there). */
  sky?: boolean;
  /** #142: a thing on the ground the enemy's Soldiers can see: `side`'s view carries the enemy's effect while this says one does. */
  seen?(m: Match, e: Effect, side: SideId): boolean;
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
  view?(m: Match, e: Effect, own: boolean): Partial<EffectView>; // #138: `own` is false in the enemy's view of a `sky` kind
  hash?(e: Effect, mix: Mix): void;
  // #39: a kind that falls before it works says how long the fall has left and takes in all
  landsIn?(m: Match, e: Effect): number;
  fall?(t: Tune): number;
  /** #101: `side`'s effect of this kind that a call now moves rather than starting another (no cooldown, no gate), if there is one; with `at`, moves it there. */
  retask?(m: Match, side: SideId, at?: Vec2): Effect | undefined;
  /** #138: it is line-shaped: the call carries a second tap, and the effect a line this long from the first towards it. #139: `across`: the line runs through the first tap right across the Play Area and `beyond` metres past each edge (the effect's `from` and `to`). */
  line?(t: Tune): NonNullable<AssetView['line']>;
  /**
   * #142: it is untargeted (Rapid Deploy): called with no spot, so the Play Area and HQ checks don't apply. Its effect has no place:
   * `x` and `y` stay 0 and nothing reads them, it has no view entry (the row carries `up`), and its radio lines name no grid.
   */
  untargeted?: true;
}

const KINDS: Partial<Record<AssetKind, Kind>> = { scan, supply, barrage, missile, gunship, smoke, creep, drone, recon, beacon, rapid, emp, feint };
const ORDER: AssetKind[] = ['scan', 'supply', 'barrage', 'missile', 'gunship', 'smoke', 'creep', 'drone', 'recon', 'beacon', 'rapid', 'emp', 'feint'];
const kinds = () => ORDER.filter((k) => KINDS[k]);

export function newAssets(t: Tune): Assets {
  const ready = () => Object.fromEntries(kinds().map((k) => [k, Math.round((KINDS[k]!.firstReadySeconds?.(t) ?? 0) * t.hz)]));
  return { readyAt: { nato: ready(), pact: ready() }, effects: [], dummies: 0 };
}

/** A radio line on the Asset net, located at the effect's spot (#142: an untargeted Asset's has none). */
export function assetRadio(m: Match, e: Effect, text: string, events: SimEvent[]) {
  const grid = !KINDS[e.asset]!.untargeted && m.map.grid && gridRef(m.map.grid, e);
  events.push({ kind: 'radio', side: e.side, squad: null, type: 'asset', text, ...(grid && { grid }), priority: 1 });
}

/** #139: `side` has `asset` at work: its one aircraft is out (or its last moments still show), so the next call waits. */
export const inTheAir = (m: Match, side: SideId, asset: 'drone' | 'recon') => (m.assets.effects.some((e) => e.asset === asset && e.side === side) ? 'in the air' : null);

/**
 * #139: whether the enemy AA has shot down `v`, the aircraft `e` flies (vehicles.ts `hurt`). If so it sleeps where it fell, the
 * effect is 'down' and stays `barrageContactSeconds` more for the Console to show the fall, and the radio says `line`.
 */
export function shotDown(m: Match, e: Effect, v: Vehicle, line: string, events: SimEvent[]): boolean {
  if (live(v)) return false;
  sleep(v);
  Object.assign(e, { phase: 'down', phaseAt: m.tick, until: m.tick + Math.round(m.tune.barrageContactSeconds * m.tune.hz) });
  assetRadio(m, e, line, events);
  return true;
}

/** Why the Asset can't be called, or null. */
export function checkCall(m: Match, c: Extract<Command, { kind: 'asset' }>): string | null {
  if (!KINDS[c.asset]) return 'not available';
  if (!KINDS[c.asset]!.retask?.(m, c.side)) {
    if (m.tick < m.assets.readyAt[c.side][c.asset]!) return 'cooling down';
    const off = KINDS[c.asset]!.gate?.(m, c.side);
    if (off) return off;
  }
  if (KINDS[c.asset]!.untargeted) return null; // #142: anywhere, as it acts on no place
  const at = c.at;
  if (!at) return 'needs a spot';
  if (!insidePolygon(m.map.playArea, at.x, at.y)) return 'outside the Play Area';
  if (inHq(m, enemyOf(c.side), at)) return 'on the enemy HQ';
  const line = KINDS[c.asset]!.line?.(m.tune);
  if (!line) return null;
  const to = lineOf(m, c, at)?.to;
  if (!to) return 'needs a direction';
  if (line.across) return null; // #139: it only flies over
  if (!insidePolygon(m.map.playArea, to.x, to.y)) return 'outside the Play Area';
  return lineHits(m.map.hqs[enemyOf(c.side)], m.tune.hqRadius, at, to) ? 'on the enemy HQ' : null;
}

/** #138: a line-shaped Asset's line: its length from `at` towards `to` (#139: or right across the Play Area through `at`); null with no second tap, or one on the first. */
function lineOf(m: Match, c: Extract<Command, { kind: 'asset' }>, at: Vec2): { from: Vec2; to: Vec2 } | null {
  const dx = (c.to?.x ?? at.x) - at.x;
  const dy = (c.to?.y ?? at.y) - at.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!d) return null;
  const line = KINDS[c.asset]!.line!(m.tune);
  return line.across ? chord(m.map.playArea, at, dx / d, dy / d, line.beyond) : { from: at, to: { x: at.x + (dx / d) * line.length, y: at.y + (dy / d) * line.length } };
}

/** Starts the cooldown and puts the effect to work from this tick. */
export function call(m: Match, c: Extract<Command, { kind: 'asset' }>, events: SimEvent[]) {
  const kind = KINDS[c.asset]!;
  const t = m.tune;
  const at = kind.untargeted ? { x: 0, y: 0 } : c.at!; // checkCall let it through; #142: an untargeted Asset's effect has no place
  const up = kind.retask?.(m, c.side, at);
  if (up) return assetRadio(m, up, `${kind.name} retasked`, events);
  m.assets.readyAt[c.side][c.asset] = m.tick + Math.round(kind.cooldownSeconds(t) * t.hz);
  const e: Effect = { side: c.side, asset: c.asset, x: at.x, y: at.y, until: m.tick + Math.round(kind.seconds(t) * t.hz), told: false };
  const line = kind.line && lineOf(m, c, at)!;
  if (line) Object.assign(e, { to: line.to, ...(kind.line!(t).across && { from: line.from }) });
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
    const line = KINDS[k]!.line?.(t);
    const untargeted = KINDS[k]!.untargeted;
    const fx = untargeted && m.assets.effects.find((e) => e.asset === k && e.side === side);
    return {
      asset: k,
      readyIn: Math.max(0, m.assets.readyAt[side][k]! - m.tick) / t.hz,
      cooldown: KINDS[k]!.cooldownSeconds(t),
      radius: KINDS[k]!.radius(t),
      ...(off && { off }),
      ...(retask && { retask }),
      ...(line && { line }),
      ...(untargeted && { untargeted }),
      ...(fx && { up: { left: (fx.until - m.tick) / t.hz, total: KINDS[k]!.seconds(t) } }),
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
    .filter((e) => !KINDS[e.asset]!.untargeted && (e.side === side || KINDS[e.asset]!.sky || KINDS[e.asset]!.seen?.(m, e, side)))
    .map((e) => ({ asset: e.asset, x: e.x, y: e.y, radius: KINDS[e.asset]!.radius(t), left: (e.until - m.tick) / t.hz, total: KINDS[e.asset]!.seconds(t), ...fallView(m, e), ...KINDS[e.asset]!.view?.(m, e, e.side === side) }));
}

export function hashAssets(m: Match, mix: Mix) {
  for (const side of SIDES) for (const k of kinds()) mix(m.assets.readyAt[side][k]!);
  mix(m.assets.dummies); // #143
  mix(m.assets.effects.length);
  for (const e of m.assets.effects) {
    mix(SIDES.indexOf(e.side));
    mix(ORDER.indexOf(e.asset));
    mix(Math.round(e.x * 1000));
    mix(Math.round(e.y * 1000));
    mix(e.until);
    mix(e.told ? 1 : 0);
    for (const v of e.to ? [e.to.x, e.to.y] : []) mix(Math.round(v * 1000));
    KINDS[e.asset]!.hash?.(e, mix);
  }
}
