// Vehicles (#107, the tank tracer for the shared rules of #27; ADR 0005): each Side's slot, seats, boarding and leaving per
// Soldier, the drive step, the tank's eyes and guns, the kill table, Wrecks and the respawn. #108 adds the jeep, a transport:
// its passengers get out by the shared passenger rule (`wantsOut`), and its second seat fires an MG where the tank's has the coax. Soldiers and vehicles share one
// id space: a vehicle's id comes after every Soldier's (`vehicleOf` in state.ts), so sightings, targets and `shot` events
// address either.
import type { Match } from './index';
import { driveFlow, flowDist, flowLook } from './ai/flow';
import { bestPoint } from './ai/squad';
import { rnd } from './rng';
import { blast } from './assets/strike';
import { die } from './combat';
import { dist2, inHq } from './geometry';
import { cellIndex, los, nearestWalkable } from './grid';
import { see } from './memory';
import { footLeader, membersOf, vehicleOf, type Mix, type Soldier, type Squad } from './state';
import { enemyOf, SIDES, type SideId, type SimEvent, type Tune, type Vec2, type VehicleKind, type VehicleView } from './types';

export interface Vehicle {
  id: number;
  side: SideId;
  kind: VehicleKind;
  x: number;
  y: number;
  fx: number; // unit hull facing
  fy: number;
  hp: number;
  seats: number[]; // Soldier ids, -1 free; seat 0 drives (and fires a tank's main gun), seat 1 is the gunner on the coax or MG, any more ride
  slot: Vec2; // where it waits at the start and a fresh one appears
  parked: boolean; // standing at its goal, or waiting for riders
  deadAt: number; // tick it was destroyed, -1 = live
  goal: number; // index of the Capture Point it drives to (its driver's), -1 = none
  departAt: number; // tick a fresh driver leaves with free seats
  target: number; // main gun target id (Soldier or vehicle), -1 = none
  coax: number; // coax (or MG) target Soldier id, -1 = none
  nextFire: number; // tick the main gun may fire again
  rounds: Round[]; // main gun rounds in the air (they land even if it dies meanwhile)
  laid: number; // the target the main gun last laid on, -1 = none; a new one costs the aim time
  bias: number[]; // its driver's seeded preference per Capture Point, drawn when the driver boards
  movedAt: number; // #108 last tick it moved
  halt: number; // #108 tick it stopped for someone to get out, -1 = not stopping
}

/** A main gun round: fired from (x0, y0) at tick `launch`, landing on (x, y) at tick `land`. */
export interface Round {
  x0: number;
  y0: number;
  x: number;
  y: number;
  launch: number;
  land: number;
}

/** A destroyed vehicle where it died, for the rest of the Match. `seen`: the enemy saw it die. */
export interface Wreck {
  side: SideId;
  kind: VehicleKind;
  x: number;
  y: number;
  fx: number;
  fy: number;
  seen: boolean;
}

export const live = (v: Vehicle) => v.deadAt < 0;
export const riders = (m: Match, v: Vehicle) => v.seats.filter((id) => id >= 0).map((id) => m.soldiers[id]!);
const squared = (r: number) => r * r;

/** What each class is: hit points, seats, speeds, and the second seat's gun (the tank's coax, the jeep's MG). */
export const specOf = (t: Tune, kind: VehicleKind) =>
  kind === 'tank'
    ? { hp: t.tankHp, seats: 2, roadMps: t.tankRoadMps, openMps: t.tankOpenMps, gunSeconds: t.coaxFireSeconds, gunM: t.coaxRangeM }
    : { hp: t.jeepHp, seats: 4, roadMps: t.jeepRoadMps, openMps: t.jeepOpenMps, gunSeconds: t.mgFireSeconds, gunM: t.mgRangeM };
/** Under a third of its hit points: everyone gets out, nobody gets in. */
const crippled = (m: Match, v: Vehicle) => v.hp < specOf(m.tune, v.kind).hp / 3;

/** A vehicle as it stands fresh in its slot. */
const fresh = (m: Match, side: SideId, kind: VehicleKind, slot: Vec2) => ({
  side, kind, ...slot, fx: side === 'nato' ? 1 : -1, fy: 0, hp: specOf(m.tune, kind).hp, seats: Array<number>(specOf(m.tune, kind).seats).fill(-1), slot,
  parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, nextFire: 0, laid: -1, bias: [] as number[], movedAt: m.tick, halt: -1,
});

/**
 * The first fresh vehicles of each Side in their slots: its tanks, one per slot the map gives (else one on the drivable cell
 * nearest the HQ) or `tanksPerSide` when the tune says, then `jeepsPerSide` jeeps (#108); any beyond the map's slots each 9 m
 * farther toward the field than the last.
 */
