import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { canStand } from './geometry';
import { jump } from './vehicles';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { CommanderView, MapData, SimEvent, Tune } from './types';

const T = DEFAULT_TUNE;
const HZ = T.hz;

/** Open ground; nato Soldiers 0..3, pact 4..7, nato's helicopter is vehicle 8. */
function scene(tune: Partial<Tune> = {}, map: Partial<MapData> = {}): Match {
  const full: Tune = { ...T, squadSize: 4, speedJitter: 0, spread: 0, strayChance: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], jeepsPerSide: 0, tanksPerSide: 0, helisPerSide: 1, pointJeeps: false, visionM: 0, ...NO_TRAITS, ...NO_TEMPO, ...tune };
  const m = thinkOnId(
    createMatch({
      seed: 1,
      map: { name: 'f', playArea: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } }, points: [], ...map },
      tune: full,
      squadsPerSide: 1,
      commanderSide: 'nato',
    }),
  );
  for (const id of [4, 5, 6, 7]) Object.assign(m.soldiers[id]!, { x: 500, y: 500 });
  return m;
}

/** Nato's helicopter hovers at the origin with Soldiers 0 (pilot) and 1..3 aboard. */
function airborne(m: Match, hp: number) {
  const h = m.vehicles[0]!;
  Object.assign(h, { x: 0, y: 0, airborne: true, parked: false, hp, seats: [0, 1, 2, 3] });
  for (const id of [0, 1, 2, 3]) Object.assign(m.soldiers[id]!, { x: 0, y: 0, vehicle: h.id });
  return h;
}

const run = (m: Match, ticks: number) => {
  const views: CommanderView[] = [];
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) (events.push(...step(m, [])), views.push(commanderView(m, 'nato')));
  return { views, events };
};
const friend = (v: CommanderView, id: number) => v.friendlies.find((f) => f.id === id)!;

describe('#130 parachute jump', () => {
  it('passengers of a helicopter crippled in the air jump, land after chuteSeconds within chuteScatterM on standable ground, not stacked; the pilot stays', () => {
    const m = scene();
    const h = airborne(m, T.heliHp / 4);
    const { views } = run(m, Math.round((T.chuteSeconds + 3) * HZ));
    const jumpedAt = views.findIndex((v) => friend(v, 1).chute !== undefined);
    expect(jumpedAt).toBeGreaterThanOrEqual(0);
    expect(friend(views[jumpedAt]!, 0).vehicle).toBe(h.id);
    const landedAt = views.findIndex((v, i) => i > jumpedAt && friend(v, 1).chute === undefined);
    expect((landedAt - jumpedAt) / HZ).toBeCloseTo(T.chuteSeconds, 0);
    const spots = [1, 2, 3].map((id) => m.soldiers[id]!);
    for (const s of spots) {
      expect(s.vehicle).toBe(-1);
      expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(T.chuteScatterM);
      expect(canStand(m, s, s)).toBe(true);
    }
    expect(new Set(spots.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`)).size).toBe(3);
  });

  it('a healthy helicopter in the air keeps its passengers', () => {
    const m = scene();
    const h = airborne(m, T.heliHp);
    run(m, 3 * HZ);
    expect(h.seats).toEqual([0, 1, 2, 3]);
  });

  it('the descent progress runs from 0 to 1', () => {
    const m = scene();
    airborne(m, T.heliHp);
    jump(m, m.soldiers[1]!);
    const { views } = run(m, Math.round(T.chuteSeconds * HZ));
    const p = views.map((v) => friend(v, 1).chute).filter((c): c is number => c !== undefined);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(0.05);
    expect(p.at(-1)).toBeGreaterThan(0.95);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });

  it('a Soldier landing on a wall steps to the nearest standable ground', () => {
    const m = scene({ chuteScatterM: 0 }, { walls: [{ x0: -10, y0: -10, x1: 10, y1: 10 }] });
    airborne(m, T.heliHp);
    jump(m, m.soldiers[1]!);
    run(m, Math.round((T.chuteSeconds + 1) * HZ));
    expect(canStand(m, m.soldiers[1]!, m.soldiers[1]!)).toBe(true);
  });

  it('coming down, a Soldier never fires but can be shot dead; enemies in range see it over a wall', () => {
    const wall = { walls: [{ x0: -64, y0: -80, x1: -56, y1: 80 }] };
    const m = scene({ visionM: 200, fireJitterSeconds: 0, hitChance: 1, walkSpeed: 0, hp: 1 }, wall);
    airborne(m, T.heliHp);
    jump(m, m.soldiers[1]!);
    Object.assign(m.soldiers[1]!, { fx: -1, fy: 0 });
    Object.assign(m.soldiers[0]!, { x: 500, y: 500, vehicle: -1 });
    Object.assign(m.soldiers[4]!, { x: -120, y: 0, fx: 1, fy: 0 });
    const { events } = run(m, 4 * HZ);
    expect(events.some((e) => e.kind === 'shot' && e.from === 1)).toBe(false);
    expect(events.some((e) => e.kind === 'shot' && e.from === 4 && e.to === 1)).toBe(true);
    expect(m.soldiers[1]!.state).not.toBe('alive');
  });

  it('a Soldier on a parachute does not fire in the open either', () => {
    const m = scene({ visionM: 200, fireJitterSeconds: 0, walkSpeed: 0 });
    airborne(m, T.heliHp);
    jump(m, m.soldiers[1]!);
    Object.assign(m.soldiers[1]!, { fx: 1, fy: 0 });
    Object.assign(m.soldiers[4]!, { x: 100, y: 0, fx: -1, fy: 0 });
    const { events } = run(m, 3 * HZ);
    expect(events.some((e) => e.kind === 'shot' && e.from === 1)).toBe(false);
  });
});
