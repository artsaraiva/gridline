// Feint (#143, was #144): the Denial Asset that fools the enemy's ears. A dummy paratrooper, a sack doll with firecrackers
// strapped to it (the SAS's "Rupert" of D-Day), falls under its canopy as the Supply crate does. Always available (no point
// gate), on a cooldown that also starts the match; Squads never Request it. From its landing, for `feintSeconds`, it fires a
// burst every `feintBurstSeconds`: a shot at nobody from its dummy (crate.ts `dummyOf`), which the gunfire phase hears as real
// fire (memory.ts `hear`), so the enemy Squads near it act as under fire: they bound, and fire back at it when suppressed.
import type { Match } from '../index';
import { seeThrough } from '../memory';
import { looksAt } from '../perception';
import type { Mix } from '../state';
import { assetRadio, type Effect, type Kind } from './core';
import { feintTicks } from './crate';

/** The tick the dummy lands, and its first burst goes off. */
const landing = (m: Match, e: Effect) => e.until - feintTicks(m);
const burstTicks = (m: Match) => Math.round(m.tune.feintBurstSeconds * m.tune.hz);

export const feint: Kind = {
  name: 'Feint',
  called: 'Decoy inbound',
  cooldownSeconds: (t) => t.feintCooldownSeconds,
  firstReadySeconds: (t) => t.feintCooldownSeconds,
  seconds: (t) => t.supplyFallSeconds + t.feintSeconds,
  radius: (t) => t.feintRingM,
  landsIn: (m, e) => Math.max(0, (e.until - m.tick - feintTicks(m)) / m.tune.hz),
  fall: (t) => t.supplyFallSeconds,

  start(m, e) {
    e.dummy = m.soldiers.length + m.vehicles.length + m.assets.dummies++;
  },

  work(m, e, events) {
    const since = m.tick - landing(m, e);
    if (since < 0) return; // a parachute coming down is a paratrooper to anyone: only the landed dummy is seen for what it is
    if (since === 0) assetRadio(m, e, 'Decoy active', events);
    for (const sq of m.squads) if (sq.side !== e.side && !sq.dud.includes(e.dummy!) && sq.members.some((id) => looksAt(m, m.soldiers[id]!, e))) seeThrough(sq, e.dummy!);
    if (since % burstTicks(m) === 0) events.push({ kind: 'shot', side: e.side, from: e.dummy!, to: -1, hit: false });
    if (e.until === m.tick + 1) for (const sq of m.squads) sq.dud = sq.dud.filter((id) => id !== e.dummy); // it is gone: nothing left to tell apart
  },

  // the fall is in the sky, for both Sides to see; once down, the enemy's Console carries it only while one of its Soldiers sees it
  seen: (m, e, side) => m.tick < landing(m, e) || m.soldiers.some((s) => s.side === side && looksAt(m, s, e)),
  // its own Console's pulse: the seconds since its last burst (the steps have run to `m.tick - 1`); the enemy's has no pulse to show
  view(m, e, own) {
    const since = m.tick - landing(m, e);
    return { side: e.side, ...(own && since > 0 && { burst: (((since - 1) % burstTicks(m)) + 1) / m.tune.hz }) };
  },

  hash(e, mix: Mix) {
    mix(e.dummy!);
  },
};
