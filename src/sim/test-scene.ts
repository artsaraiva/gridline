// #183: the shared test scene, beside test-tune.ts. A field map (`field`), a Match on it with every Vehicle kind off unless the test
// turns it on (`scene`), Soldiers placed as a map script would place them, and crewed vehicles seated by the rules' own way in
// (`crew`, through `mount`), so that no test writes a vehicle's seats. Tests read what a Commander sees (`viewOf`, `play`) and the
// events; a kind's decisions the view does not show are read at its module's interface.
import { expect } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import type { Soldier } from './state';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SideId, SimEvent, Tune, Vec2, VehicleKind, VehicleView } from './types';
import { mount, type Vehicle, type VehicleOf } from './vehicles';
import { startCrew } from './vehicles/seats';

/** A square Play Area `half` metres out each way from the centre. */
export const square = (half: number): Vec2[] => [
  { x: -half, y: -half },
  { x: half, y: -half },
  { x: half, y: half },
  { x: -half, y: half },
];

/** Open ground 1200 m across, the HQs far out on the flanks (nato west, pact east), no Capture Points; `extra` overrides any of it. */
export const field = (extra: Partial<MapData> = {}): MapData => ({ name: 'field', playArea: square(600), hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } }, points: [], ...extra });

/** Every Vehicle kind off: a test turns on the ones it is about. */
export const NO_VEHICLES: Partial<Tune> = { tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false };

/** Where a map script puts a Soldier. */
type Placed = Partial<Pick<Soldier, 'x' | 'y' | 'fx' | 'fy' | 'speed' | 'hp'>>;

/**
 * A test Match on `map` (`field`'s, with what it gives): `squads` Squads a Side of two (Soldier ids run nato first, Squad by Squad;
 * the vehicles' follow), nobody jittered or straying, no Ticket drain, Traits and tempo off (test-tune.ts) and every Vehicle kind
 * off; `tune` on top. `place` moves Soldiers as a map script would.
 */
export function scene(o: { map?: Partial<MapData>; tune?: Partial<Tune>; squads?: number; seed?: number; place?: Record<number, Placed> } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 2, speedJitter: 0, spread: 0, strayChance: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], ...NO_VEHICLES, ...NO_TRAITS, ...NO_TEMPO, ...o.tune };
  const m = thinkOnId(createMatch({ seed: o.seed ?? 1, map: field(o.map), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' }));
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** `side`'s `n`th vehicle of `kind`. */
export const vehicle = <K extends VehicleKind>(m: Match, kind: K, side: SideId = 'nato', n = 0): VehicleOf<K> =>
  m.vehicles.filter((v): v is VehicleOf<K> => v.kind === kind && v.side === side)[n]!;

/**
 * Seats Soldiers `ids` in `v`, in order, through `mount`, as Soldiers climbing in would: a ground vehicle's driver first, then
 * its gunner and riders; a helicopter's riders its passenger seats first. `[id, seat]` is crew for `seat` (#129 a helicopter's
 * pilot or a gun, #101 the Gunship's gun), its stint starting now. `at`: where `v` stands first (a map script's spot), its riders
 * with it.
 */
export function crew<V extends Vehicle>(m: Match, v: V, ids: (number | [number, number])[], at?: Vec2): V {
  if (at) Object.assign(v, { x: at.x, y: at.y });
  for (const k of ids) {
    const [id, seat] = typeof k === 'number' ? [k, -1] : k;
    const s = m.soldiers[id]!;
    if (seat >= 0) startCrew(s, seat, -1);
    mount(m, v, s, m.squads[s.squad]!);
  }
  return v;
}

/** `side`'s Commander's view of the live vehicle `id` (its hit points and seats only for its own Side), undefined while they do not see it. */
export const viewOf = (m: Match, id: number, side: SideId = 'nato'): VehicleView | undefined => commanderView(m, side).vehicles?.find((v) => v.id === id && !v.wreck);

/** Each of `changes` moves `m`'s `stateHash`: the state it changes is hashed. Typed by the fields it covers (`F`), so that a new field fails the typecheck until its test changes it too. */
export function hashes<F extends string>(m: Match, changes: Record<F, () => unknown>) {
  for (const [field, change] of Object.entries<() => unknown>(changes)) {
    const h = stateHash(m);
    change();
    expect(stateHash(m), field).not.toBe(h);
  }
}

/** An event and the tick it happened on. */
export type Logged = SimEvent & { tick: number };

/** Steps `ticks` ticks (Commands from `commands`, each tick), keeping every event with its tick and `side`'s view after each tick. */
export function play(m: Match, ticks: number, side: SideId = 'nato', commands: (m: Match) => Command[] = () => []) {
  const events: Logged[] = [];
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, commands(m))) events.push({ ...e, tick });
    views.push(commanderView(m, side));
  }
  return { events, views };
}
