import { describe, expect, it } from 'vitest';
import { aloft } from './missile';
import { GUNSHIP_HEADINGS, GUNSHIP_SHEET, gunshipPose, gunshipShell, gunshipsInAir } from './gunship';
import { SHELL_HEADINGS } from './shell';

const craft = { x: 150, y: 0, fx: 0, fy: 1 };

describe('gunship pose', () => {
  it('flies level from its Faction row lifted to cruise altitude over its shadow, banks only into a turn, and lies flat as a Wreck', () => {
    const level = gunshipPose({ side: 'nato', craft: { ...craft, turn: 0 } });
    expect(level).toMatchObject({ ...aloft(craft), body: { frame: 4, rotation: 0 }, shadow: { x: 150, y: 0, frame: GUNSHIP_SHEET.frames - 1 } });
    expect(gunshipPose({ side: 'pact', craft }).body.frame).toBe(GUNSHIP_HEADINGS + 4);
    expect(gunshipPose({ side: 'nato', craft: { ...craft, turn: 1 } }).body).toEqual({ frame: 2 * GUNSHIP_HEADINGS + 4, rotation: 0 });
    expect(gunshipPose({ side: 'pact', craft: { ...craft, turn: 1 } }).body.frame).toBe(3 * GUNSHIP_HEADINGS + 4);
    expect(gunshipPose({ side: 'pact', craft: { ...craft, turn: 1 }, wreck: true })).toMatchObject({ x: 150, y: 0, body: { frame: 4 * GUNSHIP_HEADINGS + 4 } });
  });

  it('a right turn is the left bank flipped: the frame baked at the mirrored heading, turned so the nose still points along its heading', () => {
    expect(gunshipPose({ side: 'nato', craft: { ...craft, turn: -1 } }).body).toEqual({ frame: 2 * GUNSHIP_HEADINGS + 4, rotation: expect.closeTo(0), mirror: true });
    const a = 0.3;
    const step = (2 * Math.PI) / GUNSHIP_HEADINGS;
    const { body } = gunshipPose({ side: 'nato', craft: { x: 0, y: 0, fx: Math.cos(a), fy: Math.sin(a), turn: -1 } });
    expect(body).toEqual({ frame: 2 * GUNSHIP_HEADINGS + 7, rotation: expect.closeTo(a - step), mirror: true });
    expect(Math.PI - 7 * step + body.rotation).toBeCloseTo(a); // the frame's nose once flipped, then turned
  });

  it('keeps the baked sun north-east: only the remainder of the heading turns the body, the shadow turns by the whole of it', () => {
    const a = 0.3;
    const p = gunshipPose({ side: 'nato', craft: { x: 0, y: 0, fx: Math.cos(a), fy: Math.sin(a) } });
    expect(p.body).toEqual({ frame: 1, rotation: expect.closeTo(a - (2 * Math.PI) / GUNSHIP_HEADINGS) });
    expect(p.shadow.rotation).toBeCloseTo(a);
  });
});

describe('gunship shell', () => {
  it('leaves the aircraft as drawn, arcs down steeper and steeper, and lands on its spot', () => {
    const from = { x: 150, y: 0 };
    const to = { x: 40, y: 10 };
    expect(gunshipShell(from, to, 0)).toMatchObject(aloft(from));
    const end = gunshipShell(from, to, 1);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
    const pitch = (u: number) => Math.floor(gunshipShell(from, to, u).frame / SHELL_HEADINGS);
    expect(pitch(0)).toBe(3); // level at the muzzle
    expect(pitch(1)).toBeGreaterThan(pitch(0.3));
  });
});

describe('gunships in the air', () => {
  it('lists every Gunship effect with its aircraft, the enemy\'s too, and none once shot down', () => {
    const base = { asset: 'gunship' as const, x: 0, y: 0, radius: 150, left: 10, total: 70 };
    const list = gunshipsInAir([{ ...base, side: 'nato', craft: { ...craft, turn: 1 } }, { ...base, side: 'pact', craft: { ...craft, turn: 0 } }, { ...base, side: 'nato' }]);
    expect(list.map((g) => [g.side, g.craft.turn])).toEqual([['nato', 1], ['pact', 0]]);
  });
});
