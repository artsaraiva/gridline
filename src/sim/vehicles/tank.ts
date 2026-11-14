// #107: the tank, the tracer for the shared Vehicle rules: crewed by its driver (who fires the main gun) and a gunner on the coax.
import type { Match } from '../index';
import { driveFlow } from '../ai/flow';
import { bestPoint } from '../ai/squad';
import { dist2, inHq } from '../geometry';
import { rnd } from '../rng';
import { sideKnown } from '../memory';
import { vehicleOf, type Soldier, type Squad } from '../state';
import type { Vec2 } from '../types';
import { crippled, live, type VehicleOf } from './body';
import { targetOf, type VehicleRules } from './core';
import { freshDrive } from './drive-route';
import { groundMove, head, setsOff } from './ground';
import { coax, goalOf } from './seats';

const squared = (r: number) => r * r;

/** #107: a tank's main gun: the target it last laid on (-1 = none; a new one costs the aim time) and the tick it may fire again. */
export interface Gun {
  laid: number;
  nextFire: number;
}

/**
 * The Capture Point a tank's driver takes it to: scored like its Squad's choice (the Order's bonus as ever) but by drive
 * distance from the vehicle, with its own seeded preference, stickiness to where it is going, and the crowd penalty for each
 * other friendly vehicle already going there; its Squad's goal pulls no harder than any point. A Detached driver keeps its own.
 */
function tankPoint(m: Match, sq: Squad, s: Soldier, v: VehicleOf<'tank'>): number {
  if (s.detached && s.goal >= 0) return goalOf(m, sq, s);
  const t = m.tune;
  const others = (i: number) => m.vehicles.filter((o) => o !== v && o.side === v.side && live(o) && o.seats[0]! >= 0 && o.goal === i).length;
  // a tank driver thinks twice about a point where the enemy tanks its Side knows outnumber the friendly ones going, or where its Side just lost one
  const there = (i: number, o: Vec2) => dist2(o, m.points[i]!) < squared(m.points[i]!.radius + t.threatenedM);
  const foes = sideKnown(m, v.side).filter((s) => s.source === 'seen' && vehicleOf(m, s.id)?.kind === 'tank');
  const lost = m.wrecks.filter((w) => w.side === v.side && w.kind === 'tank' && m.tick - w.tick < t.routeLossSeconds * t.hz);
  const wary = (i: number) => t.tankOutgunnedPenalty * Math.max(0, foes.filter((s) => there(i, s)).length - others(i) - 1) + t.tankWreckPenalty * lost.filter((w) => there(i, w)).length;
  const bias = v.bias.map((b, i) => b + (i === v.goal ? t.stickiness : 0) - t.crowdPenalty * others(i) - (sq.task === 'point' && sq.goal === i ? t.stickiness : 0) - wary(i));
  return bestPoint(m, sq, v, 0, { flow: (i) => driveFlow(m, v.side, i), bias });
}

export const tank: VehicleRules<'tank'> = {
  init: () => ({ gun: { laid: -1, nextFire: 0 }, drive: freshDrive() }),
  move: groundMove,
  goal: tankPoint,
  onGoal: (m, v, goal) => void (goal >= 0 && head(m, v, goal)), // with none it keeps going where it was
  onDriver: setsOff(tankPoint),
  boardsOnFoot: true,
  wantsOut: (m, _sq, _s, v) => crippled(m, v), // its crew get out only under a third of its hit points
  rank: { range: (t) => t.tankRangeM, of: (_m, _v, e) => ('kind' in e ? (e.kind === 'tank' ? 0 : 1) : 2) }, // an enemy tank first, then any other vehicle, then infantry
  seatFire: coax,
  gun: {
    /** Laying the gun on a new target takes a seeded moment, so two tanks never trade the first round together. */
    lay(m, v) {
      const t = m.tune;
      if (!targetOf(m, v) || v.target === v.gun.laid) return;
      v.gun.laid = v.target;
      v.gun.nextFire = Math.max(v.gun.nextFire, m.tick + Math.round((t.tankAimSeconds[0] + rnd(m) * (t.tankAimSeconds[1] - t.tankAimSeconds[0])) * t.hz));
    },
    /** Its driver fires once laid and reloaded at its target in range (not out of its own HQ: combat.ts fire): a round that flies to the target's spot at `tankShellMps`. */
    fire(m, v) {
      const t = m.tune;
      const e = targetOf(m, v);
      if (!live(v) || v.seats[0]! < 0 || !e || m.tick < v.gun.nextFire || dist2(v, e) > t.tankRangeM * t.tankRangeM || inHq(m, v.side, v)) return;
      v.gun.nextFire = m.tick + Math.round(t.tankFireSeconds * t.hz);
      const flight = Math.max(1, Math.round((Math.sqrt(dist2(v, e)) / t.tankShellMps) * t.hz));
      v.rounds.push({ x0: v.x, y0: v.y, x: e.x, y: e.y, launch: m.tick, land: m.tick + flight });
    },
  },
};
