// #108 the jeep, at its module's interface: a Squad rides it to its Capture Point (`rides`, the shared passenger rule), its
// gunner's MG (`seatFire`), and it dies to rifles and to a tank's round.
import { describe, expect, it } from 'vitest';
import { commanderView, step } from '../index';
import { ticketsStart } from '../capture';
import { DEFAULT_TUNE } from '../tune';
import { crew, play, scene, vehicle, viewOf, type Logged } from '../test-scene';
import type { CommanderView, Tune } from '../types';

const HZ = DEFAULT_TUNE.hz;

/** An HQ of no size: these vehicles fight from the slot they wait in, and nobody fires out of its own HQ. */
const NO_HQ: Partial<Tune> = { hqRadius: 0 };

describe('#108 the jeep: a Squad rides to its Capture Point and gets out', () => {
  // Each Side's jeep waits on its HQ; with four to a Squad the nato Soldiers are 0..3, its jeep 8, the pact's 9
  const ride = (extra: Partial<Tune> = {}) => scene({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0 }] }, tune: { visionM: 0, squadSize: 4, jeepsPerSide: 1, ...extra } });
  const jeepOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && x.kind === 'jeep' && !x.wreck)!;

  it('the Squad fills it at match start, it reaches the point in under a minute, everyone gets out within dismountM of it after a stop, and it stays parked empty', () => {
    const m = ride();
    const { views } = play(m, 80 * HZ);
    const filled = views.findIndex((v) => jeepOf(v).seats!.every((id) => id >= 0)); // #122: they walk to it and climb in one by one
    expect(filled).toBeGreaterThan(0);
    expect(filled / HZ).toBeLessThan(4);
    expect(jeepOf(views[filled]!)).toMatchObject({ id: 8, kind: 'jeep', hp: 1 });
    const exits = [0, 1, 2, 3].map((id) => views.findIndex((v, i) => i > filled + 2 * HZ && v.friendlies.find((f) => f.id === id)!.vehicle === undefined));
    for (const [n, e] of exits.entries()) {
      expect(e / HZ).toBeLessThan(60);
      const me = views[e]!.friendlies.find((f) => f.id === n)!;
      expect(Math.hypot(me.x + 200, me.y)).toBeLessThanOrEqual(DEFAULT_TUNE.dismountM + 1);
      const at = (i: number) => jeepOf(views[i]!);
      expect(at(e - DEFAULT_TUNE.dismountStopSeconds * HZ)).toMatchObject({ x: at(e).x, y: at(e).y }); // it stood for the dismount
    }
    const last = jeepOf(views.at(-1)!);
    expect(last.seats).toEqual([-1, -1, -1, -1]);
    expect(jeepOf(views.at(-5 * HZ)!)).toMatchObject({ x: last.x, y: last.y });
  });

  it('a passenger whose own point is another gets out when the jeep drives away from it, walks there Detached and rejoins', () => {
    // Bravo's leader (Soldier 2) holds B; its Soldier 3 rides Alpha's jeep (Soldiers 0 and 1) from the HQ, bound for A past B
    const m = scene({
      map: { points: [{ id: 'A', name: 'A', x: 0, y: 0 }, { id: 'B', name: 'B', x: -200, y: 150 }] },
      tune: { visionM: 0, jeepsPerSide: 1, sameWayM: 300, rockets: 0, captureSeconds: 1e4 }, // nobody fights, B stays worth going to
      squads: 2,
      place: { 2: { x: -200, y: 150 } },
    });
    const order = (point: number) => ({ point, hold: false, delayed: null, since: 0 });
    m.squads[0]!.order = order(0);
    m.squads[1]!.order = order(1);
    const jeep = crew(m, vehicle(m, 'jeep'), [0, 1, 3]); // a map script's ride: Bravo's Soldier 3 aboard Alpha's jeep (Squads no longer board together)
    let rode = false;
    let exit: { x: number; y: number } | null = null;
    let detached = false;
    for (let i = 0; i < 100 * HZ; i++) {
      step(m, []);
      const v = commanderView(m, 'nato');
      const me = v.friendlies.find((f) => f.id === 3)!;
      rode ||= me.vehicle === jeep.id;
      if (rode && !exit && me.vehicle === undefined) exit = v.vehicles!.find((x) => x.id === jeep.id)!;
      detached ||= !!exit && m.soldiers[3]!.detached; // the view does not show it
    }
    expect(rode).toBe(true);
    expect(exit).not.toBeNull();
    expect(Math.hypot(exit!.x + 200, exit!.y - 150)).toBeGreaterThan(150 + 30); // well past B and still going
    expect(Math.hypot(exit!.x, exit!.y)).toBeGreaterThan(m.points[0]!.radius); // short of A
    expect(viewOf(m, jeep.id)!.seats![0]).toBe(-1); // Alpha drove on to A and got out
    expect(detached).toBe(true);
    expect(m.soldiers[3]!.detached).toBe(false);
    const me = commanderView(m, 'nato').friendlies.find((f) => f.id === 3)!;
    expect(Math.hypot(me.x + 200, me.y - 150)).toBeLessThan(m.points[1]!.radius);
  });
});

