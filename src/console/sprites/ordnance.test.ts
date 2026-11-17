import { describe, expect, it } from 'vitest';
import { TEST_FIELD } from '../../maps/test-field';
import { burstLook, climbed, CLIMB_MS, lifted } from './air-missile';
import { BATTERY_GUNS, batteryOf, recoil } from './battery';
import { bombInFlight } from './bomb';
import { aloft } from './missile';
import { MUZZLE_BLAST_MS, muzzleLook } from './muzzle';
import { SHELL_HEADINGS, SHELL_PITCH_FRAMES, shellGlow, shellLight } from './shell';

describe('the battery: four guns behind each HQ', () => {
  it('stands behind its HQ, away from the enemy, its guns in a row across the line to the enemy HQ', () => {
    const b = batteryOf(TEST_FIELD, 'nato');
    const hq = TEST_FIELD.hqs.nato;
    const enemy = TEST_FIELD.hqs.pact;
    expect(b.guns).toHaveLength(BATTERY_GUNS);
    expect(Math.hypot(enemy.x - b.x, enemy.y - b.y)).toBeGreaterThan(Math.hypot(enemy.x - hq.x, enemy.y - hq.y));
    for (const g of b.guns) expect((g.x - b.x) * b.fx + (g.y - b.y) * b.fy).toBeCloseTo(0); // across the bearing
    expect(Math.hypot(b.guns[0]!.x - b.guns[3]!.x, b.guns[0]!.y - b.guns[3]!.y)).toBeCloseTo(27);
    expect(batteryOf(TEST_FIELD, 'pact').fx).toBeCloseTo(-b.fx);
  });

  it('a gun is thrown back as it fires and runs out again', () => {
    expect(recoil(-1)).toBe(0);
    expect(recoil(0)).toBeGreaterThan(1);
    expect(recoil(2000)).toBeLessThan(0.01);
  });
});

describe("a heavy gun's muzzle blast", () => {
  const blast = { x: 10, y: 0, heading: 0, at: 1000, power: 1 };

  it('flashes, darts flame forward with two jets off the brake, runs a dust ring out and blows smoke on along the shot', () => {
    const first = muzzleLook(blast, 1030);
    expect(first.flash!.opacity).toBeGreaterThan(0.5);
    expect(first.flames).toHaveLength(3);
    expect(first.flames[0]!.x1).toBeGreaterThan(20);
    const later = muzzleLook(blast, 2000);
    expect([later.flash, later.light, later.ring, later.flames]).toEqual([null, null, null, []]);
    expect(later.smoke.length).toBeGreaterThan(0);
    for (const p of later.smoke) expect(p.x).toBeGreaterThan(10);
    expect(muzzleLook(blast, 1000 + MUZZLE_BLAST_MS).smoke).toEqual([]);
  });

  it('is smaller for a smaller gun, and a backblast has no dart and throws its smoke the other way', () => {
    expect(muzzleLook({ ...blast, power: 0.5 }, 1030).flash!.size).toBeCloseTo(muzzleLook(blast, 1030).flash!.size / 2);
    const back = muzzleLook({ ...blast, back: true }, 2000);
    expect(muzzleLook({ ...blast, back: true }, 1030).flames).toEqual([]);
    expect(Math.min(...back.smoke.map((p) => p.x))).toBeLessThan(10);
  });
});

describe('a falling shell burns', () => {
  it('glows harder as it comes down and lights the ground only in its last moments', () => {
    expect(shellGlow(1).size).toBeGreaterThan(shellGlow(0).size);
    expect(shellGlow(1).opacity).toBeGreaterThan(shellGlow(0).opacity);
    expect(shellLight(0.8)).toBeNull();
    expect(shellLight(1)!.opacity).toBeGreaterThan(shellLight(0.9)!.opacity);
  });
});

describe("a jet's bomb in the air", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 180, y: 0 };

  it('leaves at the jet\'s altitude over where the jet was, falls faster and faster, and lands on its mark', () => {
    const start = bombInFlight(from, to, 0);
    expect({ x: start.x, y: start.y }).toEqual(aloft(from));
    expect(start.ground).toEqual(from);
    const mid = bombInFlight(from, to, 0.5);
    expect(mid.height).toBe(0.75);
    expect(mid.ground.x).toBe(90);
    const end = bombInFlight(from, to, 1);
    expect({ x: end.x, y: end.y, height: end.height }).toEqual({ x: 180, y: 0, height: 0 });
    expect(start.size).toBeGreaterThan(end.size);
  });

  it('noses over as it falls, at the nearest baked heading', () => {
    expect(bombInFlight(from, to, 0).frame).toBe(0);
    expect(bombInFlight(from, to, 1).frame).toBe((SHELL_PITCH_FRAMES - 1) * SHELL_HEADINGS);
    expect(bombInFlight(from, { x: 0, y: 100 }, 0).frame).toBe(SHELL_HEADINGS / 4);
    expect(bombInFlight(from, to, 0.5).rotation).toBeCloseTo(0);
  });
});

describe('a lock-on missile', () => {
  it('climbs off the ground to its altitude over its first moments', () => {
    expect(climbed(0)).toBe(0);
    expect(climbed(CLIMB_MS / 2)).toBeCloseTo(0.5);
    expect(climbed(CLIMB_MS * 3)).toBe(1);
    expect(lifted({ x: 5, y: 5 }, 0)).toEqual({ x: 5, y: 5 });
    expect(lifted({ x: 5, y: 5 }, 1)).toEqual(aloft({ x: 5, y: 5 }));
  });

  it('ends as an airburst on a hit (flash, ring, fragments, smoke) and as one dark puff when it is spent', () => {
    const hit = burstLook({ x: 0, y: 0, at: 0, hit: true, seed: 1 }, 100);
    expect(hit.flash).not.toBeNull();
    expect(hit.ring).not.toBeNull();
    expect(hit.fragments.length).toBeGreaterThan(8);
    expect(burstLook({ x: 0, y: 0, at: 0, hit: true, seed: 1 }, 1500).smoke.length).toBeGreaterThan(2);
    const spent = burstLook({ x: 0, y: 0, at: 0, hit: false, seed: 1 }, 50);
    expect([spent.ring, spent.fragments]).toEqual([null, []]);
    expect(spent.smoke).toEqual([expect.objectContaining({ dark: true })]);
    expect(burstLook({ x: 0, y: 0, at: 0, hit: false, seed: 1 }, 2000).smoke).toEqual([]);
  });
});
