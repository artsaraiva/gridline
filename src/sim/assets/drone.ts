// Drone Strike (#139): a light, precise Strike beside the heavy Cruise Missile. Always available (no point gate), on a short
// cooldown that also starts the match. At the call its Side's drone (a vehicle with nobody aboard, vehicles/lent.ts) wakes at the
// caller's HQ and flies level and straight at the spot at `droneSpeedMps`: the flight is its warning, and it is in the sky, so
// both Sides' views carry it. There it lands one small blast, friend or foe; the enemies in the suppress ring are Contacts for
// `barrageContactSeconds`. The enemy AA fires on it as on anything that flies (after a jet and a helicopter): at 0 hit points it
// falls where it was with no blast, and the cooldown stands. One a Side at a time.
import { dist2 } from '../geometry';
import { vehicleOf, type Mix } from '../state';
import { borrow, release, steer } from '../vehicles';
import { assetRadio, inTheAir, shotDown, type Kind } from './core';
import { blast } from '../damage';

export const drone: Kind = {
  name: 'Drone Strike',
  called: 'Drone away',
  sky: true,
  cooldownSeconds: (t) => t.droneCooldownSeconds,
  firstReadySeconds: (t) => t.droneCooldownSeconds, // starts on cooldown, as the Barrage does
  seconds: (t) => t.barrageContactSeconds, // the flight is added at the call, by distance
  radius: (t) => t.droneSuppressM,
  gate: (m, side) => inTheAir(m, side, 'drone'), // on a map wider than its cooldown flies, the next waits for this one

  start(m, e) {
    const t = m.tune;
    const from = { x: m.map.hqs[e.side].x, y: m.map.hqs[e.side].y };
    const d = Math.sqrt(dist2(from, e)) || 1;
    const v = borrow(m, e.side, 'drone', from, { fx: (e.x - from.x) / d, fy: (e.y - from.y) / d });
    Object.assign(e, { from, vehicle: v.id, phase: 'inbound', phaseAt: m.tick, launch: m.tick, land: m.tick + Math.max(1, Math.round((d / t.droneSpeedMps) * t.hz)) });
    e.until = e.land! + Math.round(t.barrageContactSeconds * t.hz);
  },

  work(m, e, events) {
    if (e.told || e.phase === 'down') return;
    const t = m.tune;
    const v = vehicleOf(m, e.vehicle!)!;
    if (shotDown(m, e, v, 'Drone lost', events)) return; // it falls where it was, with no blast
    if (m.tick < e.land!) {
      const k = (m.tick - e.launch!) / (e.land! - e.launch!);
      return steer(m, v, { x: e.from!.x + (e.x - e.from!.x) * k, y: e.from!.y + (e.y - e.from!.y) * k });
    }
    e.told = true;
    release(v);
    events.push({ kind: 'impact', side: e.side, x: e.x, y: e.y, asset: 'drone' });
    assetRadio(m, e, 'Splash', events);
    // The spec's 50 "kills a jeep, half a tank", but a jeep has 60 hit points: a jeep is destroyed outright, as by a tank's round
    blast(m, e.side, e, { killM: t.droneKillM, woundM: t.droneWoundM, suppressM: t.droneSuppressM, suppression: t.droneSuppression }, 'drone', events, { damage: (u) => (u.airborne ? 0 : u.kind === 'jeep' ? Infinity : t.droneVehicleDamage) });
  },

  contacts(m, e) {
    if (!e.told) return [];
    const r = m.tune.droneSuppressM;
    return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && dist2(s, e) <= r * r);
  },

  view(m, e) {
    const t = m.tune;
    const v = vehicleOf(m, e.vehicle!)!;
    const lost = e.phase === 'down';
    return {
      side: e.side,
      from: e.from!,
      flight: Math.min(1, ((lost ? e.phaseAt! : m.tick) - e.launch!) / (e.land! - e.launch!)),
      impactIn: lost ? 0 : Math.max(0, (e.land! - m.tick) / t.hz),
      total: (e.until - e.launch!) / t.hz,
      ...(!e.told && { craft: { x: v.x, y: v.y, fx: v.fx, fy: v.fy, turn: 0 } }),
      ...(lost && { lost }),
    };
  },

  hash(e, mix: Mix) {
    for (const n of [Math.round(e.from!.x * 1000), Math.round(e.from!.y * 1000), e.vehicle!, +(e.phase === 'down'), e.phaseAt!, e.launch!, e.land!]) mix(n);
  },
};
