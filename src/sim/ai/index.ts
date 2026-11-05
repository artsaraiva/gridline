// Squad AI (#34): the Squad layer thinks (squad.ts), the Soldier layer walks (soldier.ts).
import type { Match } from '../index';
import { rnd } from '../rng';
import type { Mix, Soldier, Squad } from '../state';
import { hashDeaths } from './routes';

export { think } from './squad';
export { walk } from './soldier';
export { logDeath, type Death } from './routes';

type SquadAi = Omit<Squad, 'id' | 'side' | 'members' | 'goal' | 'lastSeen' | 'memory'>;
type SoldierAi = Pick<Soldier, 'ammo' | 'lastTarget' | 'dest' | 'path' | 'cover' | 'chaseUntil' | 'role' | 'regroup' | 'slot' | 'blocked'>;

export const newSquadAi = (): SquadAi => ({
  task: 'none', mode: 'travel', route: -1, slow: false, phase: 0, phaseUntil: 0, holdAt: 0, holdOct: -1, flankSign: 0, flankSince: -1, flankDone: false,
});

/** A fresh Soldier's AI state; `slot` is seeded, so a new Soldier draws once from the Match RNG. */
export const newSoldierAi = (m: Match): SoldierAi => ({ ...resetSoldierAi(m), slot: 0.7 + 0.7 * rnd(m), blocked: 0 });

/** What a Soldier forgets when Wounded or brought back. */
export const resetSoldierAi = (m: Match) => ({
  ammo: m.tune.ammo, lastTarget: -1, dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false,
});

const MODE = { travel: 0, bound: 1, hold: 2, fallback: 3 };
const TASK = { none: 0, point: 1, retreat: 2, resupply: 3 };
const ROLE = { flank: 1, support: 2 };

export function hashAi(m: Match, mix: Mix) {
  const at = (p: { x: number; y: number } | null | undefined) => {
    mix(p ? Math.round(p.x * 1000) : -1);
    mix(p ? Math.round(p.y * 1000) : -1);
  };
  for (const sq of m.squads)
    for (const v of [TASK[sq.task], MODE[sq.mode], sq.route, +sq.slow, sq.phase, sq.phaseUntil, sq.holdAt, sq.holdOct, sq.flankSign, sq.flankSince, +sq.flankDone]) mix(v);
  for (const s of m.soldiers) {
    for (const v of [s.lastTarget, s.path.length, s.chaseUntil, s.role ? ROLE[s.role] : 0, +s.regroup, s.blocked]) mix(v);
    at(s.dest);
    at(s.cover);
    at(s.path[0]);
  }
  hashDeaths(m, mix);
}
