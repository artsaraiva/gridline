// Vehicles (#107, the tank tracer for the shared rules of #27; ADR 0005): each Side's slot, seats, boarding and leaving per
// Soldier, the drive step, the tank's eyes and guns, the kill table, Wrecks and the respawn. Soldiers and vehicles share one
// id space: a vehicle's id comes after every Soldier's (`vehicleOf` in state.ts), so sightings, targets and `shot` events
// address either.
import type { Match } from './index';
import { driveFlow, flowDist, flowLook } from './ai/flow';
import { blast } from './assets/strike';
import { die } from './combat';
import { dist2, inHq } from './geometry';
import { cellIndex, los, nearestWalkable } from './grid';
import { see } from './memory';
import { footLeader, membersOf, vehicleOf, type Mix, type Soldier, type Squad } from './state';
import { enemyOf, SIDES, type SideId, type SimEvent, type Vec2, type VehicleView } from './types';

export interface Vehicle {
  id: number;
  side: SideId;
  kind: 'tank';
  x: number;
  y: number;
  fx: number; // unit hull facing
  fy: number;
  hp: number;
  seats: number[]; // Soldier ids, -1 free; seat 0 drives and fires the main gun, seat 1 is the gunner on the coax
  slot: Vec2; // where it waits at the start and a fresh one appears
  parked: boolean; // standing at its goal, or waiting for riders
  deadAt: number; // tick it was destroyed, -1 = live
  goal: number; // index of the Capture Point it drives to (its driver's), -1 = none
  departAt: number; // tick a fresh driver leaves with free seats
  target: number; // main gun target id (Soldier or vehicle), -1 = none
  coax: number; // coax target Soldier id, -1 = none
  nextFire: number; // tick the main gun may fire again
}

/** A destroyed vehicle where it died, for the rest of the Match. `seen`: the enemy saw it die. */
export interface Wreck {
  side: SideId;
  kind: 'tank';
  x: number;
  y: number;
  fx: number;
  fy: number;
  seen: boolean;
}

export const live = (v: Vehicle) => v.deadAt < 0;
export const riders = (m: Match, v: Vehicle) => v.seats.filter((id) => id >= 0).map((id) => m.soldiers[id]!);
const squared = (r: number) => r * r;

/** The first fresh tank of each Side, in its slot: the map's, else the drivable cell nearest its HQ. */
export function newVehicles(m: Match): Vehicle[] {
  return SIDES.map((side, i) => {
    const hq = m.map.hqs[side];
    const slot = m.map.vehicleSlots?.[side] ?? nearestWalkable(m, { x: hq.x, y: hq.y }, m.drive[side]);
    return { id: m.soldiers.length + i, side, kind: 'tank', ...slot, fx: side === 'nato' ? 1 : -1, fy: 0, hp: m.tune.tankHp, seats: [-1, -1], slot, parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, nextFire: 0 };
  });
}

/** The Capture Point `s` is heading for: its own when Detached, else its Squad's; -1 when that is not a Capture Point. */
const goalOf = (m: Match, sq: Squad, s: Soldier) => (s.detached && s.goal >= 0 ? s.goal : sq.task === 'point' ? sq.goal : -1);

/**
 * At its Squad's think: a Soldier on foot whose Capture Point is farther than `boardMinM` boards the nearest friendly vehicle
 * within `boardM` with a free seat that is empty (it drives, to its own goal) or whose driver's goal is within `sameWayM` of
 * its own; a vehicle with a squad mate aboard comes first.
 */
export function board(m: Match, sq: Squad, s: Soldier) {
  const t = m.tune;
  const goal = goalOf(m, sq, s);
  const p = m.points[goal];
  if (!p || s.reviving >= 0 || dist2(s, p) <= squared(t.boardMinM)) return;
  let best: Vehicle | null = null;
  let bestKey = Infinity;
  for (const v of m.vehicles) {
    if (v.side !== s.side || !live(v) || v.hp < t.tankHp / 3 || !v.seats.includes(-1) || dist2(s, v) > squared(t.boardM)) continue;
    const driving = m.points[v.goal];
    if (v.seats[0]! >= 0 && (!driving || dist2(driving, p) > squared(t.sameWayM))) continue;
    const key = dist2(s, v) + (riders(m, v).some((o) => o.squad === s.squad) ? 0 : 1e9);
    if (key < bestKey) [best, bestKey] = [v, key];
  }
  if (best) mount(m, best, s, goal);
}

