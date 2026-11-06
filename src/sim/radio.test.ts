// Callouts and radio spam control (#38), through the Simulation's Events: what a Squad says, when, and what reaches the Commander.
import { describe, expect, it } from 'vitest';
import { commanderEvents, createMatch, gridRef, stateHash, step, type Match } from './index';
import { RADIO_PRIORITY } from './radio';
import { DEFAULT_TUNE } from './tune';
import type { Command, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

const GRID = { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' };

/** Open ground 1200 m across (12 x 12 squares of 100 m, G7 at the origin), HQs on the flanks (A7 and L7). */
function field(points: MapData['points'] = []): MapData {
  return {
    name: 'field',
    playArea: [
      { x: -600, y: -600 },
      { x: 600, y: -600 },
      { x: 600, y: 600 },
      { x: -600, y: 600 },
    ],
    hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
    points,
    grid: GRID,
  };
}

interface Placement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
  state?: 'dead';
}

/** Soldier ids run nato first, squad by squad, `squadSize` each. Placing Soldiers is the one reach past the interface. */
function scene(o: { place?: Record<number, Placement>; tune?: Partial<Tune>; points?: MapData['points']; squads?: number; seed?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, spread: 0, ...o.tune };
  const m = createMatch({ seed: o.seed ?? 1, map: field(o.points), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

type Logged = SimEvent & { tick: number };
type Radio = Extract<Logged, { kind: 'radio' }>;

function play(m: Match, ticks: number, at: Record<number, (m: Match) => Command[]> = {}) {
  const events: Logged[] = [];
  const raw: SimEvent[] = [];
  const t0 = m.tick;
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    const out = step(m, at[tick - t0]?.(m) ?? []);
    raw.push(...out);
    for (const e of out) events.push({ ...e, tick });
  }
  return { events, raw };
}

const lines = (events: Logged[], side: SideId, squad?: number | null, type?: string) =>
  events.filter((e): e is Radio => e.kind === 'radio' && e.side === side && (squad === undefined || e.squad === squad) && (!type || e.type === type));

/** Nato Squad 0 (ids 0, 1) faces pact Squad 1 (ids 2, 3) across 100 m; nobody can hit, so only sight and noise happen. */
const FACE_OFF = { 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 0, y: 10, fx: 1, fy: 0 }, 2: { x: 100, y: 0, fx: -1, fy: 0 }, 3: { x: 100, y: 10, fx: -1, fy: 0 } };
const NO_HITS: Partial<Tune> = { squadSize: 2, hitChance: 0 };
const ONE_SHOT: Partial<Tune> = { squadSize: 1, hitChance: 1, damage: [100, 100] };

describe('priority scale', () => {
  it('Squad wiped = Man down > Copy and Delayed acks > Contact > Taking fire > the rest', () => {
    const p = RADIO_PRIORITY;
    expect(p.wiped).toBe(p.mandown);
    for (const ack of ['ack', 'delayed', 'resuming']) expect(p.mandown).toBeGreaterThan(p[ack]!);
    expect(p.ack).toBe(p.delayed);
    expect(p.ack).toBeGreaterThan(p.contact!);
    expect(p.contact).toBeGreaterThan(p.fire!);
    for (const rest of ['capturing', 'captured', 'lost', 'redeploying', 'flanking']) expect(p.fire).toBeGreaterThan(p[rest]!);
  });

  it('the acks of Orders carry the scale, whatever the Squad producing them put on the line', () => {
    const m = scene({ tune: { visionM: 0 }, points: [{ id: 'A', name: 'A', x: -200, y: 0 }] });
    const { events } = play(m, 4 * HZ, { 0: (m) => [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: 'A' }] });
    const ack = lines(events, 'nato', 0, 'ack');
    expect(ack).toHaveLength(1);
    expect(ack[0]!.priority).toBe(RADIO_PRIORITY.ack);
  });
});

describe('Callouts: contact', () => {
  it('first sighting names the type and the Grid Reference of what it saw', () => {
    const { events } = play(scene({ tune: NO_HITS, place: FACE_OFF }), 2 * HZ);
    const contact = lines(events, 'nato', 0, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({ squad: 0, text: 'contact, 2 infantry', grid: gridRef(GRID, { x: 100, y: 0 }), priority: RADIO_PRIORITY.contact });
    expect(contact[0]!.tick).toBe(0);
  });

  it('a contact that goes on is not called again; one after a quiet stretch is', () => {
    const m = scene({ tune: NO_HITS, place: FACE_OFF });
    const events: Logged[] = [];
    for (let i = 0; i < 40 * HZ; i++) {
      if (i === 5 * HZ) for (const id of [2, 3]) m.soldiers[id]!.x = 500; // out of sight
      if (i === 25 * HZ) for (const id of [2, 3]) Object.assign(m.soldiers[id]!, { x: m.soldiers[0]!.x + m.soldiers[0]!.fx * 100, y: m.soldiers[0]!.y + m.soldiers[0]!.fy * 100 }); // back, dead ahead
      const tick = m.tick;
      for (const e of step(m, [])) events.push({ ...e, tick });
    }
    const ticks = lines(events, 'nato', 0, 'contact').map((e) => e.tick);
    expect(ticks).toHaveLength(2);
    expect(ticks[1]!).toBeGreaterThanOrEqual(25 * HZ);
  });

  it('a sighting that follows a short gap is the same contact, not a new one', () => {
    const m = scene({ tune: { ...NO_HITS, radioRepeatSeconds: 1 }, place: FACE_OFF });
    const events: Logged[] = [];
    for (let i = 0; i < 20 * HZ; i++) {
      if (i === 5 * HZ) for (const id of [2, 3]) m.soldiers[id]!.x = 500;
      if (i === 8 * HZ) for (const id of [2, 3]) Object.assign(m.soldiers[id]!, { x: m.soldiers[0]!.x + m.soldiers[0]!.fx * 100, y: m.soldiers[0]!.y + m.soldiers[0]!.fy * 100 });
      const tick = m.tick;
      for (const e of step(m, [])) events.push({ ...e, tick });
    }
    expect(lines(events, 'nato', 0, 'contact')).toHaveLength(1);
  });

  it('gunfire heard from an enemy it cannot see is not a contact', () => {
    // pact 1 shoots nato 0 from behind it
    const m = scene({ tune: { squadSize: 1 }, place: { 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } } });
    const { events } = play(m, 5 * HZ);
    expect(lines(events, 'nato', 0, 'fire').length).toBeGreaterThan(0);
    expect(lines(events, 'nato', 0, 'contact')).toEqual([]);
  });

  it('carries only what the Squad itself knows: a Squad that saw nothing says nothing', () => {
    const m = scene({ tune: NO_HITS, squads: 2, place: { 0: FACE_OFF[0], 1: FACE_OFF[1], 4: FACE_OFF[2], 5: FACE_OFF[3] } });
    const { events } = play(m, 3 * HZ);
    expect(lines(events, 'nato', 0, 'contact')).toHaveLength(1);
    expect(lines(events, 'nato', 1)).toEqual([]);
  });

  it('enemy Squads call out too, but none of it reaches the Commander', () => {
    const m = scene({ tune: NO_HITS, place: FACE_OFF });
    const { raw } = play(m, 3 * HZ);
    expect(raw.some((e) => e.kind === 'radio' && e.side === 'pact')).toBe(true);
    for (const side of ['nato', 'pact'] as const) {
      const heard = commanderEvents(m, side, raw).filter((e) => e.kind === 'radio');
      expect(heard.length).toBeGreaterThan(0);
      expect(heard.every((e) => e.side === side)).toBe(true);
    }
  });

  it('every located Callout names a Grid Reference', () => {
    const { events } = play(scene({ tune: { squadSize: 4 }, squads: 2, place: { 0: FACE_OFF[0], 8: FACE_OFF[2] }, seed: 3 }), 40 * HZ);
    const said = lines(events, 'nato');
    expect(said.length).toBeGreaterThan(1);
    for (const l of said) expect(l.grid, l.type).toMatch(/^[A-L]\d{1,2}$/);
  });
});

describe('Callouts: casualties', () => {
  it('Man down names the Soldier\'s grid, and out-ranks the contact and the fire heard in the same instant', () => {
    const m = scene({ tune: ONE_SHOT, place: { 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 100, y: 0, fx: -1, fy: 0 } } });
    const { events } = play(m, 2 * HZ);
    const said = lines(events, 'nato', 0);
    expect(said.map((e) => e.type)).toEqual(['mandown']);
    expect(said[0]).toMatchObject({ text: 'man down', grid: 'G7', priority: RADIO_PRIORITY.mandown, tick: 0 });
  });

  it('a Squad that is wiped is a Commander-side line, at the grid where it fell, not held back by spam control', () => {
    const m = scene({ tune: ONE_SHOT, place: { 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 100, y: 0, fx: -1, fy: 0 } } });
    const { events } = play(m, 12 * HZ); // bleeds out after 8 s
    const wiped = lines(events, 'nato', 0, 'wiped');
    expect(wiped).toHaveLength(1);
    expect(wiped[0]).toMatchObject({ text: 'Alpha wiped', grid: 'G7', priority: RADIO_PRIORITY.wiped });
    expect(wiped[0]!.tick).toBeGreaterThanOrEqual(8 * HZ);
    expect(lines(events, 'nato', 0, 'mandown')).toHaveLength(1); // 8 s earlier, not repeated
  });

  it('redeploying names the grid of the place it comes back to', () => {
    const dead = { x: 0, y: 0, state: 'dead' as const };
    const m = scene({ tune: { visionM: 0 }, place: { 0: dead, 1: dead, 2: dead, 3: dead } });
    const { events } = play(m, 22 * HZ);
    expect(lines(events, 'nato', 0, 'wiped')).toHaveLength(1);
    const back = lines(events, 'nato', 0, 'redeploying');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ grid: 'A7' });
    expect(back[0]!.tick).toBeGreaterThanOrEqual(DEFAULT_TUNE.redeploySeconds * HZ);
  });
});

