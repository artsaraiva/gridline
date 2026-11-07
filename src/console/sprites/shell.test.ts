import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { TEST_FIELD } from '../../maps/test-field';
import { DEFAULT_TUNE } from '../../sim/tune';
import { barrageShells, SHELL_EXAGGERATION, SHELL_HEADINGS, SHELL_PITCH_FRAMES, SHELL_VISIBLE_FROM, SHELL_WORLD_M, type ShellInFlight, shellInFlight, shellStreak } from './shell';

describe('artillery shell sky entry, streak and fog', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('is drawn only in the last part of its flight: it enters high over a spot short of the target toward the own HQ and falls straight to it', () => {
    const start = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const mid = shellInFlight(from, to, (1 + SHELL_VISIBLE_FROM) / 2);
    const end = shellInFlight(from, to, 1);

    // Before the visible window the pose is held at the entry: nothing is drawn yet
    const pose = ({ flight: _, ...rest }: ShellInFlight) => rest;
    expect(pose(shellInFlight(from, to, 0))).toEqual(pose(start));
    expect(pose(shellInFlight(from, to, SHELL_VISIBLE_FROM / 2))).toEqual(pose(start));

    // #98: the first visible frame is high above a ground spot short of the target, on the bearing toward the own HQ
    expect(start.altitude).toBeGreaterThan(0);
    expect(start.ground.x).toBeLessThan(to.x);
    expect(Math.hypot(start.ground.x - from.x, start.ground.y - from.y)).toBeLessThan(Math.hypot(to.x - from.x, to.y - from.y));
    expect(Math.hypot(start.ground.x - to.x, start.ground.y - to.y)).toBeCloseTo(start.altitude / Math.tan(Math.PI / 3)); // 60 deg
    expect({ x: end.x, y: end.y, altitude: end.altitude }).toEqual({ x: to.x, y: to.y, altitude: 0 });
    expect(mid.altitude).toBeCloseTo(start.altitude / 2);

    // A straight line: the body's mid point sits half way between its first and last frame
    expect(mid.x).toBeCloseTo((start.x + end.x) / 2);
    expect(mid.y).toBeCloseTo((start.y + end.y) / 2);

    // Always diving: the steepest baked pitch
    expect(start.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);
    expect(end.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);

    // Rotated to the heading from HQ to impact (baked sprite nose points +Y)
    const expectedHeading = Math.atan2(to.y - from.y, to.x - from.x);
    expect(mid.heading).toBeCloseTo(expectedHeading);
    expect(mid.rotation).toBeCloseTo(expectedHeading - Math.PI / 2);
  });

  it('a shot 50 m from the HQ and one 800 m away take the same visible path shape', () => {
    const near = shellInFlight({ x: -50, y: 0 }, { x: 0, y: 0 }, 0.9);
    const far = shellInFlight({ x: -800, y: 0 }, { x: 0, y: 0 }, 0.9);
    expect({ x: near.x, y: near.y, altitude: near.altitude, size: near.size }).toEqual({ x: far.x, y: far.y, altitude: far.altitude, size: far.size });
  });

  it('keeps the baked sun north-east in any flight direction: nearest baked heading frame, only the remainder rotated', () => {
    const step = (2 * Math.PI) / SHELL_HEADINGS;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let a = -Math.PI; a < Math.PI; a += 0.29) {
      const s = shellInFlight({ x: 0, y: 0 }, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 }, 0.9);
      const heading = s.frame % SHELL_HEADINGS;
      expect(Math.floor(s.frame / SHELL_HEADINGS)).toBe(s.pitchFrame);
      expect(Math.abs(s.bodyRotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap(heading * step + s.bodyRotation - s.heading)).toBeCloseTo(0);
    }
    // A Pact shell flying west uses the west-facing frames rather than the east-facing frames turned half a circle.
    const west = shellInFlight({ x: 415, y: 0 }, { x: -50, y: 0 }, 0.9);
    expect(west.frame % SHELL_HEADINGS).toBe(SHELL_HEADINGS / 2);
    expect(west.bodyRotation).toBeCloseTo(0);
  });

  it('is a small dark dot at world scale with an exaggeration tune value, and shrinks as it drops', () => {
    expect(SHELL_WORLD_M).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeLessThanOrEqual(2.5); // a 155 mm round, not a rocket
    const start = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const mid = shellInFlight(from, to, 0.9);
    const end = shellInFlight(from, to, 1);
    expect(end.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(start.size).toBeGreaterThan(mid.size);
    expect(mid.size).toBeGreaterThan(end.size);
    expect(shellInFlight(from, to, 1, SHELL_EXAGGERATION * 2).size).toBeCloseTo(end.size * 2);
  });

  it('surfaces friendly shells in their visible window, bearing from the Commander HQ, and never enemy shells or launch sources', () => {
    const tune = { ...DEFAULT_TUNE, barrageCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [
      { tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 40, y: 20 } },
      { tick: m.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } },
    ]);
    const ticks = (seconds: number) => Math.round(seconds * tune.hz);
    // Just after the first shell leaves it is up but not yet drawn
    for (let i = 0; i < ticks(tune.barrageWarningSeconds + 0.5); i++) step(m, []);
    expect(commanderView(m, 'nato').effects![0]!.shells!.length).toBeGreaterThan(0);
    expect(barrageShells(commanderView(m, 'nato'), TEST_FIELD)).toEqual([]);
    // In the last part of its flight it is
    const drawnAt = ticks(tune.barrageWarningSeconds + tune.barrageFlightSeconds * (1 + SHELL_VISIBLE_FROM) / 2);
    for (let i = ticks(tune.barrageWarningSeconds + 0.5); i < drawnAt; i++) step(m, []);
    const natoView = commanderView(m, 'nato');
    const natoShells = barrageShells(natoView, TEST_FIELD);
    expect(natoShells.length).toBeGreaterThan(0);
    // Every shown shell comes in on the bearing from NATO's HQ toward NATO's target, never Pact's HQ
    for (const s of natoShells) {
      expect(s.from).toEqual({ x: TEST_FIELD.hqs.nato.x, y: TEST_FIELD.hqs.nato.y });
      expect(Math.hypot(s.to.x - 40, s.to.y - 20)).toBeLessThanOrEqual(tune.barrageSpreadM);
    }

    // If only the enemy called a barrage, the Commander's view has no shells at all
    const mEnemyOnly = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(mEnemyOnly, [{ tick: mEnemyOnly.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } }]);
    for (let i = 0; i < drawnAt; i++) step(mEnemyOnly, []);
    expect(barrageShells(commanderView(mEnemyOnly, 'nato'), TEST_FIELD)).toEqual([]);
  });
});

describe('shell streak', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('runs from the entry spot to the shell, so it grows as the shell falls and ends at the target', () => {
    const entry = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const early = shellStreak(from, to, 0.85);
    const late = shellStreak(from, to, 1);
    expect({ x: early.tail.x, y: early.tail.y }).toEqual({ x: entry.x, y: entry.y });
    expect({ x: late.tail.x, y: late.tail.y }).toEqual({ x: entry.x, y: entry.y });
    expect({ x: late.head.x, y: late.head.y }).toEqual({ x: to.x, y: to.y });
    expect(late.length).toBeGreaterThan(early.length);
    expect(late.length).toBeCloseTo(Math.hypot(to.x - entry.x, to.y - entry.y));
    expect(late.angle).toBeCloseTo(Math.atan2(to.y - entry.y, to.x - entry.x));
  });

  it('has no length before the shell is drawn', () => {
    expect(shellStreak(from, to, 0).length).toBe(0);
    expect(shellStreak(from, to, SHELL_VISIBLE_FROM).length).toBe(0);
  });
});