/** `s` takes the first free seat of `v`; in the driver's seat it sets the goal and starts the wait for others. */
export function mount(m: Match, v: Vehicle, s: Soldier, goal: number) {
  const seat = v.seats.indexOf(-1);
  v.seats[seat] = s.id;
  if (seat === 0) Object.assign(v, { goal, departAt: m.tick + Math.round(m.tune.boardWaitSeconds * m.tune.hz), parked: true });
  Object.assign(s, {
    vehicle: v.id, x: v.x, y: v.y, fx: v.fx, fy: v.fy, target: -1, lastTarget: -1, reviving: -1, suppression: 0,
    dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false, strayUntil: 0, // a Detached rider keeps its own goal
  });
}

/**
 * At its Squad's think, a Soldier aboard: the driver keeps the vehicle on its own Capture Point (the Squad's, or its own
 * when it boarded Detached; Retreat and Resupply ignore it); everyone gets out once the vehicle is under a third of its hit
 * points, Detached when away from the Squad.
 */
export function ride(m: Match, sq: Squad, s: Soldier) {
  const v = vehicleOf(m, s.vehicle)!;
  const goal = goalOf(m, sq, s);
  if (v.seats[0] === s.id && goal >= 0) v.goal = goal;
  if (v.hp >= m.tune.tankHp / 3) return;
  v.seats[v.seats.indexOf(s.id)] = -1;
  s.vehicle = -1;
  const foot = membersOf(m, sq).filter((o) => o.state === 'alive' && o.vehicle < 0 && o !== s && !o.detached);
  s.detached = foot.length > 0 && dist2(s, footLeader(foot)!) > squared(m.tune.detachM);
}

/** The vehicle phase, after the Soldiers walk: fresh vehicles in empty slots, then every one with a driver drives; its riders ride along. */
export function drive(m: Match) {
  const t = m.tune;
  for (const v of m.vehicles) {
    if (!live(v)) {
      if (m.tick - v.deadAt >= t.vehicleRespawnSeconds * t.hz)
        Object.assign(v, { ...v.slot, fx: v.side === 'nato' ? 1 : -1, fy: 0, hp: t.tankHp, seats: v.seats.map(() => -1), parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, nextFire: 0 });
      continue;
    }
    const full = !v.seats.includes(-1);
    if (v.seats[0]! >= 0 && v.goal >= 0 && (full || m.tick >= v.departAt)) step(m, v);
    for (const s of riders(m, v)) Object.assign(s, { x: v.x, y: v.y, fx: v.fx, fy: v.fy, ammo: t.ammo, suppression: 0 }); // no ammo worries
  }
}

/** One tick along the drive flow field to its goal at the speed of the ground under it; parked once there. */
function step(m: Match, v: Vehicle) {
  const t = m.tune;
  const g = m.drive[v.side];
  const f = driveFlow(m, v.side, v.goal);
  v.parked = flowDist(m, f, v) === 0;
  if (v.parked) return;
  const k = cellIndex(m, v.x, v.y);
  const cost = (k >= 0 && g.cost[k]) || 20;
  const speed = (cost === 10 ? t.tankRoadMps : (t.tankOpenMps * 20) / cost) / t.hz;
  const go = (to: Vec2 | null) => {
    if (!to) return false;
    const dx = to.x - v.x;
    const dy = to.y - v.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.01) return false;
    const u = Math.min(speed, d);
    const x = v.x + (dx / d) * u;
    const y = v.y + (dy / d) * u;
    const nk = cellIndex(m, x, y);
    if (nk < 0 || !g.cost[nk]) return false;
    Object.assign(v, { x, y, fx: dx / d, fy: dy / d });
    return true;
  };
  // a few cells ahead for a smooth line; the next cell's centre when that line would clip something blocked
  if (!go(flowLook(m, f, v, 3, g))) go(flowLook(m, f, v, 1, g));
}

