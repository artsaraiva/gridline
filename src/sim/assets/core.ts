// Assets: each Side's cooldowns and the effects at work on the map. A Command calls one; the effect then works every
// tick until its time runs out. Each kind lives in its own module and joins the Kind table (Supply Drop #39, Barrage #40).
// #101: a kind may take a second call while it works as a new spot for the same effect (`retask`: the Gunship's focus).
import type { Match } from '../index';
import { chord, inHq, insidePolygon, lineHits } from '../geometry';
import { provideContacts } from '../contacts';
import { gridRef } from '../grid-ref';
import type { Mix } from '../state';
import type { Soldier } from '../state';
import { ASSET_KINDS, enemyOf, SIDES, type AssetKind, type AssetView, type Command, type EffectView, type RequestKind, type SideId, type SimEvent, type Tune, type Vec2 } from '../types';
import { barrage, type BarrageEffect, type Shell } from './barrage';
import { beacon, type BeaconEffect } from './beacon';
import { creep, type CreepEffect } from './creep';
import { drone, type DroneEffect } from './drone';
import { emp, type EmpEffect } from './emp';
import { feint, type FeintEffect } from './feint';
import { gunship, type GunshipEffect } from './gunship';
import { missile, type MissileEffect } from './missile';
import { rapid, type RapidEffect } from './rapid';
import { recon, type ReconEffect } from './recon';
import { scan, type ScanEffect } from './scan';
import { smoke, type SmokeEffect } from './smoke';
import { supply, type SupplyEffect } from './supply';
import { lost, release, type Vehicle } from '../vehicles';
import { effectsOf } from './lookup';

/** One called Asset at work: what every kind's effect has. `until` is the first tick it no longer works. #182: each kind's own fields are declared in its adapter. */
export interface EffectBase {
  side: SideId;
  asset: AssetKind;
  x: number;
  y: number;
  until: number;
  told: boolean; // its "on effect" radio line went out
}

// #182: the pieces several kinds' effects share
/** #40 Barrage: its shells, in the air and landed (#138: the Smoke Screen's and the Creeping Barrage's; #101: the Gunship's). */
export interface Shells {
  shells: Shell[];
}
/** #138: a line-shaped Asset: the far end of its line, which starts at `x` and `y` (#139: where the Recon Plane's pass ends). */
export interface Line {
  to: Vec2;
}
/** #99 Cruise Missile: where it was launched, on which tick, and the tick it lands (#139: a drone's HQ, where the Recon Plane's pass starts and the tick it ends; #143: the EMP Strike's HQ). */
export interface Flight {
  from: Vec2;
  launch: number;
  land: number;
}
/** #101: an Asset flying its Side's lent aircraft (vehicles/lent.ts): the vehicle's id, where it is in its sortie and since which tick (#139: a drone's, the Recon Plane's: 'inbound' in flight, 'down' shot down). */
export interface Aircraft<P extends string> {
  vehicle: number;
  phase: P;
  phaseAt: number;
}
/** #138: the line a call drew: a line-shaped Asset's, from its first tap (#139: across: from beyond the Play Area's edge) to its far end. */
export interface Drawn {
  from: Vec2;
  to: Vec2;
}

export type Effect = ScanEffect | SupplyEffect | BarrageEffect | MissileEffect | GunshipEffect | SmokeEffect | CreepEffect | DroneEffect | ReconEffect | BeaconEffect | RapidEffect | EmpEffect | FeintEffect;
export type EffectOf<K extends AssetKind> = Extract<Effect, { asset: K }>;

export interface Assets {
  readyAt: Record<SideId, Record<AssetKind, number>>; // first tick each Asset can be called
  effects: Effect[];
  dummies: number; // #143: Feint dummies dropped so far, both Sides: each one's id is the next after every vehicle's
}

