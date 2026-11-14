// #109 the transport helicopter, at its module's interface: the ferry, where it flies and its sight (#109), its flight and Landing
// Zone (#124), its crew and side guns (#129), and its jobs (#131: bail, repair, ferry, support, wait). What a Commander sees is read
// off the view and the events; its trip (`lz`) and its job, which the view does not show, off its record.
import { describe, expect, it } from 'vitest';
import { commanderView, stateHash, step, type Match } from '../index';
import { ticketsStart } from '../capture';
import { insidePolygon } from '../geometry';
import { DEFAULT_TUNE } from '../tune';
import { crew, play, scene, square, vehicle, viewOf, type Logged } from '../test-scene';
import type { CommanderView, MapData, SimEvent, Tune, Vec2 } from '../types';
import { dogleg } from './flight';
import { boardOnReturn, type VehicleOf } from './index';

type Heli = VehicleOf<'helicopter'>;

const T = DEFAULT_TUNE;
const HZ = T.hz;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** A test scene with one helicopter a Side, waiting on its HQ (the field gives it no helipad). */
const helis = (o: Parameters<typeof scene>[0] = {}) => scene({ ...o, tune: { helisPerSide: 1, ...o.tune } });
const heliOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && x.kind === 'helicopter' && !x.wreck)!;

describe('#109 the transport helicopter ferries a Squad', () => {
  // Nato's Squad is Soldiers 0..3, its helicopter 8, the pact's 9; the pact Squad stands far off its own, so only nato flies. A is far across the field.
  const A = { x: 300, y: 200 };
  const away = { x: 500, y: -500 };
  const ferry = (extra: Partial<Tune> = {}, place: Record<number, Vec2 & { fx?: number; fy?: number }> = {}) =>
    helis({ map: { points: [{ id: 'A', name: 'A', ...A }] }, tune: { visionM: 0, squadSize: 4, ...extra }, place: { 4: away, 5: away, 6: away, 7: away, ...place } });

  it('the Squad boards at match start, it flies a dogleg to the far point, lands off it, unloads, and flies home empty', () => {
    const m = ferry({ crewSeconds: [1000, 1000] });
    const { views } = play(m, 100 * HZ); // #124: braking no harder than speeding up
    const filled = views.findIndex((v) => heliOf(v).seats!.filter((id) => id >= 0).length === 4); // #129: a pilot from the Squad first, #122: the others walk to it and climb in one by one
    expect(filled).toBeGreaterThan(0);
    expect(filled / HZ).toBeLessThan(20);
    expect(heliOf(views[filled]!)).toMatchObject({ id: 8 });
    const up = views.findIndex((v) => heliOf(v).airborne);
    expect(up).toBeGreaterThanOrEqual(filled);
    const landed = views.findIndex((v, i) => i > up && !heliOf(v).airborne);
    const lz = heliOf(views[landed]!);
    const off = dist(lz, A); // #124: a Landing Zone lzM from the point's centre
    expect(off).toBeGreaterThanOrEqual(T.lzM[0] - 0.01);
    expect(off).toBeLessThanOrEqual(T.lzM[1] + 0.01);
    expect(off).toBeGreaterThan(T.captureRadius); // so the passengers walk in
    const lift = views.findIndex((v, i) => i > landed && heliOf(v).airborne);
    expect((lift - landed) / HZ).toBeCloseTo(T.unloadSeconds + T.spoolSeconds, 0); // #124: unloaded, then the rotor spools up
    const pilot = heliOf(views[lift]!).seats![0]!;
    expect([1, 2, 3]).toContain(pilot); // a member of the Squad, never its leader
    expect(heliOf(views[lift]!).seats).toEqual([pilot, -1, -1, -1, -1, -1]); // the pilot stays for its stint
    const last = views.at(-1)!;
    expect(heliOf(last)).toMatchObject({ x: -560, y: 0, seats: [pilot, -1, -1, -1, -1, -1] });
    expect(heliOf(last).airborne).toBeUndefined();
    for (const f of last.friendlies.filter((f) => f.id !== pilot)) expect(dist(f, A)).toBeLessThan(T.captureRadius + 10);
    expect(last.points[0]!.owner).toBe('nato');
  });

  it('its riders never count in a Capture Point it flies over, and count in the one it lands in', () => {
    // pact's B lies on the line to A, out of boarding reach of the passengers' goal choice (A, pact's too, scores higher)
    const m = helis({
      map: { points: [{ id: 'A', name: 'A', ...A, owner: 'pact' }, { id: 'B', name: 'B', x: -130, y: 100, owner: 'pact' }] },
      tune: { visionM: 0, squadSize: 4, doglegMinM: 1e9, lzM: [0, 0] }, // #124: straight, down on the centre
      place: { 4: away, 5: away, 6: away, 7: away },
    });
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    const { views } = play(m, 60 * HZ);
    const up = views.findIndex((v) => heliOf(v).airborne);
    const landed = views.findIndex((v, i) => i > up && !heliOf(v).airborne);
    const over = views.findIndex((v) => Math.hypot(heliOf(v).x + 130, heliOf(v).y - 100) < 5);
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(landed);
    expect(views.every((v) => v.points[1]!.progress === -1)).toBe(true);
    expect(views[landed - 1]!.points[0]!.progress).toBe(-1);
    expect(views[landed]!.points[0]!.progress).toBeGreaterThan(-1); // the tick it sets down, before anyone is out
  });

  it('the enemy Console never shows it while nobody of theirs sees it, in the air or on the ground', () => {
    const { views } = play(ferry(), 40 * HZ, 'pact');
    expect(views.some((v) => v.vehicles!.some((x) => x.id === 8))).toBe(false);
    expect(views.every((v) => !v.lastKnown!.length)).toBe(true);
  });

  it('a rifle Squad under its landing zone shoots it down: everyone aboard dies, a Ticket each; the Wreck lies where it fell; a fresh one stands on the helipad vehicleRespawnSeconds later', () => {
    // pact's Squad stands at A facing the way it comes; nobody is Wounded (hp), so only the helicopter dies
    const atA = (dy: number) => ({ x: A.x, y: A.y + dy, fx: -1, fy: 0 });
    const m = ferry({ visionM: T.visionM, walkSpeed: 0, hp: 1e9, rockets: 0, lzM: [0, 0] }, { 4: atA(-6), 5: atA(-2), 6: atA(2), 7: atA(6) });
    let aboard = 0;
    let dead = -1;
    let back: { tick: number; x: number; y: number; hp: number } | null = null;
    const events: Logged[] = [];
    const views: CommanderView[] = [];
    for (let i = 0; i < 110 * HZ; i++) {
      const was = viewOf(m, 8);
      const tick = m.tick;
      for (const e of step(m, [])) events.push({ ...e, tick });
      views.push(commanderView(m, 'pact'));
      const now = viewOf(m, 8);
      if (dead < 0 && was && !now) [dead, aboard] = [tick, was.seats!.filter((id) => id >= 0).length];
      if (dead >= 0 && !back && now) back = { tick, x: now.x, y: now.y, hp: now.hp! };
    }
    expect(dead).toBeGreaterThan(0);
    expect(new Set(events.filter((e) => e.kind === 'shot' && e.to === 8 && e.hit).map((e) => (e as { from: number }).from)).size).toBeGreaterThan(1);
    const deaths = events.filter((e) => e.kind === 'death' && e.tick === dead);
    expect(deaths).toHaveLength(aboard);
    expect(m.tickets.nato).toBe(ticketsStart(m) - aboard);
    const wreck = views.at(-1)!.vehicles!.find((x) => x.wreck)!;
    expect(wreck).toMatchObject({ side: 'nato', kind: 'helicopter' });
    expect(dist(wreck, A)).toBeLessThan(T.fireRangeM);
    expect(back).toMatchObject({ x: -560, y: 0, hp: 1 });
    expect((back!.tick - dead) / HZ).toBeCloseTo(T.vehicleRespawnSeconds, 0);
  });
});

