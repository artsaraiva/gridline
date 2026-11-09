// What each Side knows about the enemy. Each Squad acts on its own sighting memory, never shared; the Commander sees
// the union of what the Side's Soldiers see (Contacts) and where they last saw it (Last Known Positions).
import type { Match } from './index';
import { vehicleOf, type Mix, type Soldier, type Squad } from './state';
import { dist2 } from './geometry';
import { SIDES, type LastKnownView, type SideId, type SimEvent } from './types';

/** One enemy Soldier (or #107 vehicle) a Squad knows about. `heard` entries (gunfire) steer behaviour but never become Contacts. */
export interface Sighting {
  id: number; // enemy Soldier or vehicle id
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

/** Enemies known to any Squad of `side` (BF4-style shared spotting): the freshest sighting per enemy id and source, so a newer `heard` never hides an older `seen`. */
export function sideKnown(m: Match, side: SideId): Sighting[] {
  const best = new Map<string, Sighting>();
  for (const sq of m.squads)
    if (sq.side === side)
      for (const s of sq.memory) {
        const key = `${s.id}${s.source}`;
        if ((best.get(key)?.tick ?? -1) < s.tick) best.set(key, s);
      }
  return [...best.values()];
}

/** A Soldier (or vehicle) of `sq` sees enemy `e` (Soldier or vehicle) this tick: the Squad remembers it and the Side's Commander gets it as a Contact. */
export function see(m: Match, sq: Squad, e: { id: number; x: number; y: number }) {
  const s: Sighting = { id: e.id, x: e.x, y: e.y, tick: m.tick, source: 'seen' };
  note(sq.memory, s);
  note(m.sightings[sq.side], { ...s });
}

/**
 * Gunfire phase, right after the shots: the target's Squad, and every living enemy of the shooter within `hearM` of
 * it, hears where the shot came from. Suppressive fire has no target: the enemies it lands near (`suppressiveRadiusM`
 * of the aim point) hear it instead. A sighting from this tick's perception is not replaced by a heard one.
 * #107: a shot from a Soldier aboard is heard as its vehicle, the crew of a vehicle shot at hear it, and a main gun impact
 * is heard like a shot by the enemies near it (`tankSuppressM`).
 */
export function hear(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const e of events) {
    if (e.kind !== 'shot' && e.kind !== 'suppressive' && !(e.kind === 'impact' && e.from !== undefined)) continue;
    const from = e.kind === 'impact' ? e.from! : e.from;
    const gun = m.soldiers[from];
    const shooter = vehicleOf(m, gun ? gun.vehicle : from) ?? gun!;
    const heard: Sighting = { id: shooter.id, x: shooter.x, y: shooter.y, tick: m.tick, source: 'heard' };
    const r = e.kind === 'impact' ? t.tankSuppressM : t.suppressiveRadiusM;
    const hit = (s: Soldier) => (e.kind === 'shot' ? s.id === e.to || s.vehicle === e.to : s.state === 'alive' && dist2(s, e) <= r * r);
    for (const sq of m.squads) {
      if (sq.side === shooter.side) continue;
      const near = (s: Soldier) => hit(s) || (s.state === 'alive' && dist2(s, shooter) <= t.hearM * t.hearM);
      if (!sq.members.some((id) => near(m.soldiers[id]!))) continue;
      if (sq.memory.some((o) => o.id === shooter.id && o.tick === m.tick)) continue;
      note(sq.memory, { ...heard });
    }
  }
}

/** Drops squad memory older than `memorySeconds` and Side sightings older than `lkpSeconds`. Runs at the start of perception. */
export function forget(m: Match) {
  const t = m.tune;
  const fresh = (seconds: number) => (s: Sighting) => m.tick - s.tick <= seconds * t.hz;
  for (const sq of m.squads) sq.memory = sq.memory.filter(fresh(t.memorySeconds));
  for (const side of SIDES) m.sightings[side] = m.sightings[side].filter(fresh(t.lkpSeconds));
}

// Read on a view, after `step` moved the tick on: the latest perception phase ran at tick - 1.
const isContact = (m: Match, s: Sighting) => s.tick === m.tick - 1 && (m.soldiers[s.id] ? m.soldiers[s.id]!.state === 'alive' : vehicleOf(m, s.id)!.deadAt === -1);

/** Whether a Soldier of `side` saw enemy `id` in the latest perception phase (it may have been Wounded since). */
export const justSeen = (m: Match, side: SideId, id: number) => m.sightings[side].some((s) => s.id === id && s.tick === m.tick - 1);

/** Enemies (Soldiers and #107 vehicles) seen in the latest perception phase and still standing. */
export function contactIds(m: Match, side: SideId): number[] {
  return m.sightings[side].filter((s) => isContact(m, s)).map((s) => s.id);
}

/** Lost Contacts where they were last seen; `fade` runs from 1 (just lost) to 0 (`lkpSeconds` later). */
export function lastKnown(m: Match, side: SideId): LastKnownView[] {
  const span = m.tune.lkpSeconds * m.tune.hz;
  return m.sightings[side].filter((s) => !isContact(m, s)).map((s) => ({ x: s.x, y: s.y, fade: 1 - (m.tick - 1 - s.tick) / span }));
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
