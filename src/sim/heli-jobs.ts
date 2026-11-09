// #131: what a piloted helicopter does: `decideJob` takes the first job that applies at its pilot's Squad think (bail, repair,
// ferry, support, else wait); `circle` is the path of Support and of a hot drop, `glide` the bail-out, `repairOnPad` the repair.
// The flight itself (`fly`, `cruise`, `plan`) stays in `vehicles.ts`, which calls back here.
import type { Match } from './index';
import { between, rnd } from './rng';
import { dist2 } from './geometry';
import { landingZone } from './flight';
import { sideKnown } from './memory';
import { turnToward, approach } from './momentum';
import { membersOf, ticksOf, type Point, type Soldier, type Squad } from './state';
import type { Vec2 } from './types';
import { clearOfHq, crippled, fitsRide, getOut, jump, onPad, plan, riders, specOf, wreck, type Vehicle } from './vehicles';

const squared = (r: number) => r * r;

/** #131: a helicopter's jobs, best first except Wait. */
export const JOBS = ['wait', 'support', 'ferry', 'repair', 'bail'] as const;
export type Job = (typeof JOBS)[number];

/**
 * #131, at its pilot's Squad think, the first job that applies: Bail (under a third of its hit points, off its pad): everyone aboard,
 * crew too, jumps, and it glides on for `crashSeconds` (`glide`). Repair (under `heliRepairBelow`, and then until full): its passengers
 * jump where they are, it flies home. Ferry: carrying passengers, or a Squad on foot calls it (`callers`): it flies to a pickup Landing
 * Zone by one of them. Support: with a gunner aboard, it circles a point with known enemies. Else Wait. Not while it hovers to land.
 */
export function decideJob(m: Match, v: Vehicle) {
  const t = m.tune;
  if (v.job === 'bail' || v.flareUntil >= 0) return;
  const max = specOf(t, v.kind).hp;
  const aboard = riders(m, v);
  const pax = aboard.filter((s) => !s.crew);
  const set = (job: Job, o: Partial<Vehicle> = {}) => {
    Object.assign(v, { job, fetch: -1, spot: null, drop: false, until: -1, ...o });
    if (v.airborne) plan(m, v);
  };
  if (crippled(m, v) && !onPad(v)) {
    Object.assign(v, { job: 'bail', claim: -1, fetch: -1, spot: null, drop: false, crashAt: m.tick + (v.airborne ? ticksOf(t, t.crashSeconds) : 0) });
    for (const s of aboard) v.airborne ? jump(m, s) : getOut(m, s, v);
    return;
  }
  if (v.job === 'repair' ? v.hp < max : v.hp < t.heliRepairBelow * max) {
    if (v.job !== 'repair') {
      if (v.airborne) for (const s of pax) jump(m, s);
      set('repair', { claim: -1 });
    }
    return;
  }
  if (pax.length || v.claim >= 0) {
    if (v.job !== 'ferry') set('ferry');
    return;
  }
  const calling = callers(m, v);
  if (v.job === 'ferry' && calling.some((c) => c.sq.id === v.fetch)) return;
  if (calling.length) {
    const near = calling.map((c) => 1 / Math.max(50, Math.sqrt(dist2(c.L, v)))); // the nearest likeliest
    let r = rnd(m) * near.reduce((a, w) => a + w, 0);
    const { sq, L } = calling[Math.max(0, near.findIndex((w) => (r -= w) < 0))]!;
    return set('ferry', { fetch: sq.id, spot: landingZone(m, L, sq.memory, (p) => clearOfHq(m, v.side, p, 1)) });
  }
  if (v.seats[1]! >= 0 || v.seats[2]! >= 0) {
    if (v.job === 'support' && v.spot && m.tick < v.until) return;
    const p = supportPoint(m, v);
    if (p) return set('support', { spot: { x: p.x, y: p.y }, spin: spinFor(m, v), until: m.tick + ticksOf(t, between(m, t.commitSeconds)) });
  }
  if (v.job !== 'wait') set('wait');
}

/** #131: the friendly Squads on foot whose goal is a long ride (#122) with no vehicle that fits within `boardM`, and the foot leader of each. A Squad `v` is fetching stays one. */
export function callers(m: Match, v: Vehicle): { sq: Squad; L: Soldier }[] {
  const t = m.tune;
  return m.squads.flatMap((sq) => {
    const p = m.points[sq.goal];
    const alive = membersOf(m, sq).filter((s) => s.state === 'alive');
    const body = alive.filter((s) => !s.detached);
    const L = body[0];
    if (!L || !p || sq.side !== v.side || sq.task !== 'point' || alive.some((s) => !s.crew && (s.boarding >= 0 || s.vehicle >= 0)) || m.vehicles.some((o) => o.claim === sq.id)) return [];
    if (dist2(L, p) <= squared(sq.rideM) || (dist2(L, p) <= squared(t.heliFitM) && sq.route < 0)) return [];
    return v.fetch === sq.id || !m.vehicles.some((o) => fitsRide(m, sq, body, L, o, p, false)) ? [{ sq, L }] : [];
  });
}