export function newVehicles(m: Match): Vehicle[] {
  return SIDES.flatMap((side) => {
    const hq = m.map.hqs[side];
    const slots = m.map.vehicleSlots?.[side] ?? [nearestWalkable(m, { x: hq.x, y: hq.y }, m.drive[side])];
    const last = slots.at(-1)!;
    const kinds: VehicleKind[] = [...Array<VehicleKind>(m.tune.tanksPerSide ?? slots.length).fill('tank'), ...Array<VehicleKind>(m.tune.jeepsPerSide).fill('jeep')];
    return kinds.map((kind, k) => {
      const slot = slots[k] ?? nearestWalkable(m, { x: last.x + (side === 'nato' ? 9 : -9) * (k - slots.length + 1), y: last.y }, m.drive[side]);
      return { ...fresh(m, side, kind, slot), rounds: [] as Round[] };
    });
  }).map((v, i) => ({ ...v, id: m.soldiers.length + i }));
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
    if (v.side !== s.side || !live(v) || crippled(m, v) || !v.seats.includes(-1) || dist2(s, v) > squared(t.boardM)) continue;
    if (v.id === s.exited && v.seats.some((id) => id >= 0)) continue; // #108: not back into the ride it just left
    const driving = m.points[v.goal];
    if (v.seats[0]! >= 0 && (!driving || dist2(driving, p) > squared(t.sameWayM))) continue;
    const key = dist2(s, v) + (riders(m, v).some((o) => o.squad === s.squad) ? 0 : 1e9);
    if (key < bestKey) [best, bestKey] = [v, key];
  }
  if (best) mount(m, best, s, sq);
}

/**
 * `s` takes the first free seat of `v`. In the driver's seat it draws its own preference per Capture Point (seeded, kept for
 * the drive), picks its goal and starts the wait for others.
 */
export function mount(m: Match, v: Vehicle, s: Soldier, sq: Squad) {
  const seat = v.seats.indexOf(-1);
  v.seats[seat] = s.id;
  if (seat === 0) {
    const t = m.tune;
    Object.assign(v, { goal: -1, bias: m.points.map(() => (rnd(m) * 2 - 1) * t.tankGoalBias), departAt: m.tick + Math.round(t.boardWaitSeconds * t.hz), parked: true });
    v.goal = drivePoint(m, sq, s, v);
  }
  Object.assign(s, {
    vehicle: v.id, x: v.x, y: v.y, fx: v.fx, fy: v.fy, target: -1, lastTarget: -1, reviving: -1, suppression: 0, away: -1, awaySince: -1,
    dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false, strayUntil: 0, // a Detached rider keeps its own goal
  });
}

/**
 * A Soldier coming back from the dead (Squad Respawn or Redeploy) takes a seat if one waits for it: in the Squad Leader's
 * vehicle while the leader rides one, else in a friendly vehicle with nobody driving (fit to fight: a third of its hit points
 * or more), as its driver. True when it did.
 */
export function boardOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  const lead = m.soldiers[sq.members[0]!]!;
  const mine = lead.state === 'alive' ? vehicleOf(m, lead.vehicle) : undefined;
  const v = mine?.seats.includes(-1) ? mine : m.vehicles.find((o) => o.side === s.side && live(o) && o.seats[0] === -1 && !crippled(m, o));
  if (!v) return false;
  mount(m, v, s, sq);
  return true;
}

/**
 * The Capture Point a driver takes its vehicle to: scored like its Squad's choice (the Order's bonus as ever) but by drive
 * distance from the vehicle, with its own seeded preference, stickiness to where it is going, and the crowd penalty for each
 * other friendly vehicle already going there; its Squad's goal pulls no harder than any point. A Detached driver keeps its own,
 * and #108 a transport's driver always drives to its own goal.
 */
function drivePoint(m: Match, sq: Squad, s: Soldier, v: Vehicle): number {
  if (v.kind !== 'tank' || (s.detached && s.goal >= 0)) return goalOf(m, sq, s);
  const t = m.tune;
  const others = (i: number) => m.vehicles.filter((o) => o !== v && o.side === v.side && live(o) && o.seats[0]! >= 0 && o.goal === i).length;
  const bias = v.bias.map((b, i) => b + (i === v.goal ? t.stickiness : 0) - t.crowdPenalty * others(i) - (sq.task === 'point' && sq.goal === i ? t.stickiness : 0));
  return bestPoint(m, sq, v, 0, { flow: (i) => driveFlow(m, v.side, i), bias });
}

/**
 * At its Squad's think, a Soldier aboard: the driver keeps the vehicle on its own Capture Point (the Squad's, or its own
 * when it boarded Detached; Retreat and Resupply ignore it). One who wants out (`wantsOut`) gets out once the vehicle has stood
 * `dismountStopSeconds`, stopping it for that first; Detached when away from the Squad.
 */