/**
 * Perception, for each vehicle with anyone aboard: one pair of eyes from the hull (the Soldier cone and line of sight at `vehicleVisionMul`
 * x `visionM`) on enemy Soldiers on foot and enemy vehicles; what it sees goes into the memory of every Squad with a rider aboard. The main gun
 * takes an enemy tank first, then any other vehicle, then infantry, nearest within each, in range; the coax the nearest infantry.
 */
export function look(m: Match, v: Vehicle) {
  const t = m.tune;
  v.target = -1;
  v.coax = -1;
  const aboard = riders(m, v);
  if (!live(v) || !aboard.length) return;
  const squads = [...new Set(aboard.map((s) => m.squads[s.squad]!))];
  const R = t.visionM * t.vehicleVisionMul;
  const sees = (e: Vec2 & { side: SideId }) => {
    const d2 = dist2(v, e);
    if (d2 > R * R || (e.x - v.x) * v.fx + (e.y - v.y) * v.fy < t.visionCos * Math.sqrt(d2) || inHq(m, e.side, e) || !los(m, v, e)) return false;
    return true;
  };
  let best: { id: number; rank: number; d2: number } | null = null;
  const consider = (id: number, rank: number, d2: number) => {
    if (d2 <= squared(t.tankRangeM) && (!best || rank < best.rank || (rank === best.rank && d2 < best.d2))) best = { id, rank, d2 };
  };
  let coaxD2 = squared(t.coaxRangeM);
  for (const e of m.soldiers) {
    if (e.side === v.side || e.state !== 'alive' || e.vehicle >= 0 || !sees(e)) continue;
    if (!m.sightings[v.side].some((o) => o.id === e.id && o.tick >= m.tick - 1)) e.uavUntil = -1; // #75, as for a Soldier's eyes
    for (const sq of squads) see(m, sq, e);
    const d2 = dist2(v, e);
    consider(e.id, 2, d2);
    if (d2 <= coaxD2) [v.coax, coaxD2] = [e.id, d2];
  }
  for (const u of m.vehicles) {
    if (u.side === v.side || !live(u) || !sees(u)) continue;
    for (const sq of squads) see(m, sq, u);
    consider(u.id, u.kind === 'tank' ? 0 : 1, dist2(v, u));
  }
  if (best || v.coax >= 0) for (const sq of squads) sq.lastSeen = m.tick;
  v.target = (best as { id: number } | null)?.id ?? -1;
}

/** A Soldier on foot sees an enemy vehicle at `vehicleVisionMul` x its range, in its cone and line of sight, outside its HQ. */
export function seeVehicles(m: Match, s: Soldier, sq: Squad) {
  const t = m.tune;
  const R = t.visionM * t.vehicleVisionMul;
  for (const v of m.vehicles) {
    if (v.side === s.side || !live(v)) continue;
    const d2 = dist2(s, v);
    if (d2 > R * R || (v.x - s.x) * s.fx + (v.y - s.y) * s.fy < t.visionCos * Math.sqrt(d2) || inHq(m, v.side, v) || !los(m, s, v)) continue;
    see(m, sq, v);
  }
}

/** What `v`'s main gun is laid on: a Soldier or a vehicle, or undefined. */
export const targetOf = (m: Match, v: Vehicle): Vec2 | undefined => m.soldiers[v.target] ?? vehicleOf(m, v.target);

/**
 * The combat phase, before any shot lands: each driver whose main gun is due fires at a target in range; returns where each
 * round lands (its target's spot) and starts the interval.
 */
export function aimMainGuns(m: Match): { v: Vehicle; at: Vec2 }[] {
  const t = m.tune;
  const guns: { v: Vehicle; at: Vec2 }[] = [];
  for (const v of m.vehicles) {
    const e = targetOf(m, v);
    if (!live(v) || v.seats[0]! < 0 || !e || m.tick < v.nextFire || dist2(v, e) > t.tankRangeM * t.tankRangeM) continue;
    v.nextFire = m.tick + Math.round(t.tankFireSeconds * t.hz);
    guns.push({ v, at: { x: e.x, y: e.y } });
  }
  return guns;
}

