// Cruise Missile (#99): one heavy precise blast. Usable only while the caller holds the middle Capture Point (the one
// nearest the map centre); the cooldown runs regardless, and losing the point mid-flight changes nothing. At the call
// it leaves at once from beyond the Play Area behind the caller's HQ and flies level and straight at the spot; the
// flight is its warning, and it is in the sky, so both Sides' views carry it.
import type { Match } from '../index';
import { dist2 } from '../geometry';
import type { Mix } from '../state';
import type { Vec2 } from '../types';
import { assetRadio, type Effect, type Kind } from './core';
import { blast } from './strike';

const CENTRE = { x: 0, y: 0 };
/** The launch point sits this far beyond the Play Area edge. */
const BEYOND_M = 1100;

/** The middle Capture Point: the one nearest the map centre (Lane 2 on Kaltenbach); undefined on a map with none. */
export const middlePoint = (m: Match) => m.points.reduce<Match['points'][number] | undefined>((a, p) => (!a || dist2(p, CENTRE) < dist2(a, CENTRE) ? p : a), undefined);

/** Where the ray from the map centre through `side`'s HQ leaves the Play Area, BEYOND_M further on. */
export function launchPoint(m: Match, side: 'nato' | 'pact'): Vec2 {
  const d = m.map.hqs[side];
  const poly = m.map.playArea;
  let far = 1; // the HQ itself, should the ray miss every edge
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const ex = poly[i]!.x - a.x;
    const ey = poly[i]!.y - a.y;
    const denom = d.x * ey - d.y * ex;
    if (denom === 0) continue;
    const t = (a.x * ey - a.y * ex) / denom;
    const u = (a.x * d.y - a.y * d.x) / denom;
    if (u >= 0 && u <= 1 && t > far) far = t;
  }
  const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
  return { x: d.x * far + (d.x / len) * BEYOND_M, y: d.y * far + (d.y / len) * BEYOND_M };
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
  gate(m, side) {
    if (!m.tune.missileGated) return null;
    const p = middlePoint(m);
    return !p ? 'no Capture Point' : p.owner === side ? null : `needs ${p.name}`;
  },

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
