// Cruise Missile (#99): one heavy precise blast. Usable only while the caller holds every keystone Capture Point (#150: the
// map's `keystone`, else the one nearest the map centre); the cooldown runs regardless, and losing one mid-flight changes nothing. At the call
// it leaves at once from beyond the Play Area behind the caller's HQ and flies level and straight at the spot; the
// flight is its warning, and it is in the sky, so both Sides' views carry it.
import type { Match } from '../index';
import { dist2, keystone, launchPoint } from '../geometry';
import type { Mix } from '../state';
import type { SideId } from '../types';
import { assetRadio, type Effect, type Kind } from './core';
import { blast } from './strike';

const CENTRE = { x: 0, y: 0 };
/** Why `side` can't call a heavy Asset (this, #101 the Gunship) now: it needs every keystone Capture Point (#150); null when it may. */
export function heavyGate(m: Match, side: SideId): string | null {
  if (!m.tune.missileGated) return null;
  const keys = keystone(m);
  const missing = keys.filter((p) => p.owner !== side).map((p) => p.name);
  return !keys.length ? 'no Capture Point' : missing.length ? `needs ${missing.join(', ')}` : null;
}

const flight = (m: Match, e: Effect) => Math.min(1, (m.tick - e.launch!) / (e.land! - e.launch!));

export const missile: Kind = {
  name: 'Missile',
  called: 'Missile away',
  sky: true,
  cooldownSeconds: (t) => t.missileCooldownSeconds,
  firstReadySeconds: (t) => t.missileCooldownSeconds, // starts on cooldown, as the Barrage does
  seconds: (t) => t.barrageContactSeconds, // the flight is added at the call, by distance
  radius: (t) => t.missileSuppressM,
  gate: heavyGate,

  start(m, e) {
    const t = m.tune;
    e.from = launchPoint(m, e.side);
    e.launch = m.tick;
    e.land = m.tick + Math.max(1, Math.round((Math.sqrt(dist2(e.from, e)) / t.missileSpeedMps) * t.hz));
    e.until = e.land + Math.round(t.barrageContactSeconds * t.hz);
  },

  work(m, e, events) {
    if (e.told || e.land! > m.tick) return;
    e.told = true;
    events.push({ kind: 'impact', side: e.side, x: e.x, y: e.y, asset: 'missile' });
    assetRadio(m, e, 'Splash', events);
    const t = m.tune;
    blast(m, e.side, e, { killM: t.missileKillM, woundM: t.missileWoundM, suppressM: t.missileSuppressM, suppression: t.missileSuppression }, 'missile', events, { damage: () => Infinity }); // #107: destroys outright
  },

  contacts(m, e) {
    if (!e.told) return [];
    const r = m.tune.missileSuppressM;
    return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && dist2(s, e) <= r * r);
  },

  view(m, e) {
    const t = m.tune;
    return { side: e.side, from: e.from!, flight: flight(m, e), impactIn: Math.max(0, (e.land! - m.tick) / t.hz), total: (e.until - e.launch!) / t.hz };
  },

  hash(e, mix: Mix) {
    for (const v of [Math.round(e.from!.x * 1000), Math.round(e.from!.y * 1000), e.launch!, e.land!]) mix(v);
  },
};