describe('#109 where the helicopter flies', () => {
  // Two nato Squads (0..3 Ordered to A, 4..7 to B) and their helicopter 16 on the HQ; everyone not aboard stands far off
  const A = { x: 300, y: 200 };
  const B = { x: 300, y: -200 };
  const away = (id: number) => (id < 8 ? { x: -300, y: 550 } : { x: 300, y: -550 }); // apart: even blind eyes see at 0 m
  /** Where the helicopter sets down, `pilot` (crew) flying it and `riders` aboard. */
  function lands(pilot: number, riders: number[]) {
    const place = Object.fromEntries([...Array(16).keys()].filter((id) => id !== pilot && !riders.includes(id)).map((id) => [id, away(id)]));
    const m = helis({ map: { points: [{ id: 'A', name: 'A', ...A }, { id: 'B', name: 'B', ...B }] }, tune: { visionM: 0, squadSize: 4, lzM: [0, 0], boardWaitSeconds: 0 }, squads: 2, place }); // #124: down on the centre
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    m.squads[1]!.order = { point: 1, hold: false, delayed: null, since: 0 };
    const h = crew(m, vehicle(m, 'helicopter'), [[pilot, 0], ...riders]);
    for (let flown = false, i = 0; i < 40 * HZ && !(flown && !viewOf(m, h.id)!.airborne); i++) (step(m, []), (flown ||= !!viewOf(m, h.id)!.airborne));
    return viewOf(m, h.id)!;
  }

  it('to its passengers\' majority goal, the pilot\'s goal breaking a tie', () => {
    const near = (h: Vec2, p: Vec2) => dist(h, p) < T.captureRadius;
    expect(near(lands(1, [4, 5, 0]), B)).toBe(true); // two for B, one for A
    expect(near(lands(1, [4, 0]), A)).toBe(true); // one each: the pilot (Alpha) is for A
    expect(near(lands(5, [0, 4, 1]), A)).toBe(true);
  });

  it('a dead member never comes back into its Squad Leader\'s helicopter while it is in the air', () => {
    const m = helis({ map: { points: [{ id: 'A', name: 'A', ...A }] }, tune: { visionM: 0, squadSize: 3, boardWaitSeconds: 0 }, place: { 2: { x: 500, y: 0 }, 3: { x: 500, y: -500 }, 4: { x: 500, y: -500 }, 5: { x: 500, y: -500 } } });
    const h = crew(m, vehicle(m, 'helicopter'), [[1, 0], 0]); // Alpha's 1 flies its leader (0)
    Object.assign(m.soldiers[2]!, { state: 'dead', deadAt: 0 });
    const { views } = play(m, (T.respawnSeconds + 1) * HZ);
    expect(viewOf(m, h.id)!.airborne).toBe(true); // A is over 30 s away
    expect(m.soldiers[2]!.state).toBe('alive');
    expect(views.at(-1)!.friendlies.find((f) => f.id === 2)!.vehicle).toBeUndefined();
  });

  it('round the enemy HQ circle, never into it', () => {
    const behind = { x: 588, y: 24 }; // past the pact HQ (560, 0) from nato's
    const m = helis({ map: { points: [{ id: 'A', name: 'A', ...behind }] }, tune: { visionM: 0, squadSize: 4, lzM: [0, 0] }, place: { 4: { x: 0, y: 550 }, 5: { x: 0, y: 550 }, 6: { x: 0, y: 550 }, 7: { x: 0, y: 550 } } });
    const { views } = play(m, 60 * HZ);
    const closest = Math.min(...views.map((v) => Math.hypot(heliOf(v).x - 560, heliOf(v).y)));
    expect(closest).toBeGreaterThanOrEqual(T.hqRadius - 1e-6);
    expect(views.at(-1)!.friendlies.filter((f) => [1, 2, 3].includes(f.id)).some((f) => dist(f, behind) < 40)).toBe(true); // it got them there
  });
});

