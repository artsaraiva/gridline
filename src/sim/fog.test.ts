import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points: Soldiers not placed stay at their HQ. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [],
};

type Placement = { x: number; y: number; fx?: number; fy?: number };

/** Like combat.test.ts `scene`: placing Soldiers stands in for a map script; everything after runs through `step`. Nobody can be Wounded. */
function scene(place: Record<number, Placement>, o: { tune?: Partial<Tune>; map?: Partial<MapData>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, hp: 1e9, jeepsPerSide: 0, ...o.tune }; // #108: the tank stands for every ground vehicle
  const m = createMatch({ seed: 1, map: { ...field, ...o.map }, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Steps `ticks` times; the nato Commander view after every step. */
function play(m: Match, ticks: number): CommanderView[] {
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    step(m, []);
    views.push(commanderView(m, 'nato'));
  }
  return views;
}

describe('Contacts', () => {
  it('an enemy a friendly Soldier sees is a Contact: position and facing only', () => {
    // nato id 0 faces east; pact id 1 stands 100 m east facing away; nobody fires
    const [v] = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0, fx: 1 } }, { tune: { fireRangeM: 0 } }), 1);
    expect(v!.contacts).toEqual([{ id: 1, x: 100, y: 0, fx: 1, fy: 0 }]);
  });

  it('an enemy no friendly Soldier sees is not', () => {
    const behind = play(scene({ 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } }), HZ); // behind nato, which faces east
    const walled = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } }, { map: { walls: [{ x0: 50, y0: -5, x1: 51, y1: 5 }] } }), HZ);
    const far = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 155, y: 0 } }), HZ);
    const atHome = play(scene({}), HZ); // both Squads at their HQs
    for (const views of [behind, walled, far, atHome]) expect(views.flatMap((v) => v.contacts)).toEqual([]);
  });
});

describe('Last Known Positions', () => {
  // Two Squads of 1 a Side: nato 0, 1 and pact 2, 3. nato 0 faces east and sees pact 2, 100 m east and facing away, out
  // of fire range. pact 3, 50 m behind nato 0, Wounds it on tick 0, so from tick 1 nobody on nato's Side sees pact 2.
  const lost = () =>
    scene(
      { 0: { x: 0, y: 0 }, 2: { x: 100, y: 0, fx: 1 }, 3: { x: -50, y: 0, fx: 1 } },
      { tune: { hp: 100, hitChance: 1, damage: [100, 100], fireRangeM: 60 }, squads: 2 },
    );

  it('a lost Contact freezes where it was last seen, with no facing, and fades out over 3.5 s', () => {
    const views = play(lost(), 5 * HZ);
    expect(views[0]!.contacts.map((c) => c.id)).toEqual([2]);
    expect(views[0]!.lastKnown).toEqual([]);
    const shown = views.slice(1).filter((v) => v.lastKnown!.length > 0);
    expect(shown).toHaveLength(3.5 * HZ);
    expect(views.slice(1, 1 + shown.length)).toEqual(shown); // from the tick it was lost, without a gap
    for (const v of shown) {
      expect(v.contacts).toEqual([]);
      expect(Object.keys(v.lastKnown![0]!).sort()).toEqual(['fade', 'x', 'y']);
      expect(v.lastKnown![0]).toMatchObject({ x: 100, y: 0 });
    }
    const fades = shown.map((v) => v.lastKnown![0]!.fade);
    expect(fades[0]).toBeCloseTo(1, 1);
    expect(fades.at(-1)).toBeCloseTo(0, 1);
    expect(fades.every((f, i) => i === 0 || f < fades[i - 1]!)).toBe(true);
  });
});

