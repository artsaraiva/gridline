import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { NO_TEMPO } from './test-tune';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, Command, MapData, SideId, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks. */
const field = (points: MapData['points'] = []): MapData => ({
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points,
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
});

/** Placing Soldiers stands in for a map script; everything after runs through `step`. Nobody sees anybody. */
function scene(o: { tune?: Partial<Tune>; squads?: number; squadSize?: number; points?: MapData['points'] } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: o.squadSize ?? 1, speedJitter: 0, spread: 0, visionM: 0, jetsPerSide: 0, aasPerSide: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, rideM: [180, 180], beaconCooldownSeconds: 0, ...o.tune };
  return createMatch({ seed: 1, map: field(o.points), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
}

const call = (m: Match, at: Vec2, side: SideId = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'beacon', at });

function run(m: Match, ticks: number, commands: Command[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, i ? [] : commands));
  return events;
}

const radio = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'radio' ? [e.text] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'beacon')!;
const beacons = (v: CommanderView) => v.effects!.filter((e) => e.asset === 'beacon');

describe('Redeploy Beacon call', () => {
  it('starts the match on its 120 s cooldown, and the cooldown runs 120 s from a call', () => {
    const m = scene({ tune: { beaconCooldownSeconds: 120 } });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 120, cooldown: 120, radius: 10 });
    const early = run(m, 1, [call(m, { x: 0, y: 0 })]);
    expect(early).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'cooling down' }));
    run(m, 120 * HZ - 1);
    expect(row(commanderView(m, 'nato')).readyIn).toBe(0);
    run(m, 1, [call(m, { x: 0, y: 0 })]);
    expect(row(commanderView(m, 'nato')).readyIn).toBeCloseTo(120 - 1 / HZ);
  });

  it('falls under its parachute for 5 s ("Beacon inbound", then "Beacon down"), then stays live 90 s and ends', () => {
    const m = scene();
    expect(radio(run(m, 1, [call(m, { x: 100, y: 50 })]))).toEqual(['Beacon inbound']);
    expect(beacons(commanderView(m, 'nato'))).toEqual([expect.objectContaining({ x: 100, y: 50, landsIn: 5 - 1 / HZ, fall: 5, total: 95 })]);
    const fall = run(m, 5 * HZ);
    expect(radio(fall)).toEqual(['Beacon down']);
    expect(beacons(commanderView(m, 'nato'))[0]).toMatchObject({ landsIn: 0, left: 90 - 1 / HZ });
    run(m, 90 * HZ - 2);
    expect(beacons(commanderView(m, 'nato'))).toHaveLength(1);
    run(m, 1);
    expect(beacons(commanderView(m, 'nato'))).toEqual([]);
  });

  it('is one per Side: a second call replaces the first', () => {
    const m = scene();
    run(m, 10 * HZ, [call(m, { x: 100, y: 50 })]);
    run(m, 1, [call(m, { x: -100, y: 0 })]);
    expect(beacons(commanderView(m, 'nato'))).toEqual([expect.objectContaining({ x: -100, y: 0 })]);
  });
});

