// #107 the tank, at its module's interface: its main gun (what the view and the events show) and where its driver takes it (`goal`,
// a decision the view does not show).
import { describe, expect, it } from 'vitest';
import { step } from '../index';
import { DEFAULT_TUNE } from '../tune';
import { crew, hashes, play, scene, vehicle, viewOf } from '../test-scene';
import type { Tune } from '../types';
import type { OwnOf } from './body';
import { tank, type Gun } from './tank';

const HZ = DEFAULT_TUNE.hz;

/** An HQ of no size: these tanks fight from the slot they wait in, and nobody fires out of its own HQ. */
const NO_HQ: Partial<Tune> = { hqRadius: 0 };

/** A test scene with one tank a Side: with Squads of two, nato's Soldiers are 0 and 1, pact's 2 and 3, nato's tank 4 and pact's 5. */
const tanks = (o: Parameters<typeof scene>[0] = {}) => scene({ ...o, tune: { tanksPerSide: 1, ...o.tune } });

describe('#107 the tank fights', () => {
  it('its main gun fires every tankFireSeconds, a round flying at tankShellMps to a Strike-shaped impact; the coax fires at infantry; nobody aboard is shot', () => {
    // the crewed nato tank on its HQ facing east, pact Soldiers 120 m and 156 m off in the open
    const m = tanks({ tune: { hp: 1e9, tankAimSeconds: [0, 0], ...NO_HQ }, place: { 2: { x: -440, y: 0, fx: -1 }, 3: { x: -440, y: 100, fx: -1 } } });
    crew(m, vehicle(m, 'tank'), [0, 1]);
    const { events } = play(m, 13 * HZ);
    const impacts = events.filter((e) => e.kind === 'impact');
    expect(impacts.map((e) => [e.x, e.y])).toEqual([[-440, 0], [-440, 100]]);
    expect(impacts[0]).toMatchObject({ side: 'nato', asset: 'tank', from: 4 });
    const flight = (d: number) => d / DEFAULT_TUNE.tankShellMps;
    expect(impacts[0]!.tick / HZ).toBeCloseTo(flight(120), 1);
    expect((impacts[1]!.tick - impacts[0]!.tick) / HZ).toBeCloseTo(DEFAULT_TUNE.tankFireSeconds + flight(Math.hypot(120, 100)) - flight(120), 1);
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id)).toEqual([2, 3]); // inside the kill radius
    expect(events.some((e) => e.kind === 'shot' && e.from === 1 && e.to === 2)).toBe(true); // the coax
    expect(events.some((e) => e.kind === 'shot' && (e.to === 0 || e.to === 1))).toBe(false);
  });

  it('the main gun fires on a new target only after a seeded aim time of tankAimSeconds', () => {
    const firsts = [1, 2, 3, 4].map((seed) => {
      const m = tanks({ seed, tune: { ...NO_HQ }, place: { 2: { x: -500, y: 0 }, 3: { x: -500, y: 0 } } });
      const v = crew(m, vehicle(m, 'tank'), [0, 1]);
      let fired = -1;
      for (let i = 0; i < 5 * HZ && fired < 0; i++) if ((step(m, []), viewOf(m, v.id)!.rounds)) fired = m.tick - 1;
      return fired / HZ;
    });
    for (const f of firsts) expect(f).toBeGreaterThanOrEqual(DEFAULT_TUNE.tankAimSeconds[0]), expect(f).toBeLessThanOrEqual(DEFAULT_TUNE.tankAimSeconds[1] + 1 / HZ); // the round shows a tick after the aim ends
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('the main gun takes an enemy tank before infantry, for tankVsVehicleDamage', () => {
    const m = tanks({ tune: { visionM: 0, tankAimSeconds: [0, 0], ...NO_HQ }, place: { 2: { x: -440, y: 0 }, 3: { x: -440, y: 0 } } });
    crew(m, vehicle(m, 'tank'), [0, 1]);
    Object.assign(vehicle(m, 'tank', 'pact'), { x: -400, y: 0 });
    m.tune.visionM = DEFAULT_TUNE.visionM;
    const { events, views } = play(m, 2 * HZ); // 160 m of flight
    expect(views[0]!.vehicles!.find((x) => x.id === 4)!.rounds).toEqual([{ from: { x: -560, y: 0 }, to: { x: -400, y: 0 }, flight: expect.any(Number) }]);
    expect(events.find((e) => e.kind === 'impact')).toMatchObject({ x: -400, y: 0 });
    expect(viewOf(m, 5, 'pact')!.hp).toBe((DEFAULT_TUNE.tankHp - DEFAULT_TUNE.tankVsVehicleDamage) / DEFAULT_TUNE.tankHp);
  });
});

describe('#107 where its driver takes it', () => {
  it('marks down a point where known enemy tanks outnumber the friendly ones going, and one where its Side just lost a tank', () => {
    // A and B as far from nato's HQ either way, no seeded preference; Soldier 0 drives nato's first tank (4), pact has two (6, 7)
    for (const tune of [{ tankOutgunnedPenalty: 100, tankWreckPenalty: 0 }, { tankOutgunnedPenalty: 0, tankWreckPenalty: 100 }]) {
      const m = tanks({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 200 }, { id: 'B', name: 'B', x: -200, y: -200 }] }, tune: { tanksPerSide: 2, tankGoalBias: 0, visionM: 0, ...tune } });
      const v = crew(m, vehicle(m, 'tank'), [0]);
      const [s, sq] = [m.soldiers[0]!, m.squads[0]!];
      const goal = tank.goal!(m, sq, s, v);
      const p = m.points[goal]!;
      const foes = m.vehicles.filter((o) => o.side === 'pact' && o.kind === 'tank');
      expect(foes.length).toBeGreaterThan(1);
      if (tune.tankWreckPenalty) m.wrecks.push({ side: 'nato', kind: 'tank', x: p.x, y: p.y, fx: 1, fy: 0, seen: false, tick: m.tick });
      else foes.forEach((o) => sq.memory.push({ id: o.id, x: p.x, y: p.y, tick: m.tick, source: 'seen' }));
      expect(tank.goal!(m, sq, s, v)).not.toBe(goal);
    }
  });
});

describe('#183 its hash', () => {
  it('mixes every field of its record: its gun, and its way (drive-route.test.ts)', () => {
    const m = tanks();
    const v = vehicle(m, 'tank');
    hashes<keyof OwnOf<'tank'>>(m, { gun: () => (v.gun.laid = 3), drive: () => (v.drive.route = 1) });
    hashes<keyof Gun>(m, { laid: () => (v.gun.laid = 2), nextFire: () => (v.gun.nextFire = 99) });
  });
});
