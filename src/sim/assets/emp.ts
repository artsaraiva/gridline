// EMP Strike (#143): the first Denial Asset, switching off the vehicles round one spot for a while. Always available (no
// point gate), on a long cooldown that also starts the match; Squads never Request it. At the call a small missile leaves the
// caller's own HQ (as the Drone Strike does) and flies level and straight at the spot at `empSpeedMps`; it is in the sky, so
// both Sides' views carry it. Over the spot it bursts in the air: a flash, no crater, no blast. Every vehicle within
// `empRadiusM`, the caller's own too (the Commander's mistake), is held for `empSeconds` (vehicles/body.ts `held`): it neither moves
// nor fires. The jet flies on, and Soldiers, aboard or on foot, are untouched. The enemy vehicles it holds are Contacts for
// `barrageContactSeconds`. No Commander Score: there is nothing to measure without faking it.
import { dist2, inHq } from '../geometry';
import { see } from '../memory';
import { vehicleOf, type Mix } from '../state';
import { high, hold, live } from '../vehicles';
import { assetRadio, type EffectBase, type Flight, type Kind } from './core';

export interface EmpEffect extends EffectBase, Flight {
  asset: 'emp';
  found: number[] | null; // the enemy vehicles it holds, from its burst on (null before)
}

export const emp: Kind<EmpEffect> = {
  name: 'EMP Strike',
  called: 'EMP away',
  sky: true,
  cooldownSeconds: (t) => t.empCooldownSeconds,
  firstReadySeconds: (t) => t.empCooldownSeconds, // starts on cooldown, as the Drone Strike does
  seconds: (t) => t.empSeconds, // the flight is added at the call, by distance
  radius: (t) => t.empRadiusM,

  start(m, base) {
    const t = m.tune;
    const from = { x: m.map.hqs[base.side].x, y: m.map.hqs[base.side].y };
    const land = m.tick + Math.max(1, Math.round((Math.sqrt(dist2(from, base)) / t.empSpeedMps) * t.hz));
    return { ...base, asset: 'emp', from, launch: m.tick, land, found: null, until: land + Math.round(t.empSeconds * t.hz) };
  },

  work(m, e, events) {
    const t = m.tune;
    if (m.tick < e.land) return;
    if (!e.told) {
      e.told = true;
      const r = t.empRadiusM;
      // anything that flies as high as the jet is out of reach (cancelling a UAV is #57's); nothing reaches into an HQ, as nothing fires into one
      const hit = m.vehicles.filter((v) => live(v) && !high(v) && dist2(v, e) <= r * r && !inHq(m, v.side, v));
      for (const v of hit) hold(v, e.until);
      const found = hit.filter((v) => v.side !== e.side).map((v) => v.id);
      e.found = found;
      const n = found.length;
      assetRadio(m, e, `EMP effective, ${n ? `${n} vehicle${n > 1 ? 's' : ''}` : 'no vehicles'}`, events); // it counts the enemy's vehicles alone: the caller's own show held on the caller's map
    }
    if (m.tick - e.land >= Math.round(t.barrageContactSeconds * t.hz)) return;
    for (const sq of m.squads) if (sq.side === e.side) for (const v of (e.found ?? []).map((id) => vehicleOf(m, id)!)) if (live(v)) see(m, sq, v); // set at the burst, above
  },

  view(m, e) {
    const t = m.tune;
    return {
      side: e.side,
      from: e.from,
      flight: Math.min(1, (m.tick - e.launch) / (e.land - e.launch)),
      impactIn: Math.max(0, (e.land - m.tick) / t.hz),
      total: (e.until - e.launch) / t.hz,
      ...(e.told && { burst: (m.tick - e.land) / t.hz }),
    };
  },

  hash(e, mix: Mix) {
    for (const n of [Math.round(e.from.x * 1000), Math.round(e.from.y * 1000), e.launch, e.land, ...(e.found ? [e.found.length, ...e.found] : [-1])]) mix(n);
  },
};