/** One Asset kind's rules, over its own effect `E` (#182). */
export interface Kind<E extends Effect> {
  name: string;
  /** #99: the radio line at the call; `${name} inbound` when unset. */
  called?: string;
  /** #99: in the sky, so both Sides' views carry its effect (fog hides nothing up there). */
  sky?: boolean;
  /** #142: a thing on the ground the enemy's Soldiers can see: `side`'s view carries the enemy's effect while this says one does. */
  seen?(m: Match, e: E, side: SideId): boolean;
  cooldownSeconds(t: Tune): number;
  seconds(t: Tune): number; // how long the effect works
  radius(t: Tune): number;
  /** Runs once a tick while the effect works. */
  work(m: Match, e: E, events: SimEvent[]): void;
  /** #99: why `side` can't call it right now (the row shows it), or null; the cooldown runs regardless. */
  gate?(m: Match, side: SideId): string | null;
  /** #40: ready this long after the match starts, rather than at once. */
  firstReadySeconds?(t: Tune): number;
  /**
   * #40: runs once as the Asset is called and returns its effect, built on `base` (seeded draws go here). #182: `line` is the line
   * the call drew, for a line-shaped kind; any other is given its spot at both ends, and has no use for it.
   */
  start(m: Match, base: EffectBase, line: Drawn): E;
  /** #142: one a Side: a call takes its Side's effect of this kind off the map before it starts the new one (the Redeploy Beacon). */
  replaces?: true;
  /** #40: enemies of the caller the effect shows as Contacts for as long as it lasts. */
  contacts?(m: Match, e: E): Soldier[];
  /** #40: extra fields for the effect's view. */
  view?(m: Match, e: E, own: boolean): Partial<EffectView>; // #138: `own` is false in the enemy's view of a `sky` kind
  /** Mixes its own fields into the state hash, after the ones every effect has. */
  hash?(e: E, mix: Mix): void;
  // #39: a kind that falls before it works says how long the fall has left and takes in all
  landsIn?(m: Match, e: E): number;
  fall?(t: Tune): number;
  /**
   * #41: it answers a Squad's `request` (requests.ts): `at` is where it does right now, a Request near that spot closes, or null
   * while it does not yet (#139: or no more). #182: in place of requests.ts's table and its switch on the kind.
   */
  answers?: { request: RequestKind; at(m: Match, e: E): Vec2 | null };
  /** #101: `side`'s effect of this kind that a call now moves rather than starting another (no cooldown, no gate), if there is one; with `at`, moves it there. */
  retask?(m: Match, side: SideId, at?: Vec2): E | undefined;
  /** #138: it is line-shaped: the call carries a second tap, and the effect a line this long from the first towards it. #139: `across`: the line runs through the first tap right across the Play Area and `beyond` metres past each edge (the effect's `from` and `to`). */
  line?(t: Tune): NonNullable<AssetView['line']>;
  /**
   * #142: it is untargeted (Rapid Deploy): called with no spot, so the Play Area and HQ checks don't apply. Its effect has no place:
   * `x` and `y` stay 0 and nothing reads them, it has no view entry (the row carries `up`), and its radio lines name no grid.
   */
  untargeted?: true;
}

/**
 * #182: the adapter of every kind in ASSET_KINDS (total: a kind with none fails the typecheck). Built on first use, not at module
 * load: the adapters import this module, and built mid-cycle the table would read them before they exist (`413935c`).
 */
let built: { [K in AssetKind]: Kind<EffectOf<K>> } | undefined;
const kinds = () => (built ??= { scan, supply, barrage, missile, gunship, smoke, creep, drone, recon, beacon, rapid, emp, feint });
/** The one cast: TypeScript cannot tie `e.asset` to its Kind (a correlated union). */
const kindOf = <E extends Effect>(e: E) => kinds()[e.asset] as unknown as Kind<E>;

export function newAssets(t: Tune): Assets {
  const ready = () => Object.fromEntries(ASSET_KINDS.map((k) => [k, Math.round((kinds()[k].firstReadySeconds?.(t) ?? 0) * t.hz)])) as Record<AssetKind, number>;
  return { readyAt: { nato: ready(), pact: ready() }, effects: [], dummies: 0 };
}