describe('#108 the jeep fights and dies', () => {
  const shotsBy = (events: Logged[], from: number) => events.filter((e) => e.kind === 'shot' && e.from === from) as (Logged & { to: number })[];

  it('the MG fires only with a gunner aboard, every mgFireSeconds, at infantry within mgRangeM', () => {
    // nato's jeep (4) on its HQ facing east; pact Soldier 2 150 m off, Soldier 3 at 170 m
    const fires = (ids: number[]) => {
      const m = scene({ tune: { jeepsPerSide: 1, hp: 1e9, fireJitterSeconds: 0, walkSpeed: 0, ...NO_HQ }, place: { 2: { x: -410, y: 0, fx: 1 }, 3: { x: -390, y: 0, fx: 1 } } });
      crew(m, vehicle(m, 'jeep'), ids, { x: -560, y: 0 });
      return play(m, 4 * HZ).events;
    };
    const events = fires([0, 1]);
    const mg = shotsBy(events, 1);
    expect(mg.length).toBeGreaterThan(10);
    expect(new Set(mg.map((e) => e.to))).toEqual(new Set([2]));
    expect(new Set(mg.slice(1).map((e, i) => e.tick - mg[i]!.tick))).toEqual(new Set([Math.round(DEFAULT_TUNE.mgFireSeconds * HZ)]));
    expect(shotsBy(events, 0)).toEqual([]); // the driver only drives
    expect(shotsBy(fires([0]), 0)).toEqual([]);
  });

  it('a rifle Squad shoots an empty jeep to a Wreck, hitting it like a Soldier', () => {
    const m = scene({ tune: { jeepsPerSide: 1, walkSpeed: 0, rockets: 0 }, place: { 2: { x: 100, y: 0, fx: -1 }, 3: { x: 100, y: 5, fx: -1 } } });
    Object.assign(vehicle(m, 'jeep'), { x: 0, y: 0 }); // a map script's jeep, left out in the field
    const { events, views } = play(m, 30 * HZ, 'pact');
    const hits = events.filter((e) => e.kind === 'shot' && e.to === 4);
    expect(new Set(hits.map((e) => (e as { from: number }).from))).toEqual(new Set([2, 3]));
    expect(viewOf(m, 4)).toBeUndefined();
    expect(views.at(-1)!.vehicles!.find((x) => x.wreck)).toMatchObject({ side: 'nato', kind: 'jeep', x: 0, y: 0 });
  });

  it('a tank round on a full jeep destroys it: four Tickets', () => {
    // nato's Squad (0..3) in its jeep (9) out in the field; pact's tank (10), crewed by 4 and 5, 150 m east facing it
    const m = scene({ tune: { squadSize: 4, tanksPerSide: 1, jeepsPerSide: 1, tankAimSeconds: [0, 0] }, place: { 6: { x: 500, y: 400 }, 7: { x: 500, y: 400 } } });
    crew(m, vehicle(m, 'jeep'), [0, 1, 2, 3], { x: 0, y: 0 });
    Object.assign(crew(m, vehicle(m, 'tank', 'pact'), [4, 5], { x: 150, y: 0 }), { fx: -1, fy: 0 });
    const { events } = play(m, 4 * HZ);
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id).sort()).toEqual([0, 1, 2, 3]);
    expect(m.tickets.nato).toBe(ticketsStart(m) - 4);
    expect(viewOf(m, 9)).toBeUndefined();
    expect(commanderView(m, 'nato').vehicles).toContainEqual(expect.objectContaining({ kind: 'jeep', wreck: true }));
  });
});