describe('#109 the helicopter\'s sight, and being seen', () => {
  // A wall north-south at x = -60; nato's helicopter (4) at the centre, `aboard` it. Pact's Soldiers 2 and 3.
  const wall = { walls: [{ x0: -64, y0: -80, x1: -56, y1: 80 }] };
  const sky = (place: Record<number, Vec2 & { fx?: number; fy?: number }>, o: { airborne: boolean; aboard?: (number | [number, number])[] }, tune: Partial<Tune> = {}) => {
    const m = helis({ map: wall, tune: { walkSpeed: 0, rockets: 0, ...tune }, place: { 0: { x: 500, y: 500 }, 1: { x: 500, y: 500 }, ...place } });
    Object.assign(crew(m, vehicle(m, 'helicopter'), o.aboard ?? [], { x: 0, y: 0 }), { airborne: o.airborne });
    return m;
  };

  it('a crewed one sees all round over walls out to airVisionM', () => {
    // Soldier 2 behind the wall and behind its facing, 200 m off; Soldier 3 past airVisionM
    const m = sky({ 2: { x: -200, y: 0 }, 3: { x: 0, y: T.airVisionM + 10 } }, { airborne: false, aboard: [[0, 0]] }, { visionM: 0 });
    const { views } = play(m, 1); // it faces east as it looks (it turns for home only after)
    expect(views[0]!.contacts.map((c) => c.id)).toEqual([2]);
  });

  it('a Soldier sees and shoots an airborne one over a wall, never a landed one', () => {
    const fires = (airborne: boolean) => {
      const m = sky({ 2: { x: -120, y: 0, fx: 1, fy: 0 }, 3: { x: -120, y: 4, fx: 1, fy: 0 } }, { airborne });
      return play(m, 5 * HZ, 'pact').events.filter((e) => e.kind === 'shot' && e.to === 4).length;
    };
    expect(fires(true)).toBeGreaterThan(0);
    expect(fires(false)).toBe(0);
  });

  it('a side gun fires over walls from its seat at a target on its side; a passenger seat and the far side\'s gun never do (#129)', () => {
    const gun = (aboard: (number | [number, number])[]) => {
      const m = sky({ 2: { x: -120, y: 0 }, 3: { x: -120, y: 4 } }, { airborne: false, aboard: [[0, 0], ...aboard] }, { hp: 1e9, visionM: 0 }); // behind the wall
      Object.assign(vehicle(m, 'helicopter'), { fx: 0, fy: 1, slot: { x: 0, y: 0 } }); // heading north, home is here: the west is its left
      return play(m, 3 * HZ).events.filter((e) => e.kind === 'shot' && e.side === 'nato').map((e) => (e as { from: number }).from);
    };
    expect(gun([1])).toEqual([]); // a passenger seat
    expect(gun([[1, 2]])).toEqual([]); // the right gun
    const shots = gun([[1, 1]]); // the left gun
    expect(shots.length).toBeGreaterThan(10);
    expect(new Set(shots)).toEqual(new Set([1]));
  });

  it('the enemy Console shows an airborne one only while a Soldier of theirs sees it, over a wall; lost, it leaves a fading Last Known Position', () => {
    // pact's 2 and 3 face east behind the wall; the empty helicopter hovers out of their sight, then over the wall in it, then out again
    const m = sky({ 2: { x: -120, y: 0, fx: 1, fy: 0 }, 3: { x: -120, y: 4, fx: 1, fy: 0 } }, { airborne: true }, { heliHp: 1e9 });
    const out = { x: -120 + T.visionM * T.vehicleVisionMul + 20, y: 0 };
    const heli = (v: CommanderView) => v.vehicles!.find((x) => x.id === 4);
    const h = vehicle(m, 'helicopter');
    Object.assign(h, out);
    expect(play(m, HZ, 'pact').views.some(heli)).toBe(false);
    Object.assign(h, { x: 0, y: 0 });
    const seen = play(m, HZ, 'pact').views;
    for (const v of seen) expect(heli(v)).toMatchObject({ side: 'nato', kind: 'helicopter', x: 0, y: 0, airborne: true });
    expect(heli(seen[0]!)!.seats).toBeUndefined(); // an enemy's: position and facing only
    Object.assign(h, out);
    const lost = play(m, 4 * HZ, 'pact').views;
    expect(lost.some(heli)).toBe(false);
    expect(lost[0]!.lastKnown).toEqual([{ x: 0, y: 0, fade: expect.closeTo(1, 1) }]);
    expect(lost.at(-1)!.lastKnown).toEqual([]); // gone lkpSeconds later
  });

  it('a Barrage shell hurts it only on the ground; a Cruise Missile destroys it in the air, and the enemy sees the Wreck only when they saw it die', () => {
    const shell = (airborne: boolean) => {
      const m = sky({}, { airborne }, { visionM: 0, barrageCooldownSeconds: 0, barrageShells: 1, barrageSpreadM: 0 });
      play(m, 20 * HZ, 'nato', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: 0, y: 0 } }] : []));
      return viewOf(m, 4)!.hp;
    };
    expect(shell(true)).toBe(1);
    expect(shell(false)).toBe((T.heliHp - T.shellVehicleDamage) / T.heliHp);

    const wreck = (watching: boolean) => {
      // pact's 2 and 3 behind the wall, facing it (east) or away; rifles never bring it down (heliHp), the missile does
      const fx = watching ? 1 : -1;
      const m = sky({ 2: { x: -120, y: 0, fx, fy: 0 }, 3: { x: -120, y: 4, fx, fy: 0 } }, { airborne: true }, { heliHp: 1e9, missileCooldownSeconds: 0, missileGated: false });
      const { views } = play(m, 30 * HZ, 'pact', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'missile', at: { x: 0, y: 0 } }] : []));
      expect(viewOf(m, 4)).toBeUndefined();
      return views.at(-1)!.vehicles!.find((x) => x.wreck);
    };
    expect(wreck(true)).toMatchObject({ side: 'nato', kind: 'helicopter', x: 0, y: 0 });
    expect(wreck(false)).toBeUndefined();
  });
});

