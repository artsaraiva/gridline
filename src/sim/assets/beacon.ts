// #142 Redeploy Beacon: a crate with a mast falls as the Supply Drop's does, then stays live for a while; a wiped Squad of its
// Side may Redeploy at it (respawn.ts redeployBeacon), unless a living enemy Soldier stands within `beaconDenyM`. One live beacon
// per Side: a new call replaces the old one. It is a thing on the ground: the enemy's Console carries it only while one of its
// Soldiers sees it, and an enemy who does nothing to it (v1). No Commander Score: an ordered capture by the Squad already scores.
import { looksAt } from '../perception';
import { assetRadio, type Kind } from './core';
import { beaconDenied, beaconTicks } from './crate';

export const beacon: Kind = {
  name: 'Redeploy Beacon',
  called: 'Beacon inbound',
  cooldownSeconds: (t) => t.beaconCooldownSeconds,
  firstReadySeconds: (t) => t.beaconCooldownSeconds,
  seconds: (t) => t.supplyFallSeconds + t.beaconSeconds,
  radius: (t) => t.beaconRingM,
  landsIn: (m, e) => Math.max(0, (e.until - m.tick - beaconTicks(m)) / m.tune.hz),
  fall: (t) => t.supplyFallSeconds,
  start(m, e) {
    m.assets.effects = m.assets.effects.filter((o) => o.asset !== 'beacon' || o.side !== e.side);
  },
  work(m, e, events) {
    if (e.until - m.tick === beaconTicks(m)) assetRadio(m, e, 'Beacon down', events);
  },
  seen: (m, e, side) => m.soldiers.some((s) => s.side === side && looksAt(m, s, e)),
  // the view's ring is the deny ring, drawn only while it is contested, and only for its own Side
  view: (m, e, own) => ({ side: e.side, radius: m.tune.beaconDenyM, ...(own && beaconDenied(m, e) && { contested: true as const }) }),
};