/** A radio line on the Asset net, located at the effect's spot (#142: an untargeted Asset's has none). */
export function assetRadio(m: Match, e: EffectBase, text: string, events: SimEvent[]) {
  const grid = !kinds()[e.asset].untargeted && m.map.grid && gridRef(m.map.grid, e);
  events.push({ kind: 'radio', side: e.side, squad: null, type: 'asset', text, ...(grid && { grid }), priority: 1 });
}

/** #139: `side` has `asset` at work: its one aircraft is out (or its last moments still show), so the next call waits. */
export const inTheAir = (m: Match, side: SideId, asset: 'drone' | 'recon') => (effectsOf(m, asset, side).length ? 'in the air' : null);

/**
 * #139: whether the enemy AA has shot down `v`, the aircraft `e` flies (vehicles/core.ts `hurt`). If so it sleeps where it fell, the
 * effect is 'down' and stays `barrageContactSeconds` more for the Console to show the fall, and the radio says `line`.
 */
export function shotDown(m: Match, e: EffectBase & Aircraft<'inbound' | 'down'>, v: Vehicle, line: string, events: SimEvent[]): boolean {
  if (!lost(v)) return false;
  release(v);
  e.phase = 'down';
  e.phaseAt = m.tick;
  e.until = m.tick + Math.round(m.tune.barrageContactSeconds * m.tune.hz);
  assetRadio(m, e, line, events);
  return true;
}

/** Why the Asset can't be called, or null. */
export function checkCall(m: Match, c: Extract<Command, { kind: 'asset' }>): string | null {
  if (!(ASSET_KINDS as readonly string[]).includes(c.asset)) return 'not available'; // a Command crosses the worker's message boundary, so its type is a claim
  if (!kinds()[c.asset].retask?.(m, c.side)) {
    if (m.tick < m.assets.readyAt[c.side][c.asset]) return 'cooling down';
    const off = kinds()[c.asset].gate?.(m, c.side);
    if (off) return off;
  }
  if (kinds()[c.asset].untargeted) return null; // #142: anywhere, as it acts on no place
  const at = c.at;
  if (!at) return 'needs a spot';
  if (!insidePolygon(m.map.playArea, at.x, at.y)) return 'outside the Play Area';
  if (inHq(m, enemyOf(c.side), at)) return 'on the enemy HQ';
  const line = kinds()[c.asset].line?.(m.tune);
  if (!line) return null;
  const to = lineOf(m, c, at)?.to;
  if (!to) return 'needs a direction';
  if (line.across) return null; // #139: it only flies over
  if (!insidePolygon(m.map.playArea, to.x, to.y)) return 'outside the Play Area';
  return lineHits(m.map.hqs[enemyOf(c.side)], m.tune.hqRadius, at, to) ? 'on the enemy HQ' : null;
}

/** #138: a line-shaped Asset's line: its length from `at` towards `to` (#139: or right across the Play Area through `at`); null with no second tap, or one on the first. */
function lineOf(m: Match, c: Extract<Command, { kind: 'asset' }>, at: Vec2): Drawn | null {
  const dx = (c.to?.x ?? at.x) - at.x;
  const dy = (c.to?.y ?? at.y) - at.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!d) return null;
  const line = kinds()[c.asset].line!(m.tune);
  return line.across ? chord(m.map.playArea, at, dx / d, dy / d, line.beyond) : { from: at, to: { x: at.x + (dx / d) * line.length, y: at.y + (dy / d) * line.length } };
}

/** Starts the cooldown and puts the effect to work from this tick. */
export function call(m: Match, c: Extract<Command, { kind: 'asset' }>, events: SimEvent[]) {
  const kind = kinds()[c.asset];
  const t = m.tune;
  const at = kind.untargeted ? { x: 0, y: 0 } : c.at!; // checkCall let it through; #142: an untargeted Asset's effect has no place
  const up = kind.retask?.(m, c.side, at);
  if (up) return assetRadio(m, up, `${kind.name} retasked`, events);
  m.assets.readyAt[c.side][c.asset] = m.tick + Math.round(kind.cooldownSeconds(t) * t.hz);
  const base: EffectBase = { side: c.side, asset: c.asset, x: at.x, y: at.y, until: m.tick + Math.round(kind.seconds(t) * t.hz), told: false };
  const line = kind.line ? lineOf(m, c, at)! : { from: at, to: at }; // checkCall let a line-shaped Asset through with its second tap
  if (kind.replaces) m.assets.effects = m.assets.effects.filter((o) => o.asset !== c.asset || o.side !== c.side);
  const e = kind.start(m, base, line);
  m.assets.effects.push(e);
  assetRadio(m, e, kind.called ?? `${kind.name} inbound`, events);
}

