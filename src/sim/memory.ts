// What each Side knows about the enemy. Each Squad acts on its own sighting memory, never shared; the Commander sees
// the union of what the Side's Soldiers see (Contacts) and where they last saw it (Last Known Positions).
import type { Match } from './index';
import type { Mix, Soldier, Squad } from './state';
import { SIDES, type SideId } from './types';

/** One enemy Soldier a Squad knows about. `heard` entries (gunfire) steer behaviour but never become Contacts. */
export interface Sighting {
  id: number; // enemy Soldier id
  x: number;
  y: number;
  tick: number;
  source: 'seen' | 'heard';
}

/** One entry per enemy id: the newest replaces the old. */
function note(list: Sighting[], s: Sighting) {
  const i = list.findIndex((o) => o.id === s.id);
  if (i < 0) list.push(s);
  else list[i] = s;
}

/** A Soldier of `sq` sees enemy `e` this tick: the Squad remembers it and the Side's Commander gets it as a Contact. */
export function see(m: Match, sq: Squad, e: Soldier) {
  const s: Sighting = { id: e.id, x: e.x, y: e.y, tick: m.tick, source: 'seen' };
  note(sq.memory, s);
  note(m.sightings[sq.side], { ...s });
}

/** Drops squad memory older than `memorySeconds` and Side sightings older than `lkpSeconds`. Runs at the start of perception. */
export function forget(m: Match) {
  const t = m.tune;
  const fresh = (seconds: number) => (s: Sighting) => m.tick - s.tick <= seconds * t.hz;
  for (const sq of m.squads) sq.memory = sq.memory.filter(fresh(t.memorySeconds));
  for (const side of SIDES) m.sightings[side] = m.sightings[side].filter(fresh(t.lkpSeconds));
}

/** Enemies seen in the latest perception phase and still standing. Called on a view, after `step` moved the tick on. */
export function contactIds(m: Match, side: SideId): number[] {
  return m.sightings[side].filter((s) => s.tick === m.tick - 1 && m.soldiers[s.id]!.state === 'alive').map((s) => s.id);
}

const SOURCE = { seen: 0, heard: 1 };

export function hashMemory(m: Match, mix: Mix) {
  const all = (list: Sighting[]) => {
    mix(list.length);
    for (const s of list) {
      mix(s.id);
      mix(Math.round(s.x * 1000));
      mix(Math.round(s.y * 1000));
      mix(s.tick);
      mix(SOURCE[s.source]);
    }
  };
  for (const sq of m.squads) all(sq.memory);
  all(m.sightings.nato);
  all(m.sightings.pact);
}
