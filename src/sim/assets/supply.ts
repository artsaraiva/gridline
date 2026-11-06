// Supply Drop: a crate falls for a few seconds, then stays and refills ammo and slowly heals friendly Soldiers near it.
// Enemies get nothing from it. Squads low on ammo walk to the nearest landed friendly crate instead of the HQ (ai/squad.ts).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import { squadName, type Mix } from '../state';
import type { SimEvent } from '../types';
import { assetRadio, type Effect, type Kind } from './core';
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
    const given = (e.given ??= {});
    for (const s of m.soldiers) {
      if (s.side !== e.side || s.state !== 'alive' || dist2(s, e) > t.supplyRadiusM * t.supplyRadiusM) continue;
      const { hp, ammo } = s;
      s.ammo = t.ammo;
      s.hp = Math.min(t.hp, s.hp + t.supplyHealPerSecond / t.hz);
      // #74 Commander Score: what the crate restored, capped per Soldier per drop; the ledger moves every tick, the Console hears once
      const cap = t.scoreSupplyCapPerRecipient;
      const soFar = given[s.id] ?? 0;
      const pts = t.scoreSupplyPerFraction * ((s.hp - hp) / t.hp + (s.ammo - ammo) / t.ammo);
      if (pts <= 0 || soFar >= cap) continue;
      const next = Math.min(cap, soFar + pts);
      given[s.id] = next;
      m.score[e.side].supply += next - soFar;
      if (next === cap) tell(m, e, s.id, events);
    }
    if (e.until - m.tick === 1) for (const id in given) if (given[+id]! < t.scoreSupplyCapPerRecipient) tell(m, e, +id, events); // the crate's last tick: the rest hear theirs
  },
  hash(e, mix: Mix) {
    for (const id in e.given) for (const v of [+id, Math.round(e.given[+id]! * 1000)]) mix(v); // integer keys enumerate in ascending order
  },
};

/** #74: the one contribution message a recipient earns per drop, with everything it drew. */
function tell(m: Match, e: Effect, id: number, events: SimEvent[]) {
  const s = m.soldiers[id]!;
  events.push({ kind: 'award', side: e.side, category: 'supply', points: e.given![id]!, reason: `Supply Drop resupplied ${squadName(m, m.squads[s.squad]!)}` });
}
