// Scan UAV: circles its spot and reveals every enemy near it, live, into every friendly Squad's memory and the Side's
// sightings, so they are Contacts while it works and Last Known Positions after. Enemies inside their own HQ stay hidden.
// #75: an enemy it reveals while no friendly Soldier sees it is UAV-discovered, for as long as a UAV keeps revealing it
// and `scoreUavGraceSeconds` beyond (whether or not Soldiers took over the watch); a kill fixed in that window scores
// the caller a UAV assist (combat.ts die). Perception ran this tick already, so a sighting from this tick is a Soldier's
// (or an earlier UAV's, which discovered it first).
import { dist2, inHq } from '../geometry';
import { see } from '../memory';
import { assetRadio, type Kind } from './core';

export const scan: Kind = {
  name: 'Scan UAV',
  cooldownSeconds: (t) => t.scanCooldownSeconds,
  seconds: (t) => t.scanSeconds,
  radius: (t) => t.scanRadiusM,
  work(m, e, events) {
    const t = m.tune;
    const r = t.scanRadiusM;
    const found = m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && dist2(s, e) <= r * r && !inHq(m, s.side, s));
    const seen = (s: { id: number }) => m.sightings[e.side].some((o) => o.id === s.id && o.tick === m.tick);
    for (const s of found) if (m.tick <= s.uavUntil || !seen(s)) s.uavUntil = m.tick + t.scoreUavGraceSeconds * t.hz; // #75
    for (const sq of m.squads) if (sq.side === e.side) for (const s of found) see(m, sq, s);
    // #85: the UAV is on station from the call (the Console draws it in orbit from its first tick), so it says so on that tick
    if (e.until - m.tick === Math.round(t.scanSeconds * t.hz)) assetRadio(m, e, 'UAV on station', events);
    if (found.length && !e.told) {
      assetRadio(m, e, `UAV eyes on ${found.length} hostile${found.length > 1 ? 's' : ''}`, events);
      e.told = true;
    }
    if (e.until === m.tick + 1) assetRadio(m, e, e.told ? 'UAV off station' : 'UAV off station, no contacts', events); // #85: said either way
  },
};