describe('#124 helicopter flight and Landing Zone', () => {
  // As the #109 ferry: nato's Squad 0..3 boards helicopter 8 on its HQ (-560, 0) and goes to A; the pact's Soldiers stand far off.
  const HQ = { x: -560, y: 0 };
  const A = { x: 300, y: 200 };
  const away = { x: 500, y: -500 };
  const scene124 = (o: { tune?: Partial<Tune>; map?: Partial<MapData>; seed?: number } = {}) => {
    const m = helis({ map: { points: [{ id: 'A', name: 'A', ...A }], ...o.map }, tune: { visionM: 0, squadSize: 4, ...o.tune }, place: { 4: away, 5: away, 6: away, 7: away } });
    if (o.seed) m.rng = o.seed * 7919;
    return m;
  };
  /** The helicopter's flight every tick for `seconds` (its speed, which the view does not show, with it). */
  function flight(m: Match, seconds: number) {
    const h = vehicle(m, 'helicopter');
    const log: { x: number; y: number; fx: number; fy: number; speed: number; airborne: boolean; tick: number }[] = [];
    for (let i = 0; i < seconds * HZ; i++) {
      step(m, []);
      log.push({ x: h.x, y: h.y, fx: h.fx, fy: h.fy, speed: h.speed, airborne: h.airborne, tick: m.tick });
    }
    return { h, log };
  }
  const trips = (log: ReturnType<typeof flight>['log']) => {
    const up = log.findIndex((p) => p.airborne);
    const down = log.findIndex((p, i) => i > up && !p.airborne);
    const up2 = log.findIndex((p, i) => i > down && p.airborne);
    const down2 = log.findIndex((p, i) => i > up2 && !p.airborne);
    return { out: log.slice(up, down), back: log.slice(up2, down2), up, down, up2, down2 };
  };
  /** The signed distance from line a-b of the track's point farthest from it. */
  const bulge = (track: Vec2[], a: Vec2, b: Vec2) => {
    const len = dist(a, b);
    return track.map((q) => ((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / len).reduce((far, d) => (Math.abs(d) > Math.abs(far) ? d : far), 0);
  };
  const farthest = (track: Vec2[], a: Vec2, b: Vec2) => track.reduce((f, q) => (Math.abs(bulge([q], a, b)) > Math.abs(bulge([f], a, b)) ? q : f));

  it('each trip out and home is a dogleg, and the one home is not the one out', () => {
    const { h, log } = flight(scene124(), 90);
    const { out, back } = trips(log);
    const outLen = dist(h.heli.lz!, HQ);
    expect(Math.abs(bulge(out, HQ, h.heli.lz!))).toBeGreaterThan(0.05 * outLen); // it banks through a waypoint off the line (the turn cuts the corner)
    expect(Math.abs(bulge(back, h.heli.lz!, HQ))).toBeGreaterThan(0.05 * outLen);
    const [p, q] = [farthest(out, HQ, h.heli.lz!), farthest(back, h.heli.lz!, HQ)];
    expect(dist(p, q)).toBeGreaterThan(10);
  });

  it('a Landing Zone lies lzM from the point on standable ground, and each seed draws its own', () => {
    const zones = [1, 2, 3, 4, 5, 6].map((seed) => flight(scene124({ seed }), 45).h.heli.lz!);
    for (const z of zones) {
      const d = dist(z, A);
      expect(d).toBeGreaterThanOrEqual(T.lzM[0] - 0.01);
      expect(d).toBeLessThanOrEqual(T.lzM[1] + 0.01);
    }
    expect(new Set(zones.map((z) => `${Math.round(z.x)} ${Math.round(z.y)}`)).size).toBeGreaterThan(3);
  });

  it('the Landing Zone is on the far side from an enemy its Squad knows by the point, within lzSpreadDeg of straight away', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = scene124({ seed });
      m.squads[0]!.memory.push({ id: 4, x: A.x + 100, y: A.y, tick: 1e9, source: 'seen' }); // known east of A: it lands west (#129: the pilot goes first, so keep it fresh)
      const z = flight(m, 45).h.heli.lz!;
      const cos = (A.x - z.x) / dist(z, A); // against straight away (west)
      expect(cos, `seed ${seed}`).toBeGreaterThanOrEqual(Math.cos(((T.lzSpreadDeg + 2.5) * Math.PI) / 180) - 0.01); // bearings are 5° apart: the away one is snapped to the nearest
    }
  });

  it('the Landing Zone is on the far side from an enemy only another friendly Squad knows (#133)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = helis({
        map: { points: [{ id: 'A', name: 'A', ...A }] },
        tune: { visionM: 0, squadSize: 2 },
        squads: 3,
        place: { 4: { x: 0, y: -500 }, 5: { x: 0, y: -500 }, 6: away, 7: away, 8: away, 9: away, 10: away, 11: away },
      });
      m.rng = seed * 7919;
      m.squads[2]!.memory.push({ id: 6, x: A.x + 100, y: A.y, tick: 1e9, source: 'seen' }); // the Squad left behind knows an enemy east of A; the riders' own memory is empty
      const z = flight(m, 45).h.heli.lz!;
      const cos = (A.x - z.x) / dist(z, A);
      expect(cos, `seed ${seed}`).toBeGreaterThanOrEqual(Math.cos(((T.lzSpreadDeg + 2.5) * Math.PI) / 180) - 0.01);
    }
  });

  it('a dogleg keeps off an enemy-held point on one side and takes the clear side; with nothing in the way both sides turn up', () => {
    const mid = { x: (HQ.x + A.x) / 2, y: (HQ.y + A.y) / 2 };
    const L = dist(A, HQ);
    const n = { x: -(A.y - HQ.y) / L, y: (A.x - HQ.x) / L };
    const P = { x: mid.x + 200 * n.x, y: mid.y + 200 * n.y }; // an enemy-held point 200 m off the middle, on the + side
    const sides = (threat: boolean) =>
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const m = scene124({ seed, map: { points: [{ id: 'A', name: 'A', ...A }, ...(threat ? [{ id: 'B', name: 'B', ...P, owner: 'pact' as const }] : [])] }, tune: { lzM: [0, 0] } });
        m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
        const { out } = trips(flight(m, 45).log);
        const closest = Math.min(...out.map((q) => dist(q, P)));
        if (threat) expect(closest, `seed ${seed}`).toBeGreaterThanOrEqual(m.points[1]!.radius + T.heliThreatM);
        return Math.sign(bulge(out, HQ, A));
      });
    expect(new Set(sides(true))).toEqual(new Set([1])); // the clear side
    expect(new Set(sides(false))).toEqual(new Set([-1, 1]));
  });

  it('a dogleg waypoint never lies outside the Play Area, even for a trip along its edge', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = scene124({ seed });
      const w = dogleg(m, { x: -400, y: 590 }, { x: 400, y: 590 }, [])!; // 800 m along the north edge (y = 600): one side would be 120-240 m out
      expect(insidePolygon(m.map.playArea, w.x, w.y), `seed ${seed}: ${w.x.toFixed(0)}, ${w.y.toFixed(0)}`).toBe(true);
    }
  });

  it('a trip shorter than doglegMinM flies straight', () => {
    const m = scene124({ map: { points: [{ id: 'A', name: 'A', x: -460, y: 0 }] }, tune: { lzM: [30, 30] } });
    crew(m, vehicle(m, 'helicopter'), [[1, 0], 0, 2, 3]); // Alpha's 1 flies the rest of its Squad
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    const { h, log } = flight(m, 20);
    const { out } = trips(log);
    expect(out.length).toBeGreaterThan(0);
    expect(Math.abs(bulge(out, HQ, h.heli.lz!))).toBeLessThan(0.5);
  });

  it('a goal changed in flight draws a fresh Landing Zone: it sets down by the new point and its riders get out there, once', () => {
    const B = { x: 300, y: -250 };
    const m = scene124({ map: { points: [{ id: 'A', name: 'A', ...A }, { id: 'B', name: 'B', ...B }] }, tune: { rockets: 0 } }); // the pact's Launcher (Soldier 5, parked far off) would rocket the airborne helicopter without line of sight (`rocketTarget`: airborne vehicles need none, `rocketRangeM` applies regardless of `visionM: 0`); #131: below half its hit points it would drop its riders and fly home to repair, and this test is about the Landing Zone
    const h = crew(m, vehicle(m, 'helicopter'), [[1, 0], 0, 2, 3]); // Alpha's 1 flies the rest of its Squad
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    flight(m, 15);
    expect(viewOf(m, h.id)!.airborne).toBe(true);
    m.squads[0]!.order = { point: 1, hold: false, delayed: null, since: m.tick }; // on its way to A, the Squad turns for B
    const riders = () => viewOf(m, h.id)!.seats!.filter((id, k) => k > 0 && id >= 0).length;
    let boardings = 0;
    let down: Vec2 | null = null;
    for (let i = 0; i < 60 * HZ; i++) {
      const aboard = riders();
      step(m, []);
      if (riders() > aboard) boardings++;
      const v = viewOf(m, h.id)!;
      if (!down && !v.airborne) down = { x: v.x, y: v.y };
    }
    expect(dist(down!, B)).toBeLessThanOrEqual(T.lzM[1] + 0.01);
    expect(commanderView(m, 'nato').friendlies.filter((f) => [0, 2, 3].includes(f.id)).every((f) => f.vehicle === undefined)).toBe(true);
    expect(boardings).toBe(0); // no climbing back in at the old Landing Zone
  });

  it('speeds up or slows by no more than heliAccel, turns by no more than heliTurnDegPerS, and banks through the waypoint without stopping', () => {
    const { log } = flight(scene124(), 90);
    const { out, back } = trips(log);
    const turn = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => Math.acos(Math.min(1, a.fx * b.fx + a.fy * b.fy)) * (180 / Math.PI);
    log.slice(1).forEach((q, i) => {
      const p = log[i]!;
      expect(q.speed - p.speed, `tick ${q.tick}`).toBeLessThanOrEqual(T.heliAccel / HZ + 1e-9);
      expect(p.speed - q.speed, `tick ${q.tick}`).toBeLessThanOrEqual(T.heliAccel / HZ + 1e-9);
      expect(turn(p, q), `tick ${q.tick}`).toBeLessThanOrEqual(T.heliTurnDegPerS / HZ + 1e-3);
    });
    expect(Math.max(...out.map((q) => q.speed))).toBeCloseTo(T.heliMps, 1);
    for (const trip of [out, back]) expect(Math.min(...trip.slice(Math.floor(trip.length * 0.35), Math.floor(trip.length * 0.65)).map((q) => q.speed))).toBeGreaterThan(0.8 * T.heliMps); // round the waypoint at the middle
    expect(Math.max(...out.slice(0, 3).map((q) => q.speed))).toBeLessThan(1); // a pull-away from rest
  });

  it('hovers flareSeconds over its Landing Zone before touching down, and spools spoolSeconds before lift-off', () => {
    const { h, log } = flight(scene124(), 90);
    const { down, up2 } = trips(log);
    let hover = down;
    while (log[hover - 1]!.speed === 0 && log[hover - 1]!.airborne) hover--;
    expect(dist(log[down]!, h.heli.lz!)).toBeLessThan(1e-6);
    expect((down - hover) / HZ).toBeCloseTo(T.flareSeconds, 0);
    expect(log[down - 1]!.airborne).toBe(true); // still airborne while it hovers
    expect(log.slice(down, up2).every((q) => q.speed === 0)).toBe(true);
    expect((up2 - down) / HZ).toBeCloseTo(T.unloadSeconds + T.spoolSeconds, 0);
  });

  it('the Landing Zone, waypoint, flare and spool timers are in the hash', () => {
    const m = scene124();
    const h = vehicle(m, 'helicopter');
    for (const change of [() => (h.heli.lz = { x: 1, y: 2 }), () => (h.heli.wp = { x: 3, y: 4 }), () => (h.heli.flareUntil = 9), () => (h.heli.spoolUntil = 9)]) {
      const before = stateHash(m);
      change();
      expect(stateHash(m)).not.toBe(before);
    }
  });
});