export function ride(m: Match, sq: Squad, s: Soldier) {
  const t = m.tune;
  const v = vehicleOf(m, s.vehicle)!;
  if (v.seats[0] === s.id) {
    const goal = drivePoint(m, sq, s, v);
    if (goal >= 0) v.goal = goal;
  }
  if (!wantsOut(m, sq, s, v)) return;
  if (m.tick - v.movedAt < Math.round(t.dismountStopSeconds * t.hz)) {
    if (v.halt < 0) v.halt = m.tick; // nobody bails at speed
    return;
  }
  v.seats[v.seats.indexOf(s.id)] = -1;
  Object.assign(s, { vehicle: -1, exited: v.id });
  const foot = membersOf(m, sq).filter((o) => o.state === 'alive' && o.vehicle < 0 && o !== s && !o.detached);
  s.detached = foot.length > 0 && dist2(s, footLeader(foot)!) > squared(t.detachM);
}

/**
 * The shared leaving rule (#27, #108), at think. Anyone gets out under a third of the hit points; a tank's crew only then.
 * A transport empties at its goal. A passenger also gets out once the vehicle has stood still `stillSeconds` (waiting to set
 * off is not standing still), within `dismountM` of its own Capture Point, or once its drive distance to that point has grown
 * for `awaySeconds`.
 */
function wantsOut(m: Match, sq: Squad, s: Soldier, v: Vehicle): boolean {
  const t = m.tune;
  if (crippled(m, v)) return true;
  if (v.kind === 'tank') return false;
  if (v.goal >= 0 && flowDist(m, driveFlow(m, v.side, v.goal), v) === 0) return true;
  if (v.seats[0] === s.id) return false;
  if (m.tick - Math.max(v.movedAt, v.departAt) >= t.stillSeconds * t.hz) return true;
  const own = goalOf(m, sq, s);
  const p = m.points[own];
  if (!p) return false;
  if (dist2(v, p) <= squared(t.dismountM)) return true;
  const d = flowDist(m, driveFlow(m, v.side, own), v);
  if (d === Infinity) return false;
  if (s.away >= 0 && d > s.away) s.awaySince = s.awaySince < 0 ? m.tick : s.awaySince;
  else if (d < s.away) s.awaySince = -1;
  s.away = d;
  return s.awaySince >= 0 && m.tick - s.awaySince >= t.awaySeconds * t.hz;
}

/**
 * The vehicle phase, after the Soldiers walk: fresh vehicles in empty slots, then every one with a driver drives unless it
 * stands for a dismount (long enough for everyone who wants out to have thought once); its riders ride along.
 */
export function drive(m: Match) {
  const t = m.tune;
  for (const v of m.vehicles) {
    if (!live(v)) {
      if (m.tick - v.deadAt >= t.vehicleRespawnSeconds * t.hz) Object.assign(v, fresh(m, v.side, v.kind, v.slot));
      continue;
    }
    const halted = v.halt >= 0 && m.tick - v.halt < Math.round((t.dismountStopSeconds + t.thinkSeconds) * t.hz);
    if (!halted) v.halt = -1;
    const full = !v.seats.includes(-1);
    if (!halted && v.seats[0]! >= 0 && v.goal >= 0 && (full || m.tick >= v.departAt)) step(m, v);
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
  const { roadMps, openMps } = specOf(t, v.kind);
  const speed = (cost === 10 ? roadMps : (openMps * 20) / cost) / t.hz;
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
    Object.assign(v, { x, y, fx: dx / d, fy: dy / d, movedAt: m.tick });
    return true;
  };
  // a few cells ahead for a smooth line; the next cell's centre when that line would clip something blocked
  if (!go(flowLook(m, f, v, 3, g))) go(flowLook(m, f, v, 1, g));
}

/**
 * Perception, for each vehicle with anyone aboard: one pair of eyes from the hull (the Soldier cone and line of sight at `vehicleVisionMul`
 * x `visionM`) on enemy Soldiers on foot and enemy vehicles; what it sees goes into the memory of every Squad with a rider aboard. A tank's
 * main gun takes an enemy tank first, then any other vehicle, then infantry, nearest within each, in range; the coax (#108: or a jeep's MG)
 * the nearest infantry in its range.
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
    if (v.kind === 'tank' && d2 <= squared(t.tankRangeM) && (!best || rank < best.rank || (rank === best.rank && d2 < best.d2))) best = { id, rank, d2 };
  };
  let coaxD2 = squared(specOf(t, v.kind).gunM);
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

/**
 * A Soldier on foot sees an enemy vehicle at `vehicleVisionMul` x its range, in its cone and line of sight, outside its HQ.
 * #108: the nearest jeep it sees within `within` metres squared, a rifle target, or null.
 */
