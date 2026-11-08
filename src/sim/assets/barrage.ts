// Artillery Barrage: after a warning, shells leave one by one over a few seconds and land at seeded spots round the target.
// Each is a projectile in the air for `barrageFlightSeconds`, then lands a Strike blast (strike.ts).
// Nobody dodges it (#58: a Squad in the zone is the Commander's mistake); the caller sees the enemies in it as Contacts
// from the first impact until `barrageContactSeconds` after the last.
import { dist2 } from '../geometry';
import { rnd } from '../rng';
import type { Mix } from '../state';
import type { Tune } from '../types';
import { assetRadio, type Kind } from './core';
import { blast } from './strike';

/** One shell: where it lands, the tick it leaves and the tick it lands. */
export interface Shell {
  x: number;
  y: number;
  launch: number;
  land: number;
  done: boolean;
}

/** The danger zone: shells land within the spread of the spot, and suppress out to their own reach beyond that. */
const zone = (t: Tune) => t.barrageSpreadM + t.barrageSuppressM;

export const barrage: Kind = {
  name: 'Barrage',
  cooldownSeconds: (t) => t.barrageCooldownSeconds,
  firstReadySeconds: (t) => t.barrageCooldownSeconds, // starts on cooldown, so the opening rush can't be shelled
  seconds: (t) => t.barrageWarningSeconds + (t.barrageShells > 1 ? t.barrageSpanSeconds : 0) + t.barrageFlightSeconds + t.barrageContactSeconds,
  radius: zone,

  start(m, e) {
    const t = m.tune;
    const n = t.barrageShells;
    const R = t.barrageSpreadM;
    e.shells = [];
    for (let i = 0; i < n; i++) {
      let dx: number;
      let dy: number;
      do {
        dx = (rnd(m) * 2 - 1) * R;
        dy = (rnd(m) * 2 - 1) * R;
      } while (dx * dx + dy * dy > R * R); // uniform over the disc, without trig
      const launch = m.tick + Math.round((t.barrageWarningSeconds + (n > 1 ? (i * t.barrageSpanSeconds) / (n - 1) : 0)) * t.hz);
      e.shells.push({ x: e.x + dx, y: e.y + dy, launch, land: launch + Math.round(t.barrageFlightSeconds * t.hz), done: false });
    }
  },

  work(m, e, events) {
    const t = m.tune;
    for (const shell of e.shells!) {
      if (shell.done || shell.land > m.tick) continue;
      shell.done = true;
      events.push({ kind: 'impact', side: e.side, x: shell.x, y: shell.y, asset: 'barrage' });
      if (!e.told) {
        e.told = true;
        assetRadio(m, e, 'Splash', events);
      }
      blast(m, e.side, shell, { killM: t.barrageKillM, woundM: t.barrageWoundM, suppressM: t.barrageSuppressM, suppression: t.barrageSuppression }, 'barrage', events, { damage: () => t.shellVehicleDamage });
    }
  },

  contacts(m, e) {
    if (!e.shells!.some((x) => x.done)) return [];
    const r = zone(m.tune);
    return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && dist2(s, e) <= r * r);
  },

  view(m, e) {
    const t = m.tune;
    const shells = e.shells!;
    return {
      shells: shells.filter((s) => !s.done && s.launch <= m.tick).map((s) => ({ x: s.x, y: s.y, flight: (m.tick - s.launch) / (s.land - s.launch) })),
      impactIn: shells.some((s) => s.done) ? 0 : Math.max(0, (shells[0]!.land - m.tick) / t.hz),
    };
  },

  hash(e, mix: Mix) {
    for (const s of e.shells!) for (const v of [Math.round(s.x * 1000), Math.round(s.y * 1000), s.launch, s.land, +s.done]) mix(v);
  },
};
