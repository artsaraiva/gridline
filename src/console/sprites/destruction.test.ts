import { describe, expect, it } from 'vitest';
import { blastsOf, burn, type DeathRecord, deathLook, deathOf, DEATH_CAP, type DestroyedEvent, fallOf, kickOf, recordDeath, restMs, touchdownMs, turretOf } from './destruction';

const event = (vehicle: DestroyedEvent['vehicle'], from?: { x: number; y: number }): DestroyedEvent => ({ kind: 'destroyed', side: 'pact', id: 7, vehicle, x: 100, y: 40, fx: 1, fy: 0, ...(from && { from }) });
const death = (vehicle: DestroyedEvent['vehicle'], from?: { x: number; y: number }, at = 1000): DeathRecord => recordDeath([], event(vehicle, from), at).at(-1)!;

describe('a vehicle death: what it shows from its destroyed event', () => {
  it('keeps the newest DEATH_CAP deaths and finds a Wreck\'s by its kind and spot', () => {
    const list: DeathRecord[] = [];
    for (let i = 0; i <= DEATH_CAP; i++) recordDeath(list, { ...event('tank'), x: i }, i);
    expect(list).toHaveLength(DEATH_CAP);
    expect(list[0]!.x).toBe(1);
    expect(deathOf(list, { kind: 'tank', x: 5, y: 40 })?.at).toBe(5);
    expect(deathOf(list, { kind: 'jeep', x: 5, y: 40 })).toBeUndefined();
  });

  it('a tank burns in the hatches, then its ammunition goes: one blast, and the turret is thrown clear and stays there', () => {
    const d = death('tank');
    expect(blastsOf(d)).toEqual([expect.objectContaining({ x: 100, y: 40, ms: 450 })]);
    expect(turretOf(d, 1400)).toMatchObject({ up: 0, turn: 0 });
    expect(Math.hypot(turretOf(d, 1400).dx, turretOf(d, 1400).dy)).toBe(0);
    expect(deathLook(d, 1200).streaks).toHaveLength(2);
    const flying = turretOf(d, 1000 + 450 + 450);
    expect(flying.up).toBeGreaterThan(4);
    const landed = turretOf(d, 1000 + 5000);
    expect(landed.up).toBe(0);
    expect(Math.hypot(landed.dx, landed.dy)).toBeCloseTo(9);
    expect(turretOf(d, 1000 + 60_000)).toEqual(landed);
  });

  it('burns hard, then smoulders, then goes out; the smoke stops with it and the scorch stays', () => {
    const d = death('tank');
    expect([burn(d, 0), burn(d, 10.9)]).toEqual([1, 1]);
    expect(burn(d, 30)).toBe(0.25);
    expect(burn(d, 60)).toBe(0);
    expect(deathLook(d, 1000 + 8000).smoke.length).toBeGreaterThan(8);
    const cold = deathLook(d, 1000 + 120_000);
    expect([cold.smoke, cold.fires, cold.streaks]).toEqual([[], [], []]);
    expect(cold.scorch!.opacity).toBeGreaterThan(0.5);
  });

  it('a jeep hops and slews, then lies as the Simulation has it; its wheel comes to rest away from it', () => {
    const d = death('jeep');
    expect(kickOf(d, 1350).up).toBeGreaterThan(1);
    expect(kickOf(d, 1700)).toEqual({ dx: 0, dy: 0, up: 0, turn: expect.closeTo(0) });
    const wheel = deathLook(d, 1000 + 10_000).pieces[0]!;
    expect(Math.hypot(wheel.x - 100, wheel.y - 40)).toBeCloseTo(18);
    expect(wheel.shadow).toEqual({ x: wheel.x, y: wheel.y });
  });

  it('an AA sets off its rounds for five seconds and one missile, and its turret slews and stops', () => {
    const d = death('aa');
    expect(deathLook(d, 1000 + 1000).streaks.length).toBeGreaterThan(0);
    expect(deathLook(d, 1000 + 2200).fires.some((f) => Math.hypot(f.x - 100, f.y - 40) > 15)).toBe(true); // the missile's motor, away from the hull
    expect(deathLook(d, 1000 + 9000).streaks).toEqual([]);
    expect(turretOf(d, 1000 + 2500).turn).toBeCloseTo(0.9);
    expect(turretOf(d, 1000 + 2500).dx).toBe(0);
  });

  it('a helicopter spins down over the spot it was hit, burning, and blows up when it meets the ground', () => {
    const d = death('helicopter', { x: 100, y: 40 });
    const first = fallOf(d, 1000)!;
    expect(first).toMatchObject({ x: 100, y: 40, lift: 20, turn: 0 });
    const half = fallOf(d, 1600)!;
    expect(half.lift).toBeLessThan(first.lift);
    expect(half.turn).toBeGreaterThan(3);
    expect(deathLook(d, 1600).fires.every((f) => f.high)).toBe(true);
    expect(fallOf(d, 1000 + touchdownMs(d))).toBeNull();
    expect(blastsOf(d)[0]!.ms).toBe(touchdownMs(d));
    expect(recordDeath([], event('helicopter', { x: 100, y: 40 }), 0, 2).at(-1)!.turn0).toBe(2); // it goes on turning from its glide
  });

  it('a jet keeps its way down to a touchdown short of its Wreck, blows up there and slides the rest, leaving a scar', () => {
    const d = death('jet', { x: -10, y: 40 });
    expect(fallOf(d, 1000)).toMatchObject({ x: -10, y: 40, lift: 20 });
    let last = -Infinity;
    for (let t = 0; t < restMs(d); t += 50) {
      const f = fallOf(d, 1000 + t)!;
      expect(f.x).toBeGreaterThanOrEqual(last);
      last = f.x;
    }
    const blast = blastsOf(d)[0]!;
    expect(blast).toMatchObject({ x: 70, y: 40, ms: touchdownMs(d) });
    expect(fallOf(d, 1000 + touchdownMs(d))).toMatchObject({ x: 70, lift: 0 });
    expect(fallOf(d, 1000 + restMs(d))).toBeNull();
    expect(deathLook(d, 1000 + restMs(d)).scar).toMatchObject({ x0: 70, y0: 40, x1: 100, y1: 40 });
  });

  it('a vehicle that died on the ground has no fall, and one that leaves no Wreck shows nothing', () => {
    expect(fallOf(death('helicopter'), 1100)).toBeNull();
    expect(blastsOf(death('drone'))).toEqual([]);
    expect(deathLook(death('drone'), 2000).scorch).toBeNull();
  });
});
