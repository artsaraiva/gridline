// Scan UAV: circles its spot and reveals every enemy near it, live, into every friendly Squad's memory and the Side's
// sightings, so they are Contacts while it works and Last Known Positions after. Enemies inside their own HQ stay hidden.
import { dist2, inHq } from '../geometry';
import { see } from '../memory';
import { assetRadio, type Kind } from './core';

export const scan: Kind = {
  name: 'Scan UAV',
  cooldownSeconds: (t) => t.scanCooldownSeconds,
  seconds: (t) => t.scanSeconds,
  radius: (t) => t.scanRadiusM,
  work(m, e, events) {
    const r = m.tune.scanRadiusM;
    const found = m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && dist2(s, e) <= r * r && !inHq(m, s.side, s));
    for (const sq of m.squads) if (sq.side === e.side) for (const s of found) see(m, sq, s);
    if (found.length && !e.told) assetRadio(m, e, `UAV eyes on ${found.length} hostile${found.length > 1 ? 's' : ''}`, events);
    else if (!e.told && e.until === m.tick + 1) assetRadio(m, e, 'UAV off station, no contacts', events);
    else return;
    e.told = true;
  },
};
