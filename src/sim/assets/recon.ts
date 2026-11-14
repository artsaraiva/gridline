// Recon Plane (#139): line recon beside the Scan UAV's loiter. Called with two taps, a point and a direction, and always
// available. At the call its Side's Recon Plane (a vehicle with nobody aboard, vehicles/lent.ts) wakes BEYOND_M outside the Play
// Area on the line through the point, flies the line at `reconSpeedMps` and leaves BEYOND_M past the far edge. Every tick it
// is over the Play Area, every enemy on foot and every enemy vehicle on the ground within `reconStripM` of it, outside their
// own HQ, is seen by every friendly Squad, as the Scan UAV's are: a Contact for that tick, a Last Known Position after, and a
// UAV assist if killed in the grace window (#75). It is in the sky, so both Sides' views carry the aircraft; the strip is its
// caller's alone. The enemy AA fires on it as on a drone: shot down, the reveal stops there. One a Side at a time.
import { dist2, inHq, insidePolygon } from '../geometry';
import { see } from '../memory';
import { vehicleOf, type Mix } from '../state';
import { high, live, sleep, wake } from '../vehicles';
import { assetRadio, inTheAir, shotDown, type Kind } from './core';

/** The pass starts and ends this far outside the Play Area: about a second and a half of flight, so it is at speed and on line as it crosses the edge. */
const BEYOND_M = 150;

export const recon: Kind = {
  name: 'Recon Plane',
  called: 'Recon pass inbound',
  sky: true,
  cooldownSeconds: (t) => t.reconCooldownSeconds,
  seconds: () => 0, // the pass is set at the call, by its length
  radius: (t) => t.reconStripM,
  line: (t) => ({ length: 0, width: 2 * t.reconStripM, across: true, beyond: BEYOND_M }),
  gate: (m, side) => inTheAir(m, side, 'recon'),

  start(m, e) {
    const t = m.tune;
    const d = Math.sqrt(dist2(e.from!, e.to!));
    const v = wake(m, m.vehicles.find((o) => o.kind === 'recon' && o.side === e.side)!, (e.to!.x - e.from!.x) / d, (e.to!.y - e.from!.y) / d, e.from!);
    Object.assign(e, { vehicle: v.id, phase: 'inbound', phaseAt: m.tick, launch: m.tick, land: m.tick + Math.max(1, Math.round((d / t.reconSpeedMps) * t.hz)), found: [] });
    e.until = e.land! + 1;
  },

  work(m, e, events) {
    if (e.phase === 'down') return;
    const t = m.tune;
    const v = vehicleOf(m, e.vehicle!)!;
    if (shotDown(m, e, v, 'Recon lost', events)) return; // the reveal stops here
    if (m.tick >= e.land!) {
      sleep(v);
      const n = e.found!.length;
      return assetRadio(m, e, `Recon pass complete, ${n ? `${n} hostile${n > 1 ? 's' : ''}` : 'no contacts'}`, events);
    }
    const k = (m.tick - e.launch!) / (e.land! - e.launch!);
    Object.assign(v, { x: e.from!.x + (e.to!.x - e.from!.x) * k, y: e.from!.y + (e.to!.y - e.from!.y) * k, movedAt: m.tick });
    if (!insidePolygon(m.map.playArea, v.x, v.y)) return;
    const r2 = t.reconStripM * t.reconStripM;
    const under = (o: { x: number; y: number; side: typeof e.side }) => o.side !== e.side && dist2(o, v) <= r2 && !inHq(m, o.side, o);
    const foot = m.soldiers.filter((s) => s.state === 'alive' && s.vehicle < 0 && under(s));
    const seen = (s: { id: number }) => m.sightings[e.side].some((o) => o.id === s.id && o.tick === m.tick);
    for (const s of foot) if (m.tick <= s.uavUntil || !seen(s)) s.uavUntil = m.tick + t.scoreUavGraceSeconds * t.hz; // #75, as the Scan UAV (assets/scan.ts)
    const found = [...foot, ...m.vehicles.filter((u) => live(u) && !high(u) && under(u))];
    for (const o of found) if (!e.found!.includes(o.id)) e.found!.push(o.id);
    for (const sq of m.squads) if (sq.side === e.side) for (const o of found) see(m, sq, o);
  },

  view(m, e, own) {
    const t = m.tune;
    const v = vehicleOf(m, e.vehicle!)!;
    const lost = e.phase === 'down';
    return {
      side: e.side,
      total: (e.land! - e.launch!) / t.hz,
      craft: { x: v.x, y: v.y, fx: v.fx, fy: v.fy, turn: 0 },
      ...(own && { from: e.from!, line: { to: e.to!, width: 2 * t.reconStripM } }),
      ...(lost && { lost }),
    };
  },

  hash(e, mix: Mix) {
    for (const n of [Math.round(e.from!.x * 1000), Math.round(e.from!.y * 1000), e.vehicle!, +(e.phase === 'down'), e.phaseAt!, e.launch!, e.land!, e.found!.length, ...e.found!]) mix(n);
  },
};