// #129: helicopter crew: Soldiers from different Squads fly it and man its side guns for a stint, staying in their Squads.
describe('#129 crew', () => {
  const FAR = { x: 560, y: 500 };
  /** Three nato Squads (Soldiers 0..11) up the field from their helicopter (vehicle 24, on the HQ), heading for A; pact (12..23) parked out of sight. */
  function crews(tune: Partial<Tune> = {}, seed = 3): Match {
    const m = helis({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0 }] }, tune: { squadSize: 4, visionM: 0, rideM: [1e6, 1e6], ...tune }, squads: 3, seed });
    m.soldiers.forEach((s, i) => Object.assign(s, s.side === 'nato' ? { x: -540, y: 4 * (i % 4) - 6 + 10 * Math.floor(i / 4) } : { ...FAR, speed: 0 }));
    return m;
  }
  /** Nato's helicopter's seats, as its Commander sees them. */
  const seatsOf = (m: Match) => viewOf(m, vehicle(m, 'helicopter').id)!.seats!;

  it('pilot and both guns fill from different Squads, never a Squad Leader, each Detached but still a member', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = crews({}, seed);
      for (let t = 0; t < 40 * HZ; t++) step(m, []);
      const aboard = seatsOf(m).slice(0, 3).map((id) => m.soldiers[id]!);
      expect(aboard.every((s) => s), `seed ${seed}`).toBe(true);
      expect(new Set(aboard.map((s) => s.squad)).size, `seed ${seed}`).toBe(3);
      for (const s of aboard) {
        expect(m.squads[s.squad]!.members[0]).not.toBe(s.id);
        expect(m.squads[s.squad]!.members).toContain(s.id);
        expect(s.detached).toBe(true);
      }
    }
  });

  it('a crew member stays for the stint, gets out only on the pad, and rejoins the Squad', () => {
    const m = crews({ crewSeconds: [20, 20] });
    let out = -1;
    let pilot = -1;
    for (let t = 0; t < 120 * HZ && out < 0; t++) {
      step(m, []);
      if (pilot < 0 && seatsOf(m)[0]! >= 0) pilot = seatsOf(m)[0]!;
      if (pilot >= 0 && seatsOf(m)[0] !== pilot) out = m.tick;
    }
    const s = m.soldiers[pilot]!;
    expect(out).toBeGreaterThan(20 * HZ);
    expect(viewOf(m, vehicle(m, 'helicopter').id)!.airborne).toBeUndefined();
    expect(s.vehicle).toBe(-1);
    expect(m.squads[s.squad]!.members).toContain(pilot);
    expect(s.detached).toBe(true);
    for (let t = 0; t < 120 * HZ && s.detached; t++) step(m, []);
    expect(s.detached).toBe(false);
  });

  it('each recruit takes the seat they were sent for: a gun recruit arriving first leaves the pilot seat for the pilot recruit', () => {
    const m = crews({ mountSeconds: [1, 1] });
    const heli = vehicle(m, 'helicopter');
    const sent: number[] = [];
    for (let t = 0; t < 60 * HZ && sent.length < 2; t++) {
      step(m, []);
      for (const s of m.soldiers) if (s.crew && s.boarding === heli.id && !sent.includes(s.id)) sent.push(s.id);
    }
    expect(sent).toHaveLength(2);
    Object.assign(m.soldiers[sent[1]!]!, { x: heli.x, y: heli.y }); // the second sent (a gun) is at the door; the pilot is still walking
    for (let t = 0; t < 4 * HZ && !seatsOf(m).includes(sent[1]!); t++) step(m, []);
    expect(seatsOf(m).includes(sent[1]!)).toBe(true);
    expect(seatsOf(m)[0]).toBe(-1);
    for (let t = 0; t < 30 * HZ && seatsOf(m)[0] !== sent[0]; t++) step(m, []);
    expect(seatsOf(m)[0]).toBe(sent[0]);
  });

  it('a pilot whose stint is over stays while a claimed Squad is boarding or a passenger is aboard, and leaves once the helicopter is on its pad with neither', () => {
    for (const hold of ['claim', 'passenger', 'none'] as const) {
      const m = crews();
      m.squads.forEach((sq) => (sq.rideM = 1e9));
      const heli = crew(m, vehicle(m, 'helicopter'), [[4, 0], ...(hold === 'passenger' ? [8] : [])]); // Squad 1's 4 pilots it, Squad 2's 8 rides
      m.soldiers[4]!.crewUntil = 0; // its stint is over
      Object.assign(heli, { departAt: 1e9, ...(hold === 'claim' && { claim: 2, claimUntil: 1e9 }) });
      if (hold === 'claim') Object.assign(m.soldiers[8]!, { boarding: heli.id, x: heli.x + 30, y: heli.y }); // Squad 2 is walking to it
      for (let t = 0; t < 20 * HZ; t++) step(m, []);
      expect(seatsOf(m)[0] === 4, hold).toBe(hold !== 'none');
    }
  });

  it('with no pilot the helicopter does not fly', () => {
    // Alpha's 1, 2 and 3 sit in its passenger seats; everyone else stands beyond boardM, so nobody comes to fly it
    const m = crews({ rideM: [100, 100] });
    m.soldiers.filter((s) => s.side === 'nato' && ![1, 2, 3].includes(s.id)).forEach((s) => Object.assign(s, { x: -400, y: 300 }));
    const heli = crew(m, vehicle(m, 'helicopter'), [1, 2, 3]);
    const pos = { x: heli.x, y: heli.y };
    const { views } = play(m, 5 * HZ);
    for (const v of views) expect(heliOf(v)).toMatchObject({ ...pos, seats: [-1, -1, -1, 1, 2, 3] });
    expect(views.every((v) => !heliOf(v).airborne)).toBe(true);
  });

  /** Soldiers 0 (pilot), 1 (left gun), 2 (right gun) crew the seats `seats` say, heading east; pact's Soldier 12 stands at `at`. Who fired. */
  function fired(seats: number[], at: Vec2) {
    const m = crews({ crewSeconds: [1e5, 1e5], hitChance: 1 });
    m.squads.forEach((sq) => (sq.rideM = 1e9)); // #131: no Squad calls the helicopter to fetch it: it stays where this test put it
    m.soldiers.slice(0, 12).forEach((s) => Object.assign(s, { x: -500, y: -500 })); // the rest are far off
    const heli = crew(m, vehicle(m, 'helicopter'), seats.flatMap((id, k) => (id >= 0 ? [[id, k] as [number, number]] : [])), { x: 0, y: 0 });
    Object.assign(heli, { fx: 1, fy: 0, slot: { x: 0, y: 0 } });
    Object.assign(m.soldiers[12]!, { ...at, hp: 1e9 });
    const from = new Set<number>();
    for (let t = 0; t < 3 * HZ; t++) for (const e of step(m, [])) if (e.kind === 'shot' && e.side === 'nato') from.add(e.from);
    return from;
  }
  const six = [0, 1, 2, -1, -1, -1];

  it('each side gun covers 120 degrees straight out from its side: nothing ahead or behind is in either arc', () => {
    expect(fired(six, { x: 0, y: 80 })).toEqual(new Set([1])); // heading east: left is +y
    expect(fired(six, { x: 0, y: -80 })).toEqual(new Set([2]));
    expect(fired(six, { x: 80, y: 0 })).toEqual(new Set());
    expect(fired(six, { x: -80, y: 0 })).toEqual(new Set());
    expect(fired(six, { x: 60, y: 80 })).toEqual(new Set([1])); // 37 degrees ahead of the beam: inside
    expect(fired(six, { x: 80, y: 30 })).toEqual(new Set()); // 69 degrees ahead of the beam: outside
  });

  it('an unmanned side gun never fires', () => {
    expect(fired([0, -1, 2, -1, -1, -1], { x: 0, y: 80 })).toEqual(new Set());
    expect(fired([0, 1, -1, -1, -1, -1], { x: 0, y: -80 })).toEqual(new Set());
  });

  it('a Squad of four with only a pilot aboard rides in the three passenger seats and one gun seat', () => {
    const m = crews({ rideM: [100, 100] });
    m.points[0]!.x = -50; // 490 m off: past heliFitM
    crew(m, vehicle(m, 'helicopter'), [[4, 0]]); // Squad 1's Soldier 4 is the pilot
    m.soldiers.slice(5, 12).forEach((s) => Object.assign(s, { x: -400, y: 300 })); // the other Squads stay out of it
    let most = 0;
    for (let t = 0; t < 20 * HZ; t++) {
      step(m, []);
      most = Math.max(most, seatsOf(m).filter((id) => id >= 0 && id < 4).length);
    }
    expect(most).toBe(4);
  });

  /** Soldier `id` dies and comes back: the helicopter's crew seats after. */
  function back(id: number, tune: Partial<Tune>) {
    const m = crews(tune);
    const s = m.soldiers[id]!;
    boardOnReturn(m, m.squads[s.squad]!, s);
    return { m, s, seats: seatsOf(m).slice(0, 3) };
  }
  it('coming back, takes the pilot seat of a helicopter on its pad, its stint starting as it spawns in', () => {
    const { m, s, seats } = back(1, { crewSpawnChance: 1 });
    expect(seats[0]).toBe(1);
    expect(s).toMatchObject({ crew: true, vehicle: vehicle(m, 'helicopter').id });
    expect(s.crewUntil).toBeGreaterThan(m.tick);
  });
  it('coming back, never when the chance is 0, nor the Squad Leader', () => {
    expect(back(1, { crewSpawnChance: 0 }).seats).toEqual([-1, -1, -1]);
    expect(back(0, { crewSpawnChance: 1 }).seats).toEqual([-1, -1, -1]);
  });
  it('coming back, at most one crew per Squad; another Squad takes the next seat', () => {
    const { m, seats } = back(1, { crewSpawnChance: 1 });
    boardOnReturn(m, m.squads[0]!, m.soldiers[2]!);
    expect(m.soldiers[2]!.crew).toBe(false);
    boardOnReturn(m, m.squads[1]!, m.soldiers[5]!);
    expect(seatsOf(m).slice(0, 3)).toEqual([seats[0], 5, -1]);
  });
});

