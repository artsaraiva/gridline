import { describe, expect, it } from 'vitest';
import { createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { SimEvent, Tune, Vec2 } from './types';
import type { Vehicle } from './vehicles';

// #131: what a piloted helicopter does: bail, repair, ferry (pickup, hot drop), support, wait.
const T = DEFAULT_TUNE;
const HZ = T.hz;
const P: Vec2 = { x: 500, y: 0 };
const field = (points: Vec2[]) => ({
  name: 'field',
  playArea: [
    { x: -700, y: -700 },
    { x: 700, y: -700 },
    { x: 700, y: 700 },
    { x: -700, y: 700 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 600 } },
  points: points.map((p, i) => ({ id: 'ABC'[i]!, name: 'ABC'[i]!, ...p })),
});
const FAR = { x: 600, y: -600 };

/**
 * Two nato Squads (Soldiers 0..3, 4..7), two pact (8..15, parked far off and blind), nato's helicopter (vehicle 16) on its
 * pad at the HQ. Neither nato Squad rides (their ride distance is out of reach) unless a test says so.
 */
function scene(points: Vec2[], tune: Partial<Tune> = {}, seed = 1): Match {
  const full: Tune = { ...T, squadSize: 4, speedJitter: 0, spread: 0, strayChance: 0, visionM: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 1, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO, ...tune };
  const m = thinkOnId(createMatch({ seed, map: field(points), tune: full, squadsPerSide: 2, commanderSide: 'nato' }));
  m.soldiers.forEach((s) => Object.assign(s, s.side === 'nato' ? { x: -300 + 3 * s.id, y: 300 } : { ...FAR, speed: 0 }));
  for (const sq of m.squads) sq.rideM = 1e6;
  return m;
}
const heliOf = (m: Match) => m.vehicles.find((v) => v.side === 'nato' && v.kind === 'helicopter')!;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** `seats` aboard `h` (pilot, left gun, right gun, three passengers; -1 empty), the first three crew, at `at` if given (then airborne, heading east). */
function load(m: Match, h: Vehicle, seats: number[], o: { at?: Vec2; hp?: number } = {}) {
  Object.assign(h, { seats, ...(o.hp !== undefined && { hp: o.hp }), ...(o.at && { ...o.at, airborne: true, parked: false, speed: 20, fx: 1, fy: 0 }) });
  seats.forEach((id, k) => id >= 0 && Object.assign(m.soldiers[id]!, { vehicle: h.id, x: h.x, y: h.y, ...(k < 3 && { crew: true, crewUntil: 1e9, detached: true }) }));
}
/** Squad `sq` has seen an enemy at each of `at` just now. */
const know = (m: Match, sq: number, ...at: Vec2[]) => m.squads[sq]!.memory.splice(0, 9, ...at.map((p, i) => ({ id: 100 + i, ...p, tick: m.tick, source: 'seen' as const })));
const run = (m: Match, seconds: number, each: (events: SimEvent[]) => void = () => {}) => {
  for (let i = 0; i < seconds * HZ; i++) each(step(m, []));
};

describe('#131 bail', () => {
  it('under a third of its hit points everyone aboard, crew too, jumps; it glides crashSeconds, then is a Wreck; nobody is hurt', () => {
    const m = scene([P]);
    const h = heliOf(m);
    load(m, h, [1, 5, -1, 2, 6, -1], { at: { x: 0, y: 0 }, hp: T.heliHp / 4 });
    const tickets = { ...m.tickets };
    let jumped = -1;
    let crashed = -1;
    run(m, 10, () => {
      if (jumped < 0 && m.soldiers[1]!.chute) jumped = m.tick;
      if (crashed < 0 && m.wrecks.length) crashed = m.tick;
      if (crashed < 0 && jumped >= 0) expect(h.airborne).toBe(true); // it glides on
    });
    expect(jumped).toBeGreaterThan(0);
    for (const id of [1, 5, 2, 6]) expect(m.soldiers[id]).toMatchObject({ vehicle: -1, crew: false });
    expect(h.seats).toEqual([-1, -1, -1, -1, -1, -1]);
    expect((crashed - jumped) / HZ).toBeCloseTo(T.crashSeconds, 0);
    expect(m.wrecks).toHaveLength(1);
    expect(h.deadAt).toBeGreaterThan(0);
    expect(m.soldiers.filter((s) => s.state === 'alive')).toHaveLength(m.soldiers.length);
    expect(m.tickets).toEqual(tickets);
    run(m, T.vehicleRespawnSeconds); // a fresh one appears on the pad
    expect(h.deadAt).toBe(-1);
    expect(h.hp).toBe(T.heliHp);
  });
});

describe('#131 repair', () => {
  it('under half its hit points the passengers jump where they are, it flies home, and on the pad regains heliRepairHpPerS until full, then works again', () => {
    const m = scene([P]);
    const h = heliOf(m);
    load(m, h, [1, -1, -1, 2, 6, -1], { at: { x: 0, y: 0 }, hp: T.heliHp * 0.45 });
    run(m, 3);
    for (const id of [2, 6]) expect(m.soldiers[id]).toMatchObject({ vehicle: -1 });
    expect(h.seats).toEqual([1, -1, -1, -1, -1, -1]);
    expect(h.airborne).toBe(true);
    let landed = -1;
    for (let i = 0; i < 90 * HZ && landed < 0; i++) {
      step(m, []);
      if (!h.airborne) landed = m.tick;
    }
    expect(landed).toBeGreaterThan(0);
    expect(dist(h, h.slot)).toBeLessThan(1);
    const hp0 = h.hp;
    run(m, 5);
    expect(h.hp - hp0).toBeCloseTo(5 * T.heliRepairHpPerS, 0);
    run(m, 30);
    expect(h.hp).toBe(T.heliHp);
    expect(h.job).not.toBe('repair');
  });
});

describe('#131 ferry', () => {
  /** Squad 1 stands far up the field with a long ride and nothing by it; the helicopter has its pilot (Soldier 1) aboard and `gunners` (Soldiers 2, 3) in its guns; a pact Soldier near the goal when `hot`. A Squad of four fills a gun seat too, so is a gunner of its own. */
  function call(o: { gunners?: number[]; hot?: boolean; squadSize?: number } = {}) {
    const m = scene([P], { squadSize: o.squadSize ?? 4 });
    m.squads[1]!.rideM = 100;
    const h = heliOf(m);
    load(m, h, [1, ...[0, 1].map((k) => o.gunners?.[k] ?? -1), -1, -1, -1]);
    m.soldiers.filter((s) => s.squad === 1).forEach((s, k) => Object.assign(s, { x: -100 + 3 * k, y: 0 }));
    if (o.hot) Object.assign(m.soldiers.find((s) => s.side === 'pact')!, { x: P.x + 20, y: 30, hp: 1e9 });
    return { m, h };
  }
  /** Plays it out, noting when Squad 1 first climbs in, where the helicopter first sets down after that, when its riders first jump, and who fired from it. */
  function trip(m: Match, h: Vehicle, hot: boolean) {
    const log = { fetch: -1, pickup: null as Vec2 | null, boarded: -1, down: null as Vec2 | null, jumped: -1, over: Infinity, orbit: [] as number[], fired: new Set<number>() };
    const riders = m.soldiers.filter((s) => s.squad === 1);
    for (let i = 0; i < 240 * HZ; i++) {
      if (hot) know(m, 1, { x: P.x + 20, y: 30 });
      for (const e of step(m, [])) if (e.kind === 'shot' && e.side === 'nato' && m.soldiers[e.from]!.vehicle === h.id) log.fired.add(e.from);
      if (h.fetch === 1) log.fetch = m.tick;
      if (log.boarded < 0 && riders.some((s) => s.vehicle === h.id)) log.boarded = m.tick;
      if (log.boarded >= 0 && !log.down && !h.airborne && h.landedAt >= log.boarded && dist(h, h.slot) > 50) log.down = { x: h.x, y: h.y };
      if (log.boarded < 0 && !log.pickup && !h.airborne && h.landedAt > 0 && dist(h, h.slot) > 50) log.pickup = { x: h.x, y: h.y };
      if (log.jumped < 0 && riders.some((s) => s.chute)) [log.jumped, log.over] = [m.tick, h.airborne && h.lz ? dist(h, h.lz) : Infinity];
      if (log.boarded >= 0 && log.jumped < 0 && h.airborne) log.orbit.push(dist(h, P) - T.orbitM);
    }
    return log;
  }

  it('a Squad far from the HQ with a long ride and no vehicle by it is fetched: the helicopter lands by it, it boards and is taken to a quiet goal, where it lands', () => {
    const { m, h } = call();
    const log = trip(m, h, false);
    expect(log.fetch).toBeGreaterThan(0);
    expect(log.pickup).not.toBeNull();
    const squad = m.soldiers.filter((s) => s.squad === 1);
    expect(log.boarded).toBeGreaterThan(log.fetch);
    expect(log.down).not.toBeNull();
    expect(dist(log.down!, P)).toBeLessThan(T.lzM[1] + 5);
    expect(log.jumped).toBe(-1);
    for (const s of squad) expect(dist(s, P)).toBeLessThan(T.lzM[1] + 60);
  });

  it('a hot goal: it circles the point at orbitM for orbitSeconds, its gunner firing, then the riders jump over the Landing Zone', () => {
    const { m, h } = call({ hot: true, gunners: [2] });
    const log = trip(m, h, true);
    expect(log.jumped).toBeGreaterThan(log.boarded);
    expect(log.over).toBeLessThan(2);
    expect(log.down).toBeNull();
    const ring = log.orbit.filter((e) => Math.abs(e) < 30).length;
    expect(ring / HZ).toBeGreaterThan(T.orbitSeconds * 0.8);
    expect(ring / HZ).toBeLessThan(T.orbitSeconds * 1.8);
    expect(log.fired.has(2)).toBe(true);
  });

  it('a hot goal with no gunner aboard (a Squad of three fills the passenger seats only): it never circles, it lands', () => {
    const { m, h } = call({ hot: true, squadSize: 3 });
    const log = trip(m, h, true);
    expect(log.jumped).toBe(-1);
    expect(log.down).not.toBeNull();
  });
});

describe('#131 support', () => {
  const A: Vec2 = { x: -200, y: 0 };
  const B: Vec2 = { x: 300, y: 0 };
  /** Samples of (the helicopter, its distance to `c`) once it has had `settle` seconds, to `until`. */
  function circle(seats: number[], c: Vec2[], o: { seed?: number; own?: boolean } = {}) {
    const m = scene(c, {}, o.seed ?? 1);
    if (o.own) m.points[0]!.owner = 'nato';
    const h = heliOf(m);
    load(m, h, seats);
    const samples: { x: number; y: number; fx: number; fy: number; speed: number }[] = [];
    for (let i = 0; i < 110 * HZ; i++) {
      know(m, 0, ...c.map((p) => ({ x: p.x, y: p.y + 20 })));
      step(m, []);
      if (i > 80 * HZ) samples.push({ x: h.x, y: h.y, fx: h.fx, fy: h.fy, speed: h.speed });
    }
    return { m, h, samples };
  }
  const side = (s: { x: number; y: number; fx: number; fy: number }, c: Vec2) => (c.x - s.x) * -s.fy + (c.y - s.y) * s.fx; // > 0: the point is on its left

  it('with a gunner and no ferry it circles a point with known enemies at orbitM and orbitMps', () => {
    const { samples } = circle([1, 5, -1, -1, -1, -1], [B]);
    for (const s of samples) {
      expect(dist(s, B)).toBeGreaterThan(T.orbitM - 30);
      expect(dist(s, B)).toBeLessThan(T.orbitM + 30);
      expect(Math.abs(s.speed - T.orbitMps)).toBeLessThan(3);
    }
  });

  it('with one gunner the manned side faces the point', () => {
    for (const seed of [1, 2, 3, 4]) {
      expect(circle([1, 5, -1, -1, -1, -1], [B], { seed }).samples.every((s) => side(s, B) > 0), `left, seed ${seed}`).toBe(true);
      expect(circle([1, -1, 5, -1, -1, -1], [B], { seed }).samples.every((s) => side(s, B) < 0), `right, seed ${seed}`).toBe(true);
    }
  });

  it('with both guns manned the way round varies across seeds', () => {
    const ways = [1, 2, 3, 4, 5, 6].map((seed) => Math.sign(side(circle([1, 5, 6, -1, -1, -1], [B], { seed }).samples[0]!, B)));
    expect(new Set(ways)).toEqual(new Set([-1, 1]));
  });

  it('an own point under threat comes before another', () => {
    const { samples } = circle([1, 5, -1, -1, -1, -1], [A, B], { own: true });
    for (const s of samples) expect(Math.abs(dist(s, A) - T.orbitM)).toBeLessThan(30);
  });

  it('with no gunner it never circles, and with no pilot it never flies', () => {
    const a = circle([1, -1, -1, -1, -1, -1], [B]);
    expect(a.h.airborne).toBe(false);
    expect(dist(a.h, a.h.slot)).toBeLessThan(1);
    const m = scene([B]);
    const h = heliOf(m);
    load(m, h, [-1, 5, 6, -1, -1, -1]);
    for (let i = 0; i < 60 * HZ; i++) {
      know(m, 0, { x: B.x, y: B.y + 20 });
      know(m, 1, { x: B.x, y: B.y + 20 });
      h.seats[0] = -1;
      step(m, []);
    }
    expect(h.airborne).toBe(false);
  });
});