// Squad memory is the Squad AI's input, not part of any view: these read `squad.memory`, the contract #34 consumes.
describe('squad memory', () => {
  const memory = (m: Match, squad: number) => m.squads[squad]!.memory.map((s) => [s.id, s.source]);

  it('Squads do not share sightings; the Commander sees the union', () => {
    // Two Squads of 1 a Side: nato 0 sees pact 2 to the east, nato 1 sees pact 3 to the north; neither sees the other's
    const m = scene(
      { 0: { x: 0, y: 0 }, 1: { x: 0, y: 300, fx: 0, fy: 1 }, 2: { x: 100, y: 0, fx: 1 }, 3: { x: 0, y: 400, fx: 0, fy: 1 } },
      { tune: { fireRangeM: 0 }, squads: 2 },
    );
    const [v] = play(m, 1);
    expect(memory(m, 0)).toEqual([[2, 'seen']]);
    expect(memory(m, 1)).toEqual([[3, 'seen']]);
    expect(v!.contacts.map((c) => c.id).sort()).toEqual([2, 3]);
  });

  it('a Squad remembers a lost enemy for 8 s, much longer than its Last Known Position shows', () => {
    // as in 'Last Known Positions': nato 0 sees pact 2 on tick 0 only
    const m = scene(
      { 0: { x: 0, y: 0 }, 2: { x: 100, y: 0, fx: 1 }, 3: { x: -50, y: 0, fx: 1 } },
      { tune: { hp: 100, hitChance: 1, damage: [100, 100], fireRangeM: 60 }, squads: 2 },
    );
    const remembered: number[] = [];
    for (let i = 0; i < 10 * HZ; i++) {
      step(m, []);
      if (m.squads[0]!.memory.some((s) => s.id === 2)) remembered.push(i);
    }
    expect(remembered[0]).toBe(0);
    expect(remembered.at(-1)! / HZ).toBe(8); // forgotten on the tick after
    expect(remembered).toHaveLength(remembered.at(-1)! + 1);
  });

  it('heard gunfire goes into the Squad memory but never makes a Contact or a Last Known Position', () => {
    // pact 1, 100 m behind nato 0 (which faces east), fires at it; nato 0 never sees it
    const m = scene({ 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } });
    const views = play(m, 10 * HZ);
    expect(m.squads[0]!.memory).toEqual([{ id: 1, x: -100, y: 0, tick: expect.any(Number), source: 'heard' }]);
    expect(views.flatMap((v) => [...v.contacts, ...v.lastKnown!])).toEqual([]);
  });

  it('Soldiers within 90 m of a shooter hear it', () => {
    // pact 3 fires at nato 0 from 50 m behind it; nato 1 (another Squad) stands 80 m from pact 3, nato 2 120 m; neither sees it
    const m = scene(
      { 0: { x: 0, y: 0 }, 1: { x: -50, y: 80, fx: 0, fy: 1 }, 2: { x: -50, y: 120, fx: 0, fy: 1 }, 3: { x: -50, y: 0, fx: 1 } },
      { squads: 3 },
    );
    play(m, HZ);
    expect(memory(m, 0)).toEqual([[3, 'heard']]);
    expect(memory(m, 1)).toEqual([[3, 'heard']]);
    expect(memory(m, 2)).toEqual([]);
  });

  it('suppressive fire is heard by the Squad it lands on, even from beyond hearing range, and by nobody far from both ends', () => {
    // pact 2 puts suppressive fire on nato 0's Last Known Position, 100 m off; nato 1 is 200 m north of both; nobody sees anyone
    const m = scene({ 0: { x: 0, y: 0 }, 1: { x: -50, y: 200 }, 2: { x: -100, y: 0, fx: 1 } }, { tune: { visionM: 0 }, squads: 2 });
    m.squads[2]!.memory.push({ id: 0, x: 0, y: 0, tick: 0, source: 'seen' });
    const events = step(m, []);
    expect(events.some((e) => e.kind === 'suppressive')).toBe(true);
    expect(memory(m, 0)).toEqual([[2, 'heard']]);
    expect(memory(m, 1)).toEqual([]);
  });
});