describe('Callouts: points', () => {
  const P = [{ id: 'P', name: 'C', x: 0, y: 0 }];
  const inP = { 0: { x: 0, y: 0 }, 1: { x: 3, y: 0 }, 2: { x: 0, y: 3 }, 3: { x: 3, y: 3 } };

  it('capturing, then point captured, each naming the grid', () => {
    const { events } = play(scene({ tune: { visionM: 0 }, points: P, place: inP }), 40 * HZ);
    const said = lines(events, 'nato', 0).filter((e) => e.type === 'capturing' || e.type === 'captured');
    expect(said.map((e) => e.type)).toEqual(['capturing', 'captured']);
    expect(said[0]).toMatchObject({ text: 'capturing Charlie', grid: 'G7' });
    expect(said[1]).toMatchObject({ text: 'Charlie captured', grid: 'G7' });
    expect(said[1]!.tick).toBeGreaterThanOrEqual(5 * HZ) // 4 Soldiers in the ring take it in about 8 s;
  });

  it('point lost is a NET line for the losing Side, said once whether or not a Squad is there (#85); captured stays a Callout', () => {
    const own = [{ id: 'P', name: 'C', x: 0, y: 0, owner: 'nato' as const }];
    // nobody from nato near C (its Squad sits at the HQ): pact 4-7 take it
    const far = play(scene({ tune: { visionM: 0 }, points: own, place: { 4: { x: 2, y: 0 }, 5: { x: 0, y: 2 }, 6: { x: 2, y: 2 }, 7: { x: 4, y: 2 } }, squads: 1 }), 60 * HZ).events;
    const lost = lines(far, 'nato', null, 'lost');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ squad: null, text: 'Charlie lost', grid: 'G7', priority: RADIO_PRIORITY.lost });
    expect(lines(far, 'nato', 0, 'lost')).toEqual([]);
    expect(lines(far, 'pact', undefined, 'lost')).toEqual([]);
    const captured = lines(far, 'pact', 1, 'captured');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ text: 'Charlie captured', grid: 'G7' });
    // two nato Squads standing in C hear it once, not once each
    const inside = play(scene({ tune: { visionM: 0 }, points: own, place: { 0: { x: 0, y: 0 }, 4: { x: 1, y: 0 }, 8: { x: 2, y: 0 }, 9: { x: 0, y: 2 }, 10: { x: 2, y: 2 }, 11: { x: 4, y: 2 } }, squads: 2 }), 60 * HZ).events;
    expect(lines(inside, 'nato', undefined, 'lost').map((e) => e.squad)).toEqual([null]);
  });
});

