import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { DEFAULT_TUNE } from '../../sim/tune';
import { MISSILE_DIVE_M, MISSILE_FACTIONS, MISSILE_HEADINGS, MISSILE_PITCH_FRAMES, MISSILE_WORLD_M, missileInFlight, missiles, missileTrail } from './missile';

const from = { x: -486, y: 0 };
const to = { x: 114, y: 0 }; // 600 m east

describe('cruise missile pose', () => {
  it('flies level at altitude from the launch point straight to the spot, drawn lifted north-east of the ground it is over, with its shadow on the ground', () => {
    const half = missileInFlight({ from, x: to.x, y: to.y, flight: 0.5, side: 'nato', radius: 35, left: 5 });
    expect(half.ground).toEqual({ x: -186, y: 0 });
    expect(half.altitude).toBeGreaterThan(0);
    expect(half.x).toBeGreaterThan(half.ground.x);
    expect(half.y).toBeGreaterThan(half.ground.y);
    expect(half.shadow).toEqual({ x: half.ground.x, y: half.ground.y, rotation: half.heading });
    expect(half.pitchFrame).toBe(0); // level
    expect(half.heading).toBeCloseTo(0);
    expect(half.size).toBeCloseTo(MISSILE_WORLD_M * 2.5);
  });

  it('pitches down over the last metres into the target and is on the ground at the hit', () => {
    const d = (rem: number) => missileInFlight({ from, x: to.x, y: to.y, flight: 1 - rem / 600, side: 'nato', radius: 35, left: 5 });
    expect(d(MISSILE_DIVE_M + 1).pitchFrame).toBe(0);
    expect(d(MISSILE_DIVE_M / 2).pitchFrame).toBeGreaterThan(0);
    expect(d(0).pitchFrame).toBe(MISSILE_PITCH_FRAMES - 1);
    expect(d(MISSILE_DIVE_M / 2).altitude).toBeCloseTo(d(MISSILE_DIVE_M + 1).altitude / 2, 0);
    const end = d(0);
    expect({ x: end.x, y: end.y, altitude: end.altitude }).toEqual({ x: to.x, y: to.y, altitude: 0 });
  });

  it('keeps the baked sun north-east in any direction: nearest baked heading in the caller Faction rows, only the remainder rotated', () => {
    const step = (2 * Math.PI) / MISSILE_HEADINGS;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let a = -Math.PI; a < Math.PI; a += 0.29) {
      const p = missileInFlight({ from: { x: 0, y: 0 }, x: Math.cos(a) * 300, y: Math.sin(a) * 300, flight: 0.3, side: 'pact', radius: 35, left: 5 });
      expect(Math.floor(p.frame / MISSILE_HEADINGS) % MISSILE_PITCH_FRAMES).toBe(p.pitchFrame);
      expect(Math.floor(p.frame / (MISSILE_HEADINGS * MISSILE_PITCH_FRAMES))).toBe(1); // pact rows
      expect(Math.abs(p.bodyRotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap((p.frame % MISSILE_HEADINGS) * step + p.bodyRotation - p.heading)).toBeCloseTo(0);
    }
    expect(MISSILE_FACTIONS).toBe(2);
    expect(Math.floor(missileInFlight({ from, x: to.x, y: to.y, flight: 0.3, side: 'nato', radius: 35, left: 5 }).frame / (MISSILE_HEADINGS * MISSILE_PITCH_FRAMES))).toBe(0);
  });

  it('trails a contrail from up to 8 s of flight behind it to where it is, never before the launch point; after the hit it hangs and fades with the time left', () => {
    const at = (flight: number, left = 5) => missileTrail(missileInFlight({ from, x: to.x, y: to.y, flight, side: 'nato', radius: 35, left }), left);
    const early = at(0.1); // 60 m flown: the trail starts at the launch point
    expect(early.tail.x).toBeCloseTo(early.head.x - 60);
    expect(early.opacity).toBe(1);
    const mid = at(0.75); // 450 m flown: 8 s at 40 m/s = 320 m of it
    expect(mid.length).toBeCloseTo(320);
    expect(mid.head).toEqual({ x: mid.head.x, y: mid.head.y });
    expect(mid.tail.x).toBeLessThan(mid.head.x);
    expect(at(0)).toMatchObject({ length: 0 });
    expect(at(1, 1).opacity).toBeCloseTo(0.5); // 1 s of the 2 s contact window left
    expect(at(1, 0).opacity).toBe(0);
  });

  it('surfaces every missile in the view, the enemy one included, with its caller as the Faction', () => {
    const tune = { ...DEFAULT_TUNE, missileCooldownSeconds: 0 };
    const map = { ...(await0()), points: [{ id: 'C', name: 'C', x: 0, y: 0, owner: 'nato' as const }] };
    const m = createMatch({ seed: 1, map, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: 0, side: 'nato', kind: 'asset', asset: 'missile', at: { x: 100, y: 50 } }]);
    for (let i = 0; i < 20; i++) step(m, []);
    const shown = missiles(commanderView(m, 'pact'));
    expect(shown).toHaveLength(1);
    expect(shown[0]!.side).toBe('nato');
    expect(shown[0]!.flight).toBeGreaterThan(0);
    expect(shown[0]!.left).toBeGreaterThan(0);
  });
});

function await0() {
  return { name: 'f', playArea: [{ x: -456, y: -456 }, { x: 456, y: -456 }, { x: 456, y: 456 }, { x: -456, y: 456 }], hqs: { nato: { x: -415, y: 0 }, pact: { x: 415, y: 0 } }, grid: { cols: 12, rows: 12, squareM: 76, letters: 'ABCDEFGHIJKL' } };
}
