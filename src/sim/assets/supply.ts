// Supply Drop: a crate falls for a few seconds, then stays and refills ammo and slowly heals friendly Soldiers near it.
// Enemies get nothing from it. Squads low on ammo walk to the nearest landed friendly crate instead of the HQ (ai/squad.ts).
// #74: what it restores earns the caller Commander Score, capped per Soldier per drop.
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
    const cap = t.scoreSupplyCapPerRecipient;
    const given = (e.given ??= {});
    const open = (e.open ??= {});
    for (const s of m.soldiers) {
      if (s.side !== e.side) continue;
      let drew = 0;
      if (s.state === 'alive' && dist2(s, e) <= t.supplyRadiusM * t.supplyRadiusM) {
        const { hp, ammo } = s;
        s.ammo = t.ammo;
        s.rockets = t.rockets; // #107
        s.hp = Math.min(t.hp, s.hp + t.supplyHealPerSecond / t.hz);
        // #74 Commander Score: what the crate restored, capped per Soldier per drop; the ledger moves every tick
        const soFar = given[s.id] ?? 0;
        const pts = t.scoreSupplyPerFraction * ((s.hp - hp) / t.hp + (s.ammo - ammo) / t.ammo);
        if (pts > 0 && soFar < cap) {
          const next = Math.min(cap, soFar + pts);
          given[s.id] = next;
          drew = next - soFar;
          open[s.id] = (open[s.id] ?? 0) + drew;
          m.score[e.side].supply += drew;
        }
      }
      // The Console hears what a recipient drew when it stops drawing, reaches the cap, or the crate goes. A crate still
      // there at the end of the Match never announces its open points (the ledger and the end screen carry them anyway).
      if (open[s.id] && (!drew || given[s.id] === cap || e.until - m.tick === 1)) tell(m, e, s.id, events);
    }
  },
  hash(e, mix: Mix) {
    for (const r of [e.given, e.open]) for (const id in r) for (const v of [+id, Math.round(r[+id]! * 1000)]) mix(v); // integer keys enumerate in ascending order
  },
};

/** #74: the contribution message for what a recipient drew since the last one, naming the Squad. */
function tell(m: Match, e: Effect, id: number, events: SimEvent[]) {
  const s = m.soldiers[id]!;
  events.push({ kind: 'award', side: e.side, category: 'supply', points: e.open![id]!, reason: `Supply Drop resupplied ${squadName(m, m.squads[s.squad]!)}` });
  e.open![id] = 0;
}
