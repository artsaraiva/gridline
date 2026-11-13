import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, Command, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [],
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};

/** Two Soldiers a Squad, one Squad a Side (nato ids 0 and 1, pact 2 and 3). Nobody sees anybody, so every Squad stays quiet. */
function scene(tune: Partial<Tune> = {}): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 2, speedJitter: 0, spread: 0, visionM: 0, jetsPerSide: 0, aasPerSide: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, rideM: [180, 180], rapidCooldownSeconds: 0, ...tune };
  return createMatch({ seed: 1, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
}

const rapid = (m: Match, side: SideId = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'rapid' });
const kill = (m: Match, ...ids: number[]) => ids.forEach((id) => Object.assign(m.soldiers[id]!, { state: 'dead', hp: 0, deadAt: m.tick }));

function run(m: Match, ticks: number, commands: Command[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, i ? [] : commands));
  return events;
}

/** Ticks after `from` until the first event of `kind` for `side`, running at most a minute. */
function until(m: Match, kind: 'respawn' | 'redeploy', side: SideId = 'nato'): number {
  const from = m.tick;
  for (let i = 0; i < 60 * HZ; i++) if (step(m, []).some((e) => e.kind === kind && e.side === side)) return m.tick - 1 - from;
  return Infinity;
}

const radio = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'radio' ? [e.text] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'rapid')!;

describe('Rapid Deploy call', () => {
  it('starts the match on its 180 s cooldown; it takes no spot, puts nothing on the map, and says so on the Asset net', () => {
    const m = scene({ rapidCooldownSeconds: 180 });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 180, cooldown: 180, untargeted: true });
    expect(run(m, 1, [rapid(m)])).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'cooling down' }));
    run(m, 180 * HZ - 1);
    const called = run(m, 1, [rapid(m)]);
    expect(called).toContainEqual({ kind: 'radio', side: 'nato', squad: null, type: 'asset', text: 'Rapid deployment authorised', priority: 1 }); // no Grid Reference
    const v = commanderView(m, 'nato');
    expect(row(v)).toMatchObject({ readyIn: 180 - 1 / HZ, up: { left: 60 - 1 / HZ, total: 60 } });
    expect(v.effects).toEqual([]);
    expect(commanderView(m, 'pact').effects).toEqual([]);
    expect(radio(run(m, 60 * HZ))).toEqual(['Rapid deployment over']);
    expect(row(commanderView(m, 'nato')).up).toBeUndefined();
  });
});

describe('Rapid Deploy timers', () => {
  it('a member dead at 0 s with Rapid Deploy called at 2 s Squad Respawns 5 s after death, and the tile counts down to it', () => {
    const m = scene();
    kill(m, 1);
    run(m, 2 * HZ);
    run(m, 1 * HZ, [rapid(m)]);
    expect(commanderView(m, 'nato').squads[0]!.respawnIn[0]).toBeCloseTo(2 + 1 / HZ);
    expect(until(m, 'respawn')).toBe(2 * HZ);
  });

  it('a Squad wiped while it works Redeploys in 10 s', () => {
    const m = scene();
    run(m, 1 * HZ, [rapid(m)]);
    kill(m, 0, 1);
    expect(until(m, 'redeploy')).toBe(10 * HZ);
  });

  it("after 60 s the timers are back to 10 and 20 s, and the enemy's never changed", () => {
    const m = scene();
    run(m, 61 * HZ, [rapid(m)]);
    kill(m, 1);
    expect(until(m, 'respawn')).toBe(10 * HZ);
    kill(m, 0, 1);
    expect(until(m, 'redeploy')).toBe(20 * HZ);
    const n = scene();
    run(n, 1 * HZ, [rapid(n)]);
    kill(n, 2, 3);
    expect(until(n, 'redeploy', 'pact')).toBe(20 * HZ);
  });

  it('is hashed: the call moves the state hash, and a replay hashes the same', () => {
    const play = (call: boolean) => {
      const m = scene();
      run(m, 2 * HZ, call ? [rapid(m)] : []);
      return stateHash(m);
    };
    expect(play(true)).toBe(play(true));
    expect(play(true)).not.toBe(play(false));
  });
});
