// Requests (#41), through the Simulation interface: the trigger rules, the 30 s life, and how an Asset closes one.
import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, MapData, SimEvent, SquadView, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;
const { ammoLow } = DEFAULT_TUNE;

/** Open ground 1200 m across (12 x 12 squares of 100 m), HQs far out on the flanks, no points. */
const field = (): MapData => ({
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [],
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
});

type Placement = { x?: number; y?: number; fx?: number; ammo?: number; suppression?: number };

/** Placing Soldiers stands in for a map script; everything after runs through `step`. Squad 0 is NATO's, the last Squad the Pact's. */
function scene(place: Record<number, Placement>, o: { tune?: Partial<Tune>; size?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: o.size ?? 1, speedJitter: 0, spread: 0, ...o.tune };
  const m = createMatch({ seed: 1, map: field(), tune, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const run = (m: Match, ticks: number, commands: Command[] = []) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, i === 0 ? commands : []));
  return events;
};
const squad = (m: Match): SquadView => commanderView(m, 'nato').squads[0]!;
const request = (m: Match) => squad(m).request;
const asset = (m: Match, kind: 'scan' | 'supply' | 'barrage', at: { x: number; y: number }): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: kind, at });

// NATO's Soldier at the origin faces east. SEEN: the Pact's is ahead of it, in view. UNSEEN: it is behind (and shoots NATO's, who can't see it).
const SEEN = { 0: { x: 0, y: 0, suppression: 0.9 }, 1: { x: 80, y: 30 } };
const UNSEEN = { 0: { x: 0, y: 0, suppression: 0.9 }, 1: { x: -60, y: 30, fx: 1 } };

describe('Request triggers', () => {
  it('Supplies when most of the Squad is low on ammo, at the Squad', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: ammoLow - 1 }, 1: { x: 10, y: 10, ammo: ammoLow - 1 }, 2: { x: 10, y: 10 } }, { size: 3 });
    run(m, 1);
    expect(request(m)).toMatchObject({ asset: 'supply', grid: 'G6' });
  });

  it('not when only some are low', () => {
    const m = scene({ 0: { x: 0, y: 0, ammo: 0 }, 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 }, 3: { x: 0, y: 0 } }, { size: 4 });
    run(m, 5);
    expect(request(m)).toBeNull();
  });

  it('Fire support when suppressed by an enemy the Squad sees, at that enemy', () => {
    const m = scene(SEEN);
    run(m, 1);
    expect(request(m)).toMatchObject({ asset: 'barrage', grid: 'G6' });
    expect(request(m)!.at).toEqual({ x: 50, y: 50 }); // the centre of its square
  });

  it('Recon when taking fire from an enemy it cannot see', () => {
    const m = scene(UNSEEN);
    run(m, 1);
    expect(request(m)?.asset).toBe('scan');
  });

  it('nothing when nobody is suppressed and ammo is fine', () => {
    const m = scene({ 0: { x: 0, y: 0 } });
    run(m, 20);
    expect(request(m)).toBeNull();
  });

  it('a Squad may ask for an Asset that is cooling down (the Barrage starts the match cooling)', () => {
    const m = scene(SEEN);
    run(m, 1);
    const b = commanderView(m, 'nato').assets!.find((a) => a.asset === 'barrage')!;
    expect(b.readyIn).toBeGreaterThan(0);
    expect(request(m)?.asset).toBe('barrage');
  });

  it('the Request goes out on the radio, in the Squad\'s own words, with its grid', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    const lines = run(m, 3).filter((e) => e.kind === 'radio' && e.type === 'request');
    expect(lines).toEqual([expect.objectContaining({ side: 'nato', squad: 0, text: 'requesting supplies', grid: 'G6', priority: 1 })]);
  });

  it('only the Squad\'s own Side hears it', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 }, 1: { x: 400, y: 10, ammo: 0 } });
    const all = run(m, 3);
    const heard = commanderEvents(m, 'nato', all).filter((e) => e.kind === 'radio' && e.type === 'request');
    expect(heard).toHaveLength(1);
    expect(all.filter((e) => e.kind === 'radio' && e.type === 'request')).toHaveLength(2);
  });
});

describe('Request life', () => {
  it('one open Request per Squad: a new need while one is open changes nothing', () => {
    const m = scene({ 0: { x: 0, y: 0, ammo: 0, suppression: 0.9 }, 1: { x: 80, y: 30 } });
    run(m, 1);
    const first = request(m);
    run(m, 10 * HZ);
    expect(request(m)).toMatchObject({ asset: first!.asset, grid: first!.grid });
    expect(run(m, 5 * HZ).filter((e) => e.kind === 'radio' && e.type === 'request')).toHaveLength(0);
  });

  it('counts down from 30 s and expires', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1);
    expect(request(m)!.left).toBeCloseTo(30, 0);
    run(m, 10 * HZ);
    expect(request(m)!.left).toBeCloseTo(20, 0);
    run(m, 20 * HZ - 1);
    expect(request(m)).not.toBeNull();
    run(m, 1);
    expect(request(m)).toBeNull();
  });

  it('a Squad that still needs it asks again, but not at once', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1 + 30 * HZ);
    expect(request(m)).toBeNull();
    run(m, 14 * HZ);
    expect(request(m)).toBeNull();
    run(m, 2 * HZ);
    expect(request(m)?.left).toBeGreaterThan(25);
  });

  it('a wiped Squad has none', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1);
    Object.assign(m.soldiers[0]!, { state: 'dead', deadAt: m.tick });
    run(m, 1);
    expect(request(m)).toBeNull();
  });

  it('is deterministic', () => {
    const a = scene(SEEN);
    const b = scene(SEEN);
    run(a, 40 * HZ);
    run(b, 40 * HZ);
    expect(commanderView(a, 'nato')).toEqual(commanderView(b, 'nato'));
  });
});

describe('Request closes', () => {
  it('when a Supply Drop lands near its grid, not while the crate is still falling', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1);
    expect(request(m)?.asset).toBe('supply');
    run(m, 1, [asset(m, 'supply', { x: 50, y: 50 })]);
    run(m, 4 * HZ);
    expect(request(m)).not.toBeNull(); // 5 s fall
    run(m, 1 * HZ + 2);
    expect(request(m)).toBeNull();
  });

  it('not when it lands elsewhere', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1, [asset(m, 'supply', { x: 400, y: 400 })]);
    run(m, 7 * HZ);
    expect(request(m)).not.toBeNull();
  });

  it('not for a different Asset', () => {
    const m = scene({ 0: { x: 10, y: 10, ammo: 0 } });
    run(m, 1, [asset(m, 'scan', { x: 50, y: 50 })]);
    run(m, 3 * HZ);
    expect(request(m)).not.toBeNull();
  });

  it('Recon closes as the UAV arrives; Fire support when the first shell lands', () => {
    const r = scene(UNSEEN);
    run(r, 1);
    const at = request(r)!.at;
    run(r, 1, [asset(r, 'scan', at)]);
    run(r, 2);
    expect(request(r)).toBeNull();

    const f = scene(SEEN, { tune: { barrageCooldownSeconds: 0 } });
    run(f, 1);
    const spot = request(f)!.at;
    run(f, 1, [asset(f, 'barrage', spot)]);
    run(f, 13 * HZ);
    expect(request(f)).not.toBeNull(); // shells leave at 10 s and fly 4 s
    run(f, 1 * HZ);
    expect(request(f)).toBeNull();
  });
});
