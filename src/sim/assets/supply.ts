// Supply Drop: a crate falls for a few seconds, then stays and refills ammo and slowly heals friendly Soldiers near it.
// Enemies get nothing from it. Squads low on ammo walk to the nearest landed friendly crate instead of the HQ (ai/squad.ts).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import { assetRadio, type Kind } from './core';
import { landed, stayTicks } from './crate';

export const supply: Kind = {
  name: 'Supply Drop',
  cooldownSeconds: (t) => t.supplyCooldownSeconds,
  seconds: (t) => t.supplyFallSeconds + t.supplyStaySeconds,
  radius: (t) => t.supplyRadiusM,
  landsIn: (m, e) => Math.max(0, (e.until - m.tick - stayTicks(m)) / m.tune.hz),
  fall: (t) => t.supplyFallSeconds,
  work(m, e, events) {
    if (!landed(m, e)) return;
    if (e.until - m.tick === stayTicks(m)) assetRadio(m, e, 'Supply Drop landed', events);
    const t = m.tune;
    for (const s of m.soldiers) {
      if (s.side !== e.side || s.state !== 'alive' || dist2(s, e) > t.supplyRadiusM * t.supplyRadiusM) continue;
      s.ammo = t.ammo;
      s.hp = Math.min(t.hp, s.hp + t.supplyHealPerSecond / t.hz);
    }
  },
};