export function seeVehicles(m: Match, s: Soldier, sq: Squad, within: number): Vehicle | null {
  const t = m.tune;
  const R = t.visionM * t.vehicleVisionMul;
  let soft: Vehicle | null = null;
  for (const v of m.vehicles) {
    if (v.side === s.side || !live(v)) continue;
    const d2 = dist2(s, v);
    if (d2 > R * R || (v.x - s.x) * s.fx + (v.y - s.y) * s.fy < t.visionCos * Math.sqrt(d2) || inHq(m, v.side, v) || !los(m, s, v)) continue;
    see(m, sq, v);
    if (v.kind !== 'tank' && d2 < within) [soft, within] = [v, d2];
  }
  return soft;
}

/** What `v`'s main gun is laid on: a Soldier or a vehicle, or undefined. */
export const targetOf = (m: Match, v: Vehicle): Vec2 | undefined => m.soldiers[v.target] ?? vehicleOf(m, v.target);

/**
 * The combat phase: each driver whose main gun is due fires at its target in range, a round that flies to the target's spot
 * at `tankShellMps`; then every round due lands, a Strike-shaped impact hitting the enemy's vehicles in its kill radius:
 * `tankVsVehicleDamage` on a tank, anything lighter destroyed. No Commander is paid for what it kills.
 */
export function mainGuns(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const v of m.vehicles) {
    const e = targetOf(m, v);
    if (e && v.target !== v.laid) { // laying the gun on a new target takes a seeded moment, so two tanks never trade the first round together
      v.laid = v.target;
      v.nextFire = Math.max(v.nextFire, m.tick + Math.round((t.tankAimSeconds[0] + rnd(m) * (t.tankAimSeconds[1] - t.tankAimSeconds[0])) * t.hz));
    }
    if (!live(v) || v.seats[0]! < 0 || !e || m.tick < v.nextFire || dist2(v, e) > t.tankRangeM * t.tankRangeM) continue;
    v.nextFire = m.tick + Math.round(t.tankFireSeconds * t.hz);
    const flight = Math.max(1, Math.round((Math.sqrt(dist2(v, e)) / t.tankShellMps) * t.hz));
    v.rounds.push({ x0: v.x, y0: v.y, x: e.x, y: e.y, launch: m.tick, land: m.tick + flight });
  }
  for (const v of m.vehicles)
    for (const r of v.rounds.filter((r) => r.land <= m.tick)) {
      events.push({ kind: 'impact', side: v.side, x: r.x, y: r.y, asset: 'tank', from: v.id });
      blast(m, v.side, r, { killM: t.tankKillM, woundM: t.tankWoundM, suppressM: t.tankSuppressM, suppression: t.tankSuppression }, null, events, { damage: (u) => (u.kind === 'tank' ? t.tankVsVehicleDamage : Infinity), foesOnly: true });
      v.rounds.splice(v.rounds.indexOf(r), 1);
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
    const rounds = v.rounds.map((r) => ({ from: { x: r.x0, y: r.y0 }, to: { x: r.x, y: r.y }, flight: (m.tick - r.launch) / (r.land - r.launch) }));
    views.push({ ...base, ...(v.side === side && { hp: v.hp / specOf(m.tune, v.kind).hp, seats: [...v.seats] }), ...(rounds.length && { rounds }), ...(v.seats.every((id) => id < 0) && { empty: true }) });
  }
  for (const w of m.wrecks)
    if (w.side === side || w.seen) views.push({ id: -1, side: w.side, kind: w.kind, x: w.x, y: w.y, fx: w.fx, fy: w.fy, tx: w.fx, ty: w.fy, wreck: true });
  return views;
}

export function hashVehicles(m: Match, mix: Mix) {
  for (const v of m.vehicles) {
    for (const n of [v.x, v.y, v.fx, v.fy, v.hp]) mix(Math.round(n * 1000));
    for (const n of [...v.seats, +v.parked, v.deadAt, v.goal, v.departAt, v.target, v.coax, v.nextFire, v.laid, v.movedAt, v.halt]) mix(n);
    for (const b of v.bias) mix(Math.round(b * 1000));
    mix(v.rounds.length);
    for (const r of v.rounds) for (const n of [Math.round(r.x0 * 1000), Math.round(r.y0 * 1000), Math.round(r.x * 1000), Math.round(r.y * 1000), r.launch, r.land]) mix(n);
  }
  mix(m.wrecks.length);
  for (const w of m.wrecks) for (const n of [Math.round(w.x * 1000), Math.round(w.y * 1000), +w.seen]) mix(n);
}
