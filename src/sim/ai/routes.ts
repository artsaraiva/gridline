// Which crossing a Squad takes when the water is between it and its Capture Point.
import type { Match } from '../index';
import { isDummy } from '../assets/crate';
import { dist2 } from '../geometry';
import { sideKnown } from '../memory';
import { rnd } from '../rng';
import type { Mix, Squad } from '../state';
import type { SideId, Vec2 } from '../types';
import { across, crossingFlow, flowDist, pointFlow } from './flow';

/** A Soldier death, kept `routeLossSeconds` so Squads steer clear of crossings that cost them. */
export interface Death {
  side: SideId;
  x: number;
  y: number;
  tick: number;
}

export function logDeath(m: Match, d: Death) {
  const t = m.tune;
  m.deaths = m.deaths.filter((o) => m.tick - o.tick < t.routeLossSeconds * t.hz);
  m.deaths.push(d);
}

export function hashDeaths(m: Match, mix: Mix) {
  mix(m.deaths.length);
  for (const d of m.deaths) {
    mix(Math.round(d.x * 1000));
    mix(Math.round(d.y * 1000));
    mix(d.tick);
  }
}

/**
 * Sets `sq.route` for heading from `from` to point `p`. Each crossing's route is its length, plus `routeSeenM` per enemy the Side
 * saw (#143: or Feint dummy it heard) near it lately, `routeLossM` per own death near it lately and `routeMateM` per other own Squad taking it to the same point,
 * plus seeded jitter; routes more than `routeMaxDetourM` longer than the shortest are dropped. #156: a crossing marked
 * `centreFight` takes no danger; every other one does, bridges included.
 * No route when the crossing makes no difference (the point is on this bank). #151: a route's length is the way to the middle of its
 * crossing's deck plus the point's own field from there.
 */
export function chooseRoute(m: Match, sq: Squad, from: Vec2, p: number) {
  const t = m.tune;
  const crossings = m.map.crossings ?? [];
  Object.assign(sq, { route: -1, crossed: false });
  if (!across(m, p, from)) return; // #151: the point is on this bank
  const pf = pointFlow(m, p);
  const lengths = crossings.map((c, i) => flowDist(m, crossingFlow(m, i), from) + flowDist(m, pf, c));
  const reachable = lengths.filter((d) => d < Infinity);
  if (reachable.length < 2) return;
  const shortest = Math.min(...reachable);
  if (Math.max(...reachable) - shortest < 10) return;
  const near = (a: Vec2, b: Vec2, r: number) => dist2(a, b) < r * r;
  let best = Infinity;
  crossings.forEach((c, i) => {
    if (!(lengths[i]! <= shortest + t.routeMaxDetourM)) return;
    const danger = !c.centreFight;
    const seen = new Set<number>();
    if (danger)
      for (const s of sideKnown(m, sq.side))
        if ((s.source === 'seen' || (s.source === 'heard' && isDummy(m, s.id))) && m.tick - s.tick < t.routeSeenSeconds * t.hz && near(s, c, t.routeSeenRadiusM)) seen.add(s.id); // #143: a Feint's dummy going off is skirted (its spec took heard fire for skirted already; real heard fire still is not)
    const lost = danger
      ? m.deaths.filter((d) => d.side === sq.side && m.tick - d.tick < t.routeLossSeconds * t.hz && near(d, c, t.routeLossRadiusM)).length
      : 0;
    const mates = m.squads.filter((o) => o !== sq && o.side === sq.side && o.task === 'point' && o.goal === p && o.route === i).length;
    const v = lengths[i]! + t.routeSeenM * seen.size + t.routeLossM * lost + t.routeMateM * mates + t.routeJitterM * (rnd(m) * 2 - 1);
    if (v < best) {
      best = v;
      sq.route = i;
    }
  });
}