describe('the enemy roster', () => {
  it('never reaches the view: no enemy Squads, strength or redeploy timers', () => {
    // three Squads a Side; nato 0 and pact 3 shoot each other dead, so a pact Squad is wiped and waiting to Redeploy
    const m = scene({ 0: { x: 0, y: 0 }, 3: { x: 100, y: 0, fx: -1 } }, { tune: { hp: 100, hitChance: 1, damage: [100, 100] }, squads: 3 });
    for (const v of play(m, 12 * HZ)) {
      expect(Object.keys(v).sort()).toEqual(['assets', 'contacts', 'effects', 'friendlies', 'lastKnown', 'points', 'result', 'score', 'seconds', 'side', 'squads', 'tick', 'tickets', 'vehicles']);
      expect(v.squads.map((q) => q.id)).toEqual([0, 1, 2]);
      expect(v.friendlies.every((f) => f.id < 3)).toBe(true);
      expect(v.vehicles!.map((x) => x.side)).toEqual(['nato']); // #107: the enemy tank, unseen in its HQ, is not there
    }
  });
});

describe('a Cruise Missile in the sky (#99)', () => {
  it('is in the enemy view too, as an effect with its caller, launch point and flight, and nothing else new', () => {
    const m = scene({}, { map: { points: [{ id: 'C', name: 'C', x: 0, y: 0, owner: 'nato' }] }, tune: { missileCooldownSeconds: 0 } });
    step(m, [{ tick: 0, side: 'nato', kind: 'asset', asset: 'missile', at: { x: 100, y: 0 } }]);
    const enemy = commanderView(m, 'pact');
    expect(Object.keys(enemy).sort()).toEqual(['assets', 'contacts', 'effects', 'friendlies', 'lastKnown', 'points', 'result', 'score', 'seconds', 'side', 'squads', 'tick', 'tickets', 'vehicles']);
    expect(enemy.effects).toHaveLength(1);
    expect(Object.keys(enemy.effects![0]!).sort()).toEqual(['asset', 'flight', 'from', 'impactIn', 'left', 'radius', 'side', 'total', 'x', 'y']);
    expect(enemy.effects![0]).toMatchObject({ asset: 'missile', side: 'nato', x: 100, y: 0 });
    expect(enemy.effects).toEqual(commanderView(m, 'nato').effects);
  });
});

describe('effect events', () => {
  /** Steps `ticks` times; each Side's filtered events, with the raw ones for comparison. */
  function watch(m: Match, ticks: number) {
    const out: Record<SideId | 'all', SimEvent[]> = { nato: [], pact: [], all: [] };
    for (let i = 0; i < ticks; i++) {
      const events = step(m, []);
      out.all.push(...events);
      out.nato.push(...commanderEvents(m, 'nato', events));
      out.pact.push(...commanderEvents(m, 'pact', events));
    }
    return out;
  }
  const shotsBy = (events: SimEvent[], side: SideId) => events.filter((e) => e.kind === 'shot' && e.side === side);

  it("friendly fire always shows; enemy fire only while the shooter is a Contact", () => {
    // pact 1 fires at nato 0 from behind it, unseen
    const unseen = watch(scene({ 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } }), 5 * HZ);
    expect(shotsBy(unseen.all, 'pact').length).toBeGreaterThan(0);
    expect(shotsBy(unseen.pact, 'pact')).toEqual(shotsBy(unseen.all, 'pact'));
    expect(shotsBy(unseen.nato, 'pact')).toEqual([]);

    // face to face: both see the shooter
    const seen = watch(scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } }), 5 * HZ);
    expect(shotsBy(seen.nato, 'pact').length).toBeGreaterThan(0);
    expect(shotsBy(seen.nato, 'pact')).toEqual(shotsBy(seen.all, 'pact'));
  });

  it('enemy suppressive fire shows only while the shooter is a Contact (#54)', () => {
    const suppressiveBy = (events: SimEvent[]) => events.filter((e) => e.kind === 'suppressive' && e.side === 'pact');
    // pact 1 puts suppressive fire on nato 0's Last Known Position from 100 m behind it; nobody sees anyone
    const unseen = scene({ 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } }, { tune: { visionM: 0 } });
    unseen.squads[1]!.memory.push({ id: 0, x: 0, y: 0, tick: 0, source: 'seen' });
    const hidden = watch(unseen, HZ);
    expect(suppressiveBy(hidden.all).length).toBeGreaterThan(0);
    expect(suppressiveBy(hidden.nato)).toEqual([]);

    // pact 1 faces away 100 m east of nato 0, which sees it, and fires at the same Last Known Position
    const seen = scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0, fx: 1 } });
    seen.squads[1]!.memory.push({ id: 0, x: 0, y: 0, tick: 0, source: 'seen' });
    const shown = watch(seen, HZ);
    expect(suppressiveBy(shown.all).length).toBeGreaterThan(0);
    expect(suppressiveBy(shown.nato)).toEqual(suppressiveBy(shown.all));
  });

  it("an enemy's Wounding shows when it is a Contact; its death and Redeploy never do", () => {
    // two Squads of 1 a Side: nato 0 and pact 2 shoot each other on tick 0, bleed out at 8 s and Redeploy at 28 s
    const m = scene({ 0: { x: 0, y: 0, fx: -1 }, 2: { x: -100, y: 0, fx: 1 } }, { tune: { hp: 100, hitChance: 1, damage: [100, 100] }, squads: 2 });
    const { nato, all } = watch(m, 30 * HZ);
    const kinds = (events: SimEvent[], side: SideId) => events.filter((e) => e.kind !== 'shot' && e.kind !== 'radio' && e.side === side).map((e) => e.kind);
    expect(kinds(all, 'pact')).toEqual(['wounded', 'death', 'redeploy']);
    expect(kinds(nato, 'pact')).toEqual(['wounded']);
    expect(kinds(nato, 'nato')).toEqual(['wounded', 'death', 'redeploy']);
  });
});

