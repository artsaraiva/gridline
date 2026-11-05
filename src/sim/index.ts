// The Simulation: pure, deterministic, no DOM, no clocks, no Math.random.
// createMatch, step, stateHash and commanderView are its whole public surface; the rules live in the sibling modules.
// Only + - * / and Math.sqrt touch floats: those are exact across engines (Math.hypot and trig are not).
import { think, walk } from './ai';
import { capture, drain, end, hashCapture } from './capture';
import { casualties, fire, suppressionDecay } from './combat';
import { applyCommands } from './commands';
import { buildGrid, type Grid } from './grid';
import { hashMemory, hear, type Sighting } from './memory';
import { perceive } from './perception';
import { returnToFight } from './respawn';
import { rnd } from './rng';
import { hashSoldiers, hashSquads, sign, stageTicks, type Point, type Soldier, type Squad } from './state';
import { SIDES, type Command, type MapData, type MatchResult, type SideId, type SimEvent, type Tune } from './types';

export * from './types';
export { commanderEvents, commanderView } from './view';
export { gridRef } from './grid-ref';

export interface Match {
  tick: number;
  rng: number;
  tune: Tune;
  map: MapData;
  soldiers: Soldier[];
  squads: Squad[];
  points: Point[];
  grid: Grid;
  tickets: Record<SideId, number>;
  pointLead: number; // nato points - pact points
  drainTicks: number; // ticks the current point lead has been draining
  sightings: Record<SideId, Sighting[]>; // what each Side's Soldiers saw lately, one per enemy id; see memory.ts
  result: MatchResult | null;
}

export function createMatch(opts: {
  seed: number;
  map: MapData;
  tune: Tune;
  squadsPerSide: number;
  commanderSide: SideId;
}): Match {
  const { map, tune } = opts;
  const m: Match = {
    tick: 0,
    rng: opts.seed | 0,
    tune,
    map,
    soldiers: [],
    squads: [],
    points: map.points.map((p) => ({ ...p, radius: p.radius ?? tune.captureRadius, owner: p.owner ?? null, progress: p.owner ? sign(p.owner) * stageTicks(tune) : 0 })),
    grid: buildGrid(map, tune.cellM),
    tickets: { nato: tune.tickets, pact: tune.tickets },
    pointLead: 0,
    drainTicks: 0,
    sightings: { nato: [], pact: [] },
    result: null,
  };
  for (const side of SIDES) {
    const hq = map.hqs[side];
    for (let q = 0; q < opts.squadsPerSide; q++) {
      const squad: Squad = { id: m.squads.length, side, members: [], goal: -1, lastSeen: -1e9, memory: [] };
      m.squads.push(squad);
      for (let i = 0; i < tune.squadSize; i++) {
        const ox = (rnd(m) * 2 - 1) * tune.spread;
        const oy = (rnd(m) * 2 - 1) * tune.spread;
        const speed = (tune.walkSpeed * (1 + (rnd(m) * 2 - 1) * tune.speedJitter)) / tune.hz;
        squad.members.push(m.soldiers.length);
        m.soldiers.push({
          id: m.soldiers.length, side, squad: squad.id, x: hq.x + ox, y: hq.y + oy, fx: sign(side), fy: 0, speed, ox, oy,
          state: 'alive', hp: tune.hp, suppression: 0, target: -1, nextFire: 0, bleed: 0, revive: 0, reviving: -1, deadAt: 0,
        });
      }
    }
  }
  return m;
}

/** Advances exactly one tick. One line per phase; the order is part of the rules. Commands are the ones stamped with this tick. */
export function step(m: Match, commands: Command[]): SimEvent[] {
  if (m.result) return [];
  const t = m.tune;
  const events: SimEvent[] = [];
  applyCommands(m, commands, events);
  for (const sq of m.squads) if ((m.tick + sq.id) % Math.round(t.thinkSeconds * t.hz) === 0) think(m, sq);
  casualties(m, events);
  perceive(m);
  fire(m, events);
  hear(m, events);
  for (const s of m.soldiers) if (s.state === 'alive') walk(m, s);
  suppressionDecay(m);
  returnToFight(m, events);
  for (const p of m.points) capture(m, p);
  drain(m);
  m.tick++;
  end(m);
  return events;
}

/** FNV-1a over all Match state. Each module mixes in its own state; new state gets a hash call (or a line in one) here. */
export function stateHash(m: Match): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(m.tick);
  mix(m.rng);
  hashSoldiers(m, mix);
  hashSquads(m, mix);
  hashCapture(m, mix);
  hashMemory(m, mix);
  return h.toString(16).padStart(8, '0');
}