/**
 * #131: the Capture Point a helicopter circles, null = none: one any friendly Squad knows enemies at (within `threatenedM` of its
 * radius), an own point first, else the one most friendly Squads are heading for; drawn weighted among those within one of the best.
 */
export function supportPoint(m: Match, v: Vehicle): Point | null {
  const known = sideKnown(m, v.side);
  const scored = m.points.flatMap((p, i) =>
    known.some((e) => dist2(e, p) <= squared(p.radius + m.tune.threatenedM)) ? [{ p, score: (p.owner === v.side ? 100 : 0) + m.squads.filter((q) => q.side === v.side && q.task === 'point' && q.goal === i).length }] : [],
  );
  const top = Math.max(...scored.map((c) => c.score));
  const near = scored.filter((c) => c.score >= top - 1);
  let r = rnd(m) * near.reduce((a, c) => a + c.score - top + 2, 0);
  return near.length ? near[Math.max(0, near.findIndex((c) => (r -= c.score - top + 2) < 0))]!.p : null;
}

/** #131: which way round a helicopter circles: with one gun manned, the way that keeps that side to the centre; else seeded. */
export function spinFor(m: Match, v: Vehicle): number {
  const left = v.seats[1]! >= 0;
  return left === v.seats[2]! >= 0 ? (rnd(m) < 0.5 ? 1 : -1) : left ? 1 : -1;
}

/** #131: on its helipad under `heliRepairBelow` it repairs, with or without a pilot; and regains `heliRepairHpPerS` until full, then it is free for work. */
export function repairOnPad(m: Match, v: Vehicle) {
  const t = m.tune;
  const max = specOf(t, v.kind).hp;
  if (!onPad(v)) return;
  if (v.job !== 'repair' && v.hp < t.heliRepairBelow * max) Object.assign(v, { job: 'repair', claim: -1, fetch: -1, spot: null, drop: false, until: -1 });
  if (v.job !== 'repair') return;
  v.hp = Math.min(max, v.hp + t.heliRepairHpPerS / t.hz);
  if (v.hp >= max) v.job = 'wait';
}

/** #131: a helicopter bailed out of flies on as it was until `crashAt`, then hits the ground where it is: a Wreck, empty, nobody hurt. */
export function glide(m: Match, v: Vehicle) {
  if (m.tick >= v.crashAt) return wreck(m, v);
  const at = clearOfHq(m, v.side, { x: v.x + (v.fx * v.speed) / m.tune.hz, y: v.y + (v.fy * v.speed) / m.tune.hz });
  Object.assign(v, { x: at.x, y: at.y, movedAt: m.tick });
}

/**
 * #131: one tick circling `c` at `orbitM` and `orbitMps`, the way round `spin` says. It steers toward the circle's tangent bent inward or outward by how far it
 * is off the circle (dot products and `Math.sqrt` only, no trig), at `heliMps` while still more than two circles out. A turn is by at most `heliTurnDegPerS`.
 */
export function circle(m: Match, v: Vehicle, c: Vec2) {
  const t = m.tune;
  const [rx, ry] = [v.x - c.x, v.y - c.y];
  const r = Math.sqrt(rx * rx + ry * ry) || 1e-6;
  const off = Math.max(-3, Math.min(3, (t.orbitM - r) / t.orbitM)); // + inside the circle: bends outward
  const [tx, ty] = [(-ry / r) * v.spin + (off * rx) / r, (rx / r) * v.spin + (off * ry) / r];
  const n = Math.sqrt(tx * tx + ty * ty); // at least 1: the tangent and the radius are at right angles
  const { fx, fy } = turnToward(v.fx, v.fy, tx / n, ty / n, t.heliTurnDegPerS, t.hz);
  const speed = approach(v.speed, r > 2 * t.orbitM ? t.heliMps : t.orbitMps, t.heliAccel, 1, t.hz);
  const at = clearOfHq(m, v.side, { x: v.x + (fx * speed) / t.hz, y: v.y + (fy * speed) / t.hz });
  Object.assign(v, { x: at.x, y: at.y, fx, fy, speed, movedAt: m.tick });
}
