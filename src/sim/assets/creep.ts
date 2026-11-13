// Creeping Barrage (#138): a line Strike that moves. After a warning, shells land one after the other along the line the
// Commander drew, each a step further on and scattered a little off it: a wall of suppression more than a kill box. Each is a
// lighter Barrage shell (strike.ts); the enemies near one that has landed are Contacts for `barrageContactSeconds`.
// The shells in flight are in the sky, so in both Sides' views; the strip is the caller's alone.
import { dist2 } from '../geometry';
import { rnd } from '../rng';
import type { Mix } from '../state';
import type { Tune } from '../types';
import { flying, hashShells } from './barrage';
import { assetRadio, type Kind } from './core';
import { blast } from './strike';

/** How far to either side of the line a Soldier is in danger: a shell's scatter and its suppression beyond that. */
const reach = (t: Tune) => t.creepScatterM + t.creepSuppressM;

export const creep: Kind = {
  name: 'Creeping Barrage',
  called: 'Creeping fire inbound',
  sky: true,
  cooldownSeconds: (t) => t.creepCooldownSeconds,
  firstReadySeconds: (t) => t.creepCooldownSeconds, // starts on cooldown, as the Barrage does
  seconds: (t) => t.creepWarningSeconds + (t.creepShells - 1) * t.creepStepSeconds + t.barrageContactSeconds,
  radius: reach,
  line: (t) => ({ length: t.creepLengthM, width: 2 * reach(t) }),

  start(m, e) {
    const t = m.tune;
    const ux = (e.to!.x - e.x) / t.creepLengthM;
    const uy = (e.to!.y - e.y) / t.creepLengthM;
    e.shells = [];
    for (let i = 0; i < t.creepShells; i++) {
      const along = i * t.creepStepM;
      const off = (rnd(m) * 2 - 1) * t.creepScatterM; // to the left of the line, or the right
      const land = m.tick + Math.round((t.creepWarningSeconds + i * t.creepStepSeconds) * t.hz);
      e.shells.push({ x: e.x + ux * along - uy * off, y: e.y + uy * along + ux * off, launch: land - Math.round(t.barrageFlightSeconds * t.hz), land, done: false });
    }
  },

  work(m, e, events) {
    const t = m.tune;
    for (const shell of e.shells!) {
      if (shell.done || shell.land > m.tick) continue;
      shell.done = true;
      events.push({ kind: 'impact', side: e.side, x: shell.x, y: shell.y, asset: 'creep' });
      if (!e.told) {
        e.told = true;
        assetRadio(m, e, 'Splash', events);
      }
      blast(m, e.side, shell, { killM: t.creepKillM, woundM: t.creepWoundM, suppressM: t.creepSuppressM, suppression: t.creepSuppression }, 'creep', events, { damage: (v) => (v.airborne ? 0 : t.shellVehicleDamage) });
    }
  },

  contacts(m, e) {
    const t = m.tune;
    const r2 = t.creepSuppressM * t.creepSuppressM;
    const fresh = e.shells!.filter((s) => s.done && m.tick - s.land < t.barrageContactSeconds * t.hz);
    return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && fresh.some((x) => dist2(s, x) <= r2));
  },

  view(m, e, own) {
    const { shells, impactIn } = flying(m, e.shells!);
    return { side: e.side, shells, ...(own && { impactIn, line: { to: e.to!, width: 2 * reach(m.tune) } }) };
  },

  hash: (e, mix: Mix) => hashShells(e.shells!, mix),
};
