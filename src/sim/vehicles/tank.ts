// #107: the tank, the tracer for the shared Vehicle rules: crewed by its driver (who fires the main gun) and a gunner on the coax.
import type { Match } from '../index';
import { driveFlow } from '../ai/flow';
import { bestPoint } from '../ai/squad';
import { dist2 } from '../geometry';
import { sideKnown } from '../memory';
import { vehicleOf, type Soldier, type Squad } from '../state';
import type { Vec2 } from '../types';
import { live, type Vehicle } from './body';
import type { VehicleRules } from './core';
import { groundMove, head } from './ground';
import { goalOf } from './seats';

const squared = (r: number) => r * r;

/**
 * The Capture Point a tank's driver takes it to: scored like its Squad's choice (the Order's bonus as ever) but by drive
 * distance from the vehicle, with its own seeded preference, stickiness to where it is going, and the crowd penalty for each
 * other friendly vehicle already going there; its Squad's goal pulls no harder than any point. A Detached driver keeps its own.
 */
function tankPoint(m: Match, sq: Squad, s: Soldier, v: Vehicle): number {
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
  move: groundMove,
  goal: tankPoint,
  onGoal: (m, v, goal) => void (goal >= 0 && head(m, v, goal)), // with none it keeps going where it was
};
