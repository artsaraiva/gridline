import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { TEST_FIELD } from '../../maps/test-field';
import { DEFAULT_TUNE } from '../../sim/tune';
import { barrageShells, SHELL_EXAGGERATION, SHELL_HEADINGS, SHELL_PITCH_FRAMES, SHELL_WORLD_M, shellInFlight, shellTrail, TRAIL_PUFF_LIFE } from './shell';
import { SMOKE_PUFF_SHEET, SMOKE_PUFF_VARIANTS } from './smoke-puff';

describe('artillery shell flight arc, shadow and fog', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('launches from the friendly HQ, climbs to a distance-scaled apex, and dives into the impact spot rotated to heading', () => {
    const start = shellInFlight(from, to, 0);
    const mid = shellInFlight(from, to, 0.5);
    const end = shellInFlight(from, to, 1);

    expect({ x: start.x, y: start.y, altitude: start.altitude }).toEqual({ x: from.x, y: from.y, altitude: 0 });
    expect({ x: end.x, y: end.y, altitude: end.altitude }).toEqual({ x: to.x, y: to.y, altitude: 0 });
    expect(mid.altitude).toBeGreaterThan(0);

    // Apex scales with distance: a farther target reaches a higher apex
    const nearMid = shellInFlight(from, { x: -300, y: 0 }, 0.5);
    expect(mid.altitude).toBeGreaterThan(nearMid.altitude);

    // Pitch frames progress from climb (0) through level (middle) to dive (last pitch frame)
    expect(start.pitchFrame).toBe(0);
    expect(mid.pitchFrame).toBeGreaterThan(start.pitchFrame);
    expect(mid.pitchFrame).toBeLessThan(SHELL_PITCH_FRAMES - 1);
    expect(end.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);

    // Rotated to the heading from HQ to impact (baked sprite nose points +Y)
    const expectedHeading = Math.atan2(to.y - from.y, to.x - from.x);
    expect(mid.heading).toBeCloseTo(expectedHeading);
    expect(mid.rotation).toBeCloseTo(expectedHeading - Math.PI / 2);
  });

  it('keeps the baked sun north-east in any flight direction: nearest baked heading frame, only the remainder rotated', () => {
    const step = (2 * Math.PI) / SHELL_HEADINGS;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let a = -Math.PI; a < Math.PI; a += 0.29) {
      const s = shellInFlight({ x: 0, y: 0 }, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 }, 0.4);
      const heading = s.frame % SHELL_HEADINGS;
      expect(Math.floor(s.frame / SHELL_HEADINGS)).toBe(s.pitchFrame);
      expect(Math.abs(s.bodyRotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap(heading * step + s.bodyRotation - s.heading)).toBeCloseTo(0);
    }
    // A Pact shell flying west uses the west-facing frames rather than the east-facing frames turned half a circle.
    const west = shellInFlight({ x: 415, y: 0 }, { x: -50, y: 0 }, 0.4);
    expect(west.frame % SHELL_HEADINGS).toBe(SHELL_HEADINGS / 2);
    expect(west.bodyRotation).toBeCloseTo(0);
  });

  it('draws at world scale with an exaggeration tune value and scales slightly with altitude', () => {
    expect(SHELL_WORLD_M).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeGreaterThan(0);
    const start = shellInFlight(from, to, 0);
    const mid = shellInFlight(from, to, 0.5);
    const end = shellInFlight(from, to, 1);
    expect(start.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(end.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(mid.size).toBeGreaterThan(start.size);
    expect(shellInFlight(from, to, 0, SHELL_EXAGGERATION * 2).size).toBeCloseTo(start.size * 2);
  });

  it('slides the shadow from a south-west offset at altitude to directly under the shell as it lands', () => {
    const mid = shellInFlight(from, to, 0.5);
    const late = shellInFlight(from, to, 0.85);
    const end = shellInFlight(from, to, 1);

    // Sun is in the north-east (45 deg), so the shadow falls south-west (-x, -y)
    expect(mid.shadow.x).toBeLessThan(mid.x);
    expect(mid.shadow.y).toBeLessThan(mid.y);

    const midOffset = Math.hypot(mid.shadow.x - mid.x, mid.shadow.y - mid.y);
    const lateOffset = Math.hypot(late.shadow.x - late.x, late.shadow.y - late.y);
    const endOffset = Math.hypot(end.shadow.x - end.x, end.shadow.y - end.y);

    expect(midOffset).toBeGreaterThan(lateOffset);
    expect(lateOffset).toBeGreaterThan(0);
    expect(endOffset).toBeCloseTo(0);
    expect({ x: end.shadow.x, y: end.shadow.y }).toEqual({ x: to.x, y: to.y });
  });

  it('surfaces friendly shells from the Commander HQ and never shows enemy shells or launch sources', () => {
    const tune = { ...DEFAULT_TUNE, barrageCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [
      { tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 40, y: 20 } },
      { tick: m.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } },
    ]);
    // Advance into the flight window (after 2.5 s warning)
    const ticks = Math.round((tune.barrageWarningSeconds + 0.5) * tune.hz);
    for (let i = 0; i < ticks; i++) step(m, []);

    const natoView = commanderView(m, 'nato');
    const natoShells = barrageShells(natoView, TEST_FIELD);
    expect(natoShells.length).toBeGreaterThan(0);
    // Every shown shell arcs from NATO's HQ toward NATO's target, never Pact's HQ
    for (const s of natoShells) {
      expect(s.from).toEqual({ x: TEST_FIELD.hqs.nato.x, y: TEST_FIELD.hqs.nato.y });
      expect(Math.hypot(s.to.x - 40, s.to.y - 20)).toBeLessThanOrEqual(tune.barrageSpreadM);
    }

    // If only the enemy called a barrage, the Commander's view has no shells at all
    const mEnemyOnly = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(mEnemyOnly, [{ tick: mEnemyOnly.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } }]);
    for (let i = 0; i < ticks; i++) step(mEnemyOnly, []);
    expect(barrageShells(commanderView(mEnemyOnly, 'nato'), TEST_FIELD)).toEqual([]);
  });
});