/** After the shots: each round a Strike-shaped impact, the enemy's vehicles in its kill radius hit; no Commander is paid for what it kills. */
export function landMainGuns(m: Match, guns: { v: Vehicle; at: Vec2 }[], events: SimEvent[]) {
  const t = m.tune;
  for (const { v, at } of guns) {
    events.push({ kind: 'impact', side: v.side, x: at.x, y: at.y, asset: 'tank', from: v.id });
    blast(m, v.side, at, { killM: t.tankKillM, woundM: t.tankWoundM, suppressM: t.tankSuppressM, suppression: t.tankSuppression }, null, events, { damage: t.tankVsVehicleDamage, foesOnly: true });
  }
}

/** A Launcher is roster member 1 of its Squad. */
export const isLauncher = (m: Match, s: Soldier) => m.squads[s.squad]!.members[1] === s.id;

/** The nearest enemy vehicle a Launcher may fire a rocket at: live, within `rocketRangeM`, in line of sight, outside its HQ. */
export function rocketTarget(m: Match, s: Soldier): Vehicle | null {
  let best: Vehicle | null = null;
  let bestD2 = squared(m.tune.rocketRangeM);
  for (const v of m.vehicles) {
    const d2 = dist2(s, v);
    if (v.side === s.side || !live(v) || d2 > bestD2 || inHq(m, v.side, v) || !los(m, s, v)) continue;
    [best, bestD2] = [v, d2];
  }
  return best;
}

/**
 * `damage` to `v` from Side `by`; at 0 hit points it is destroyed: every occupant dies outright (a Ticket each), and a Strike
 * (`cause`) of the enemy's scores them for that Commander at the shell tariff; it leaves a Wreck where it died.
 */
export function hurt(m: Match, v: Vehicle, damage: number, by: SideId, cause: Soldier['cause'], events: SimEvent[]) {
  if (!live(v)) return;
  v.hp -= damage;
  if (v.hp > 0) return;
  for (const s of riders(m, v)) {
    if (cause && by !== s.side) s.cause = cause;
    die(m, s, events);
  }
  const seen = m.sightings[enemyOf(v.side)].some((o) => o.id === v.id && o.tick >= m.tick - 1);
  m.wrecks.push({ side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, seen });
  Object.assign(v, { hp: 0, deadAt: m.tick, target: -1, coax: -1 });
}

/** A Soldier leaves its seat (it died, or came back from the dead). */
export function leave(m: Match, s: Soldier) {
  const v = vehicleOf(m, s.vehicle);
  if (v) v.seats[v.seats.indexOf(s.id)] = -1;
  s.vehicle = -1;
}

export function vehicleViews(m: Match, side: SideId, seen: Set<number>): VehicleView[] {
  const turret = (v: Vehicle) => {
    const e = targetOf(m, v);
    const d = e ? Math.sqrt(dist2(v, e)) : 0;
    return d > 0 ? { tx: (e!.x - v.x) / d, ty: (e!.y - v.y) / d } : { tx: v.fx, ty: v.fy };
  };
  const views: VehicleView[] = [];
  for (const v of m.vehicles) {
    if (!live(v) || (v.side !== side && !seen.has(v.id))) continue;
    const base = { id: v.id, side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, ...turret(v) };
    views.push(v.side === side ? { ...base, hp: v.hp / m.tune.tankHp, seats: [...v.seats] } : base);
  }
  for (const w of m.wrecks)
    if (w.side === side || w.seen) views.push({ id: -1, side: w.side, kind: w.kind, x: w.x, y: w.y, fx: w.fx, fy: w.fy, tx: w.fx, ty: w.fy, wreck: true });
  return views;
}

export function hashVehicles(m: Match, mix: Mix) {
  for (const v of m.vehicles) {
    for (const n of [v.x, v.y, v.fx, v.fy, v.hp]) mix(Math.round(n * 1000));
    for (const n of [...v.seats, +v.parked, v.deadAt, v.goal, v.departAt, v.target, v.coax, v.nextFire]) mix(n);
  }
  mix(m.wrecks.length);
  for (const w of m.wrecks) for (const n of [Math.round(w.x * 1000), Math.round(w.y * 1000), +w.seen]) mix(n);
}
