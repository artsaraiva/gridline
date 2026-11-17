// The guns Soldiers on foot carry: a fixed roster, by place in the Squad. The Squad Leader has the assault rifle, the Launcher's
// carrier an SMG, the third an LMG, the fourth a DMR (in an Elite Squad a sniper rifle); a bigger Squad goes round again. A gun
// fires in bursts (`trigger`), reaches its own distance (`reach`) and, with a scope, takes on what other friendly eyes have found
// beyond its carrier's own sight (`spotted`). What each kind is like is Tune (`guns`).
import type { Match } from './index';
import { dist2, inHq } from './geometry';
import { los } from './grid';
import { rnd } from './rng';
import type { Soldier } from './state';
import type { GunKind, GunTune } from './types';

const ROSTER: GunKind[] = ['rifle', 'smg', 'lmg', 'dmr'];

/** The kind of gun `s` carries. */
export function gunOf(m: Match, s: Soldier): GunKind {
  const sq = m.squads[s.squad]!;
  const kind = ROSTER[sq.members.indexOf(s.id) % ROSTER.length]!;
  if (kind !== 'dmr') return kind;
  let before = 0;
  for (const o of m.squads) if (o.side === sq.side && o.id < sq.id) before++;
  return before < m.tune.eliteSquads ? 'sniper' : 'dmr'; // #153: the first `eliteSquads` of a Side
}

/** How far `g` reaches, squared, in square metres. */
export const reach2 = (m: Match, g: GunTune) => g.rangeMul * m.tune.fireRangeM * (g.rangeMul * m.tune.fireRangeM);

/**
 * `s` fires a round of `g`: the seconds until its next. A burst's first round draws its length and spends its ammunition; its last
 * is followed by the gun's pause, the others by its gap.
 */
export function trigger(m: Match, s: Soldier, g: GunTune): number {
  if (s.burst <= 0) {
    s.burst = g.burst[0] + Math.floor(rnd(m) * (g.burst[1] - g.burst[0] + 1));
    s.ammo -= g.ammo;
  }
  s.burst--;
  return s.burst > 0 ? g.gapSeconds : g.pauseSeconds[0] + rnd(m) * (g.pauseSeconds[1] - g.pauseSeconds[0]);
}

/**
 * With no enemy in its own sight, a gun that outreaches it (`visionM`) takes the nearest enemy Soldier any friendly eyes saw in the
 * last tick, within its reach and in its line of sight: the id, or -1. It adds no sighting: the Commander sees nothing new by it.
 */
export function spotted(m: Match, s: Soldier): number {
  const g = m.tune.guns[gunOf(m, s)];
  let best = -1;
  let bestD2 = reach2(m, g);
  if (bestD2 <= m.tune.visionM * m.tune.visionM) return -1;
  for (const o of m.sightings[s.side]) {
    const e = m.soldiers[o.id];
    if (!e || o.tick < m.tick - 1 || e.state !== 'alive' || e.vehicle >= 0 || e.chute) continue;
    const d2 = dist2(s, e);
    if (d2 >= bestD2 || inHq(m, e.side, e) || !los(m, s, e)) continue;
    best = e.id;
    bestD2 = d2;
  }
  return best;
}