describe('spam control', () => {
  it('a Squad is held to one line every 3 s; a line that has to wait goes out when the gap is over', () => {
    // contact at 0 s; its Order is acknowledged 1-2 s later, inside the gap
    const m = scene({ tune: NO_HITS, place: FACE_OFF, points: [{ id: 'A', name: 'A', x: -200, y: 0 }] });
    const { events } = play(m, 8 * HZ, { 0: (m) => [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: 'A' }] });
    const said = lines(events, 'nato', 0);
    expect(said.slice(0, 2).map((e) => [e.type, e.tick])).toEqual([['contact', 0], ['ack', 3 * HZ]]);
  });

  it('a higher priority pre-empts the line that is waiting', () => {
    // Taking fire is waiting from about 1 s; the Order\'s ack (1-2 s) replaces it; fire has to wait for the next gap
    const m = scene({ tune: NO_HITS, place: FACE_OFF, points: [{ id: 'A', name: 'A', x: -200, y: 0 }] });
    const { events } = play(m, 8 * HZ, { 0: (m) => [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: 'A' }] });
    const types = lines(events, 'nato', 0).map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['contact', 'ack', 'fire']);
    expect(lines(events, 'nato', 0, 'fire')[0]!.tick).toBeGreaterThanOrEqual(6 * HZ);
  });

  it('under a long fight, no Squad breaks the 3 s gap, and no type repeats within 15 s (acks and wiped aside)', () => {
    for (const seed of [1, 2, 3]) {
      const m = scene({ tune: { squadSize: 4 }, squads: 2, seed, place: { 0: FACE_OFF[0], 1: FACE_OFF[1], 8: FACE_OFF[2], 9: FACE_OFF[3] } });
      const { events } = play(m, 90 * HZ);
      for (const side of ['nato', 'pact'] as const) {
        for (const squad of m.squads.filter((q) => q.side === side).map((q) => q.id)) {
          const said = lines(events, side, squad).filter((e) => e.type !== 'wiped');
          for (let i = 1; i < said.length; i++) expect(said[i]!.tick - said[i - 1]!.tick, `seed ${seed} squad ${squad}`).toBeGreaterThanOrEqual(3 * HZ);
          const last: Record<string, number> = {};
          for (const e of said) {
            if (['ack', 'delayed', 'resuming'].includes(e.type)) continue;
            expect(e.tick - (last[e.type] ?? -1e9), `seed ${seed} squad ${squad} ${e.type}`).toBeGreaterThanOrEqual(15 * HZ);
            last[e.type] = e.tick;
          }
        }
      }
    }
  });

  it('is deterministic: the same seed gives the same lines and state hash', () => {
    const run = () => {
      const m = scene({ tune: { squadSize: 4 }, squads: 2, seed: 5, place: { 0: FACE_OFF[0], 8: FACE_OFF[2] } });
      const { events } = play(m, 40 * HZ);
      return [JSON.stringify(lines(events, 'nato').concat(lines(events, 'pact'))), stateHash(m)];
    };
    expect(run()).toEqual(run());
  });
});