describe('shell smoke trail', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('registers the baked smoke puff sheet', () => {
    expect(SMOKE_PUFF_SHEET.frames).toBe(SMOKE_PUFF_VARIANTS);
  });

  it('has no puffs before the shell leaves and grows as it flies', () => {
    expect(shellTrail(from, to, 0)).toEqual([]);
    expect(shellTrail(from, to, 0.2).length).toBeGreaterThan(3);
  });

  it('never draws a puff ahead of the shell', () => {
    for (const u of [0.05, 0.3, 0.5, 0.7, 0.95, 1]) {
      const shell = shellInFlight(from, to, u);
      const hx = Math.cos(shell.heading);
      const hy = Math.sin(shell.heading);
      for (const p of shellTrail(from, to, u)) {
        expect((p.x - shell.x) * hx + (p.y - shell.y) * hy, `puff ahead of shell at flight ${u}`).toBeLessThan(0);
      }
    }
  });

  it('leaves each puff where it was emitted, fading and swelling on its own until it is gone', () => {
    const early = shellTrail(from, to, 0.3);
    const later = shellTrail(from, to, 0.35);
    const newest = early.at(-1)!;
    const same = later.find((p) => p.id === newest.id)!;
    expect({ x: same.x, y: same.y, frame: same.frame }).toEqual({ x: newest.x, y: newest.y, frame: newest.frame });
    expect(same.opacity).toBeLessThan(newest.opacity);
    expect(same.size).toBeGreaterThan(newest.size);

    // Puffs older than their lifetime are gone, so the trail is a fading tail, not a route back to the HQ.
    const oldest = shellTrail(from, to, 0.9)[0]!;
    expect(oldest.emitted).toBeGreaterThanOrEqual(0.9 - TRAIL_PUFF_LIFE);
    for (const p of shellTrail(from, to, 0.9)) expect(p.frame).toBeLessThan(SMOKE_PUFF_VARIANTS);
  });
});