// #131: what a piloted helicopter does: bail, repair, ferry (pickup, hot drop), support, wait.
describe('#131 jobs', () => {
  const P: Vec2 = { x: 500, y: 0 };
  const FAR = { x: 600, y: -600 };
  /**
   * Two nato Squads (Soldiers 0..3, 4..7), two pact (8..15, parked far off and blind), nato's helicopter (vehicle 16) on its pad at
   * the HQ, its crew's stints longer than any test. Neither nato Squad rides (their ride distance is out of reach) unless a test says so.
   */
  function jobs(points: Vec2[], tune: Partial<Tune> = {}, seed = 1): Match {
    const map = { playArea: square(700), hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 600 } }, points: points.map((p, i) => ({ id: 'ABC'[i]!, name: 'ABC'[i]!, ...p })) };
    const m = helis({ map, tune: { squadSize: 4, visionM: 0, crewSeconds: [1e5, 1e5], ...tune }, squads: 2, seed });
    m.soldiers.forEach((s) => Object.assign(s, s.side === 'nato' ? { x: -300 + 3 * s.id, y: 300 } : { ...FAR, speed: 0 }));
    for (const sq of m.squads) sq.rideM = 1e6;
    return m;
  }
  /** `seats` aboard `h` (pilot, left gun, right gun, three passengers; -1 empty), the first three crew; at `at` if given (then airborne, heading east). */
  function load(m: Match, h: Heli, seats: number[], o: { at?: Vec2; hp?: number } = {}) {
    crew(m, h, seats.flatMap((id, k): (number | [number, number])[] => (id < 0 ? [] : k < 3 ? [[id, k]] : [id])), o.at);
    if (o.hp !== undefined) h.hp = o.hp; // a map script's damage
    if (o.at) Object.assign(h, { airborne: true, parked: false, speed: 20, fx: 1, fy: 0 });
    return h;
  }
  const heli = (m: Match) => vehicle(m, 'helicopter');
  /** What nato's Commander sees of `h`. */
  const seen = (m: Match, h: Heli) => viewOf(m, h.id);
  /** Squad `sq` has seen an enemy at each of `at` just now. */
  const know = (m: Match, sq: number, ...at: Vec2[]) => m.squads[sq]!.memory.splice(0, 9, ...at.map((p, i) => ({ id: 100 + i, ...p, tick: m.tick, source: 'seen' as const })));
  const run = (m: Match, seconds: number, each: (events: SimEvent[]) => void = () => {}) => {
    for (let i = 0; i < seconds * HZ; i++) each(step(m, []));
  };

  it('bail: under a third of its hit points everyone aboard, crew too, jumps; it glides crashSeconds, then is a Wreck; nobody is hurt', () => {
    const m = jobs([P]);
    const h = load(m, heli(m), [1, 5, -1, 2, 6, -1], { at: { x: 0, y: 0 }, hp: T.heliHp / 4 });
    const tickets = { ...m.tickets };
    let jumped = -1;
    let crashed = -1;
    run(m, 10, () => {
      if (jumped < 0 && m.soldiers[1]!.chute) jumped = m.tick;
      if (crashed < 0 && !seen(m, h)) crashed = m.tick;
      if (crashed < 0 && jumped >= 0) expect(seen(m, h)!.airborne).toBe(true); // it glides on
    });
    expect(jumped).toBeGreaterThan(0);
    for (const id of [1, 5, 2, 6]) expect(m.soldiers[id]).toMatchObject({ vehicle: -1, crew: false });
    expect((crashed - jumped) / HZ).toBeCloseTo(T.crashSeconds, 0);
    expect(commanderView(m, 'nato').vehicles!.filter((v) => v.wreck)).toEqual([expect.objectContaining({ kind: 'helicopter' })]);
    expect(m.soldiers.filter((s) => s.state === 'alive')).toHaveLength(m.soldiers.length);
    expect(m.tickets).toEqual(tickets);
    run(m, T.vehicleRespawnSeconds); // a fresh one appears on the pad
    expect(seen(m, h)).toMatchObject({ hp: 1, seats: [-1, -1, -1, -1, -1, -1] });
  });

  it('repair: under half its hit points the passengers jump where they are, it flies home, and on the pad regains heliRepairHpPerS until full, then works again', () => {
    const m = jobs([P]);
    const h = load(m, heli(m), [1, -1, -1, 2, 6, -1], { at: { x: 0, y: 0 }, hp: T.heliHp * 0.45 });
    run(m, 3);
    for (const id of [2, 6]) expect(m.soldiers[id]).toMatchObject({ vehicle: -1 });
    expect(seen(m, h)).toMatchObject({ seats: [1, -1, -1, -1, -1, -1], airborne: true });
    let landed = -1;
    for (let i = 0; i < 90 * HZ && landed < 0; i++) {
      step(m, []);
      if (!seen(m, h)!.airborne) landed = m.tick;
    }
    expect(landed).toBeGreaterThan(0);
    expect(dist(seen(m, h)!, h.slot)).toBeLessThan(1);
    const hp = () => seen(m, h)!.hp! * T.heliHp;
    const hp0 = hp();
    run(m, 5);
    expect(hp() - hp0).toBeCloseTo(5 * T.heliRepairHpPerS, 0);
    run(m, 30);
    expect(seen(m, h)!.hp).toBe(1);
    expect(h.heli.job).not.toBe('repair');
  });

  describe('ferry', () => {
    /** Squad 1 stands far up the field with a long ride and nothing by it; the helicopter has its pilot (Soldier 1) aboard and `gunners` (Soldiers 2, 3) in its guns; a pact Soldier near the goal when `hot`. A Squad of four fills a gun seat too, so is a gunner of its own. */
    function call(o: { gunners?: number[]; hot?: boolean; squadSize?: number } = {}) {
      const m = jobs([P], { squadSize: o.squadSize ?? 4 });
      m.squads[1]!.rideM = 100;
      const h = load(m, heli(m), [1, ...[0, 1].map((k) => o.gunners?.[k] ?? -1), -1, -1, -1]);
      m.soldiers.filter((s) => s.squad === 1).forEach((s, k) => Object.assign(s, { x: -100 + 3 * k, y: 0 }));
      if (o.hot) Object.assign(m.soldiers.find((s) => s.side === 'pact')!, { x: P.x + 20, y: 30, hp: 1e9 });
      return { m, h };
    }
    /** Plays it out, noting when Squad 1 first climbs in, where the helicopter first sets down after that, when its riders first jump, and who fired from it. */
    function trip(m: Match, h: Heli, hot: boolean) {
      const log = { fetch: -1, pickup: null as Vec2 | null, boarded: -1, down: null as Vec2 | null, jumped: -1, over: Infinity, orbit: [] as number[], circled: false, fired: new Set<number>() };
      const riders = m.soldiers.filter((s) => s.squad === 1);
      for (let i = 0; i < 240 * HZ; i++) {
        if (hot) know(m, 1, { x: P.x + 20, y: 30 });
        for (const e of step(m, [])) if (e.kind === 'shot' && e.side === 'nato' && m.soldiers[e.from]!.vehicle === h.id) log.fired.add(e.from);
        if (h.heli.fetch === 1) log.fetch = m.tick;
        if (log.boarded < 0 && riders.some((s) => s.vehicle === h.id)) log.boarded = m.tick;
        if (log.boarded >= 0 && !log.down && !h.airborne && h.heli.landedAt >= log.boarded && dist(h, h.slot) > 50) log.down = { x: h.x, y: h.y };
        if (log.boarded < 0 && !log.pickup && !h.airborne && h.heli.landedAt > 0 && dist(h, h.slot) > 50) log.pickup = { x: h.x, y: h.y };
        if (log.jumped < 0 && riders.some((s) => s.chute)) [log.jumped, log.over] = [m.tick, h.airborne && h.heli.lz ? dist(h, h.heli.lz) : Infinity];
        if (h.heli.hotDrop && h.heli.until >= 0) log.circled = true; // its orbit has begun
        if (log.boarded >= 0 && log.jumped < 0 && h.airborne) log.orbit.push(dist(h, P) - T.orbitM);
      }
      return log;
    }

    it('a Squad far from the HQ with a long ride and no vehicle by it is fetched: the helicopter lands by it, it boards and is taken to a quiet goal, where it lands', () => {
      const { m, h } = call();
      const log = trip(m, h, false);
      expect(log.fetch).toBeGreaterThan(0);
      expect(log.pickup).not.toBeNull();
      expect(log.boarded).toBeGreaterThan(log.fetch);
      expect(log.down).not.toBeNull();
      expect(dist(log.down!, P)).toBeLessThan(T.lzM[1] + 5);
      expect(log.jumped).toBe(-1);
      for (const f of commanderView(m, 'nato').friendlies.filter((f) => m.soldiers[f.id]!.squad === 1)) expect(dist(f, P)).toBeLessThan(T.lzM[1] + 60);
    });

    it('#136: a Mark by the goal does not make it hot: nobody is known to be there, so the helicopter lands its riders', () => {
      const { m, h } = call();
      m.tune.markSeconds = 1e4; // it outlives the trip
      step(m, [{ tick: m.tick, side: 'nato', kind: 'mark', at: { x: P.x + 20, y: 30 } }]);
      const log = trip(m, h, false);
      expect(log.boarded).toBeGreaterThan(0);
      expect(log.jumped).toBe(-1);
      expect(log.down).not.toBeNull();
    });

    it('a hot goal: it circles the point at orbitM for orbitSeconds, its gunner firing, then the riders jump over the Landing Zone', () => {
      const { m, h } = call({ hot: true, gunners: [2] });
      const log = trip(m, h, true);
      expect(log.jumped).toBeGreaterThan(log.boarded);
      expect(log.over).toBeLessThan(2);
      expect(log.down).toBeNull();
      expect(log.circled).toBe(true);
      const ring = log.orbit.filter((e) => Math.abs(e) < 30).length;
      expect(ring / HZ).toBeGreaterThan(T.orbitSeconds * 0.8);
      expect(ring / HZ).toBeLessThan(T.orbitSeconds * 1.8);
      expect(log.fired.has(2)).toBe(true);
    });

    it('a hot goal with no gunner aboard (a Squad of three fills the passenger seats only): no circling, circling is pointless, but the goal is still hot: the riders jump over the Landing Zone', () => {
      const { m, h } = call({ hot: true, squadSize: 3 });
      const log = trip(m, h, true);
      expect(log.circled).toBe(false);
      expect(log.jumped).toBeGreaterThan(log.boarded);
      expect(log.over).toBeLessThan(2);
      expect(log.down).toBeNull();
    });

    it('a landed helicopter whose Squad never claims it (no seats fit it) waits boardWaitSeconds at the pickup, then drops the fetch and flies on', () => {
      const m = jobs([P], { squadSize: 6 });
      m.squads[1]!.rideM = 100;
      const h = load(m, heli(m), [1, 2, 3, -1, -1, -1]); // three crew leave three seats: a Squad of six never fits
      const squad = m.soldiers.filter((s) => s.squad === 1);
      const spots = squad.map((_, k) => ({ x: -100 + 3 * k, y: 0 }));
      let down = -1;
      let off = -1;
      for (let i = 0; i < 200 * HZ && off < 0; i++) {
        squad.forEach((s, k) => Object.assign(s, spots[k]!)); // it stands there, calling
        step(m, []);
        if (down < 0 && !h.airborne && h.heli.landedAt > 0 && dist(h, h.slot) > 50) down = m.tick;
        if (down >= 0 && h.airborne) off = m.tick;
      }
      expect(down).toBeGreaterThan(0);
      expect(off).toBeGreaterThan(0);
      expect((off - down) / HZ).toBeGreaterThanOrEqual(T.boardWaitSeconds);
      expect((off - down) / HZ).toBeLessThan(T.boardWaitSeconds + T.spoolSeconds + 12);
    });

    it('#154: two calling Squads are fetched by different helicopters, even when both would rather fetch the nearer one', () => {
      // Pilots: Soldier 1 (Squad 0) in helicopter 16, Soldier 5 (Squad 1) in 17. Squad 0 calls from just past boardM of the HQ,
      // Squad 1 from far up the field; both stand there all along
      const m = jobs([P], { helisPerSide: 2 });
      const [a, b] = [load(m, vehicle(m, 'helicopter', 'nato', 0), [1, -1, -1, -1, -1, -1]), load(m, vehicle(m, 'helicopter', 'nato', 1), [5, -1, -1, -1, -1, -1])];
      for (const sq of m.squads.slice(0, 2)) sq.rideM = 100;
      const callers = m.soldiers.filter((s) => s.side === 'nato' && s.id !== 1 && s.id !== 5);
      const spots = callers.map((s, k) => (s.squad === 0 ? { x: -480 + 3 * k, y: 60 } : { x: 200 + 3 * k, y: 600 }));
      const fetched = [-1, -1];
      for (let i = 0; i < 10 * HZ; i++) {
        callers.forEach((s, k) => Object.assign(s, spots[k]!));
        step(m, []);
        [a, b].forEach((h, k) => fetched[k]! < 0 && (fetched[k] = h.heli.fetch));
      }
      expect(fetched.sort()).toEqual([0, 1]);
    });
  });

  describe('support', () => {
    const A: Vec2 = { x: -200, y: 0 };
    const B: Vec2 = { x: 300, y: 0 };
    /** Samples of the helicopter (its speed, which the view does not show, with it) once it has had 80 s, to 110 s. */
    function circle(seats: number[], c: Vec2[], o: { seed?: number; own?: boolean } = {}) {
      const m = jobs(c, {}, o.seed ?? 1);
      if (o.own) m.points[0]!.owner = 'nato';
      const h = load(m, heli(m), seats);
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

    it('it circles a point that only a Squad not aboard knows enemies at', () => {
      const m = jobs([B]);
      const h = load(m, heli(m), [1, 2, -1, -1, -1, -1]); // both of Squad 0
      let near = 0;
      for (let i = 0; i < 110 * HZ; i++) {
        know(m, 1, { x: B.x, y: B.y + 20 }); // only Squad 1, on foot, knows
        step(m, []);
        if (i > 80 * HZ && Math.abs(dist(seen(m, h)!, B) - T.orbitM) < 30) near++;
      }
      expect(near).toBeGreaterThan(25 * HZ);
    });

    it('with no gunner it never circles, and with no pilot it never flies', () => {
      const a = circle([1, -1, -1, -1, -1, -1], [B]);
      expect(seen(a.m, a.h)!.airborne).toBeUndefined();
      expect(dist(seen(a.m, a.h)!, a.h.slot)).toBeLessThan(1);
      const m = jobs([B]); // everyone stands far from the pad: nobody comes to fly it
      const h = load(m, heli(m), [-1, 5, 6, -1, -1, -1]);
      const views: CommanderView[] = [];
      for (let i = 0; i < 60 * HZ; i++) {
        know(m, 0, { x: B.x, y: B.y + 20 });
        know(m, 1, { x: B.x, y: B.y + 20 });
        step(m, []);
        views.push(commanderView(m, 'nato'));
      }
      expect(views.every((v) => heliOf(v).seats![0] === -1 && !heliOf(v).airborne)).toBe(true);
      expect(seen(m, h)).toMatchObject({ x: h.slot.x, y: h.slot.y });
    });
  });
});