describe('#107: an enemy tank under the Soldier sight rules', () => {
  // nato Soldier 0 at the origin facing east; the empty pact tank (vehicle id 3: after both Soldiers and the nato tank) parked east of it
  const parked = (x: number) => {
    const m = scene({ 0: { x: 0, y: 0 }, 1: { x: 520, y: 0 } });
    Object.assign(m.vehicles[1]!, { x, y: 0, fx: -1, fy: 0 });
    return m;
  };

  it('is seen at 1.5x Soldier range, as a vehicle Contact with position, hull and turret facing only', () => {
    const v = play(parked(200), 1).at(-1)!;
    expect(v.contacts).toEqual([]);
    const tank = v.vehicles!.find((x) => x.side === 'pact')!;
    expect(Object.keys(tank).sort()).toEqual(['empty', 'fx', 'fy', 'id', 'kind', 'side', 'tx', 'ty', 'x', 'y']); // parked with nobody aboard
    expect(tank).toMatchObject({ id: 3, kind: 'tank', x: 200, y: 0, fx: -1, fy: 0 });
  });

  it('is not seen past that range, nor a Soldier at the same distance', () => {
    const far = play(parked(240), 1).at(-1)!;
    expect(far.vehicles!.filter((x) => x.side === 'pact')).toEqual([]);
    const m = scene({ 0: { x: 0, y: 0 }, 1: { x: 200, y: 0, fx: -1 } });
    expect(play(m, 1).at(-1)!.contacts).toEqual([]);
  });

  it('leaves a plain Last Known Position when lost, and is never seen inside its own HQ', () => {
    const m = parked(200);
    play(m, 1);
    m.vehicles[1]!.x = 300;
    const lost = play(m, 1).at(-1)!;
    expect(lost.vehicles!.filter((x) => x.side === 'pact')).toEqual([]);
    expect(lost.lastKnown).toEqual([{ x: 200, y: 0, fade: expect.closeTo(1, 1) }]);
    const home = scene({ 0: { x: 400, y: 0 } });
    expect(play(home, 1).at(-1)!.vehicles!.filter((x) => x.side === 'pact')).toEqual([]);
  });
});