describe('Redeploy Beacon on the Consoles', () => {
  /** nato's beacon landed at (100, 50); pact's one Soldier (id 1) placed and held still. */
  function landed(pact: { x: number; y: number; fx?: number; fy?: number }, tune: Partial<Tune> = {}) {
    const m = scene({ tune });
    Object.assign(m.soldiers[1]!, { fx: -1, fy: 0, ...pact, speed: 0 });
    run(m, 6 * HZ, [call(m, { x: 100, y: 50 })]);
    return m;
  }

  it('its own Console sees the 30 m deny ring while a living enemy Soldier is inside it, and only then', () => {
    expect(beacons(commanderView(landed({ x: 120, y: 60 }), 'nato'))[0]).toMatchObject({ radius: 30, contested: true });
    expect(beacons(commanderView(landed({ x: 135, y: 50 }), 'nato'))[0]!.contested).toBeUndefined();
  });

  it('the enemy Console sees it only while one of its Soldiers does (in range, in the vision cone, in line of sight)', () => {
    const seen = (p: { x: number; y: number; fx?: number }) => beacons(commanderView(landed(p, { visionM: 150 }), 'pact'));
    expect(seen({ x: 200, y: 50, fx: -1 })).toEqual([expect.objectContaining({ x: 100, y: 50, side: 'nato', landsIn: 0 })]);
    expect(seen({ x: 200, y: 50, fx: 1 })).toEqual([]); // looking away
    expect(seen({ x: 300, y: 50, fx: -1 })).toEqual([]); // too far
    expect(seen({ x: 120, y: 60, fx: -1 })[0]!.contested).toBeUndefined(); // the deny ring is its own Side's
  });

  it('is hashed: the call and the landing move the state hash, and a replay hashes the same', () => {
    const play = (beaconAt: Vec2 | null) => {
      const m = scene();
      run(m, 8 * HZ, beaconAt ? [call(m, beaconAt)] : []);
      return stateHash(m);
    };
    expect(play({ x: 100, y: 50 })).toBe(play({ x: 100, y: 50 }));
    expect(play({ x: 100, y: 50 })).not.toBe(play(null));
    expect(play({ x: 100, y: 50 })).not.toBe(play({ x: 100, y: 60 }));
  });
});

describe('Redeploy at the beacon', () => {
  // One Soldier a Side. nato's (id 0) takes an Order on C, then dies 300 m from its HQ; the beacon is 60 m from C. C is neutral
  // and stays so, so the choice is the beacon or the HQ. pact's Soldier (id 1) stands still where `enemy` puts it.
  const C = { id: 'C', name: 'C', x: 0, y: 0 };
  const BEACON = { x: 60, y: 0 };
  function wiped(enemy: Vec2, beaconAt: Vec2 | null = BEACON) {
    const m = scene({ points: [C], tune: { ...NO_TEMPO, captureSeconds: 1e6 } });
    Object.assign(m.soldiers[1]!, { ...enemy, speed: 0 });
    run(m, 3 * HZ, [{ tick: 0, side: 'nato', kind: 'order', squad: 0, point: 'C' }, ...(beaconAt ? [call(m, beaconAt)] : [])]);
    Object.assign(m.soldiers[0]!, { x: -260, y: 0, state: 'dead', hp: 0, deadAt: m.tick });
    const views: CommanderView[] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < 25 * HZ; i++) {
      events.push(...step(m, []));
      views.push(commanderView(m, 'nato'));
    }
    return { redeploy: events.find((e) => e.kind === 'redeploy'), pending: views[10 * HZ]!.squads[0]! };
  }

  it('a Squad wiped with a live beacon nearer its Order point than the HQ Redeploys there, and its tile says so', () => {
    const { redeploy, pending } = wiped({ x: 300, y: 300 });
    expect(redeploy).toMatchObject({ x: 60, y: 0 });
    expect(pending).toMatchObject({ redeployAt: null, atBeacon: true });
  });

  it('with a living enemy Soldier within 30 m of the beacon it is silent: the Squad Redeploys at the HQ', () => {
    const { redeploy, pending } = wiped({ x: 75, y: 15 });
    expect(redeploy).toMatchObject({ x: -560, y: 0 });
    expect(pending.atBeacon).toBeUndefined();
  });

  it('an enemy just beyond 30 m does not silence it', () => {
    expect(wiped({ x: 91, y: 0 }).redeploy).toMatchObject({ x: 60, y: 0 });
  });

  it('a beacon further from the Order point than the HQ is not used', () => {
    expect(wiped({ x: 300, y: 300 }, { x: 500, y: 400 }).redeploy).toMatchObject({ x: -560, y: 0 });
  });
});