/** The Asset phase: every effect works, then the ones whose time is up go. */
export function assetEffects(m: Match, events: SimEvent[]) {
  for (const e of m.assets.effects) kindOf(e).work(m, e, events);
  m.assets.effects = m.assets.effects.filter((e) => e.until > m.tick + 1);
}

/** #41: where `side`'s Assets answer a `request` Request right now (requests.ts closes one near any of them). */
export function answering(m: Match, side: SideId, request: RequestKind): Vec2[] {
  const out: Vec2[] = [];
  for (const e of m.assets.effects) {
    const a = kindOf(e).answers;
    const at = e.side === side && a?.request === request ? a.at(m, e) : null;
    if (at) out.push(at);
  }
  return out;
}

/** Enemies of `side` its Assets show as Contacts right now. */
export function assetContacts(m: Match, side: SideId): Soldier[] {
  return m.assets.effects.filter((e) => e.side === side).flatMap((e) => kindOf(e).contacts?.(m, e) ?? []);
}
provideContacts(assetContacts); // #183: for the rules that aim at them without importing the Assets (contacts.ts)

export function assetViews(m: Match, side: SideId): AssetView[] {
  const t = m.tune;
  return ASSET_KINDS.map((k) => {
    const retask = !!kinds()[k].retask?.(m, side);
    const off = !retask && kinds()[k].gate?.(m, side);
    const line = kinds()[k].line?.(t);
    const untargeted = kinds()[k].untargeted;
    const fx = untargeted && effectsOf(m, k, side)[0];
    return {
      asset: k,
      readyIn: Math.max(0, m.assets.readyAt[side][k] - m.tick) / t.hz,
      cooldown: kinds()[k].cooldownSeconds(t),
      radius: kinds()[k].radius(t),
      ...(off && { off }),
      ...(retask && { retask }),
      ...(line && { line }),
      ...(untargeted && { untargeted }),
      ...(fx && { up: { left: (fx.until - m.tick) / t.hz, total: kinds()[k].seconds(t) } }),
    };
  });
}

const fallView = (m: Match, e: Effect) => {
  const k = kindOf(e);
  return k.landsIn && k.fall ? { landsIn: k.landsIn(m, e), fall: k.fall(m.tune) } : {};
};

export function effectViews(m: Match, side: SideId): EffectView[] {
  const t = m.tune;
  return m.assets.effects
    .filter((e) => !kindOf(e).untargeted && (e.side === side || kindOf(e).sky || kindOf(e).seen?.(m, e, side)))
    .map((e) => ({ asset: e.asset, x: e.x, y: e.y, radius: kindOf(e).radius(t), left: (e.until - m.tick) / t.hz, total: kindOf(e).seconds(t), ...fallView(m, e), ...kindOf(e).view?.(m, e, e.side === side) }));
}

export function hashAssets(m: Match, mix: Mix) {
  for (const side of SIDES) for (const k of ASSET_KINDS) mix(m.assets.readyAt[side][k]);
  mix(m.assets.dummies); // #143
  mix(m.assets.effects.length);
  for (const e of m.assets.effects) {
    mix(SIDES.indexOf(e.side));
    mix(ASSET_KINDS.indexOf(e.asset));
    mix(Math.round(e.x * 1000));
    mix(Math.round(e.y * 1000));
    mix(e.until);
    mix(e.told ? 1 : 0);
    kindOf(e).hash?.(e, mix);
  }
}

/** #138: a line-shaped Asset's far end, first in its kind's hash (where the core mixed it before #182). */
export function hashLine(e: Line, mix: Mix) {
  for (const v of [e.to.x, e.to.y]) mix(Math.round(v * 1000));
}
