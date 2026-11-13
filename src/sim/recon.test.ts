// Recon Plane (#139), through the Simulation interface: the two-tap call, the pass across the Play Area, what it reveals, and the enemy AA.
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Kaltenbach's shape in the open: HQs 415 m out on the flanks, the Play Area edge 456 m out. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -456, y: -456 },
    { x: 456, y: -456 },
    { x: 456, y: 456 },
    { x: -456, y: 456 },
  ],
  hqs: { nato: { x: -415, y: 0 }, pact: { x: 415, y: 0 } },
  points: [{ id: 'C', name: 'C', x: 0, y: 0 }],
  grid: { cols: 12, rows: 12, squareM: 76, letters: 'ABCDEFGHIJKL' },
};

/** nato Soldiers 0..5, pact 6..11, stood where placed (else at their HQ); nobody fires or walks. */
function scene(place: Record<number, Vec2 & { fx?: number }> = {}, tune: Partial<Tune> = {}, seed = 1): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, crewSpawnChance: 0, ...tune };
  const m = createMatch({ seed, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** A pass through `at` towards `to`: north along x = 200 unless told. */
const recon = (m: Match, at: Vec2 = { x: 200, y: 0 }, to: Vec2 | null = { x: at.x, y: at.y + 50 }): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'recon', at, ...(to && { to }) });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step
  pact: CommanderView[];
}

function play(m: Match, ticks: number, commands: Command[] = [recon(m)]): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? commands : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const lines = (r: Run) => r.events.flatMap((e) => (e.kind === 'radio' && e.type === 'asset' ? [e.text] : []));
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'recon')!;
const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'recon');
/** The pass runs from 150 m outside the south edge to 150 m past the north one: 1212 m at 100 m/s. */
const PASS = Math.round(12.12 * HZ);
/** The tick the aircraft is level with `y` on a pass north. */
const over = (y: number) => Math.round(((y + 606) / 100) * HZ);

describe('Recon Plane: the call', () => {
  it('is ready at match start, on a 90 s cooldown from the call, a strip 120 m wide right across the Play Area', () => {
    const m = scene();
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 0, cooldown: 90, radius: 60, line: { width: 120, across: true, beyond: 150 } });
    const run = play(m, 1);
    expect(lines(run)).toEqual(['Recon pass inbound']);
    expect(row(run.views[0]!).readyIn).toBeCloseTo(90, 0);
  });

  it('needs a direction, and may cross the enemy HQ (it only flies over)', () => {
    const m = scene();
    expect(rejections(step(m, [recon(m, { x: 200, y: 0 }, null)]))).toEqual(['needs a direction']);
    expect(rejections(step(m, [recon(m, { x: 200, y: 0 }, { x: 200, y: 0 })]))).toEqual(['needs a direction']);
    expect(rejections(step(m, [recon(m, { x: 200, y: 0 }, { x: 500, y: 0 })]))).toEqual([]);
  });

  it('a second one waits for the first to leave', () => {
    const m = scene({}, { reconCooldownSeconds: 0 });
    play(m, 1);
    expect(rejections(step(m, [recon(m)]))).toEqual(['in the air']);
    play(m, PASS, []);
    expect(rejections(step(m, [recon(m)]))).toEqual([]);
  });
});

describe('Recon Plane: the pass', () => {
  it('enters 150 m outside the Play Area on the line, flies it at 100 m/s and leaves 150 m past the far edge, in both Sides\' views', () => {
    const run = play(scene(), PASS + 2);
    expect(effect(run.views[0]!)).toMatchObject({ side: 'nato', from: { x: 200, y: -606 }, line: { to: { x: 200, y: 606 }, width: 120 }, craft: { x: 200, fx: 0, fy: 1, turn: 0 } });
    expect(effect(run.views[0]!)!.total).toBeCloseTo(12.12, 1);
    const at5 = effect(run.pact[5 * HZ]!)!;
    expect(Math.abs(at5.craft!.y - (-606 + 500))).toBeLessThan(2);
    expect(at5.line).toBeUndefined(); // the strip is the caller's alone
    expect(run.pact[5 * HZ]!.vehicles!.some((v) => v.kind === 'recon' && v.side === 'nato')).toBe(true);
    expect(effect(run.views[PASS - 2]!)).toBeTruthy();
    expect(effect(run.views[PASS]!)).toBeUndefined();
  });

  it('reveals the enemies within 60 m of it as it passes, then leaves a Last Known Position; one 80 m off the line never shows', () => {
    const m = scene({ 6: { x: 240, y: 0 }, 7: { x: 280, y: 0 }, 8: { x: 150, y: 300 } });
    const run = play(m, PASS + 2);
    const ids = (i: number) => run.views[i]!.contacts.map((c) => c.id);
    expect(ids(over(-70))).toEqual([]);
    expect(ids(over(0))).toEqual([6]);
    expect(ids(over(300))).toEqual([8]);
    expect(run.views[over(300)]!.lastKnown!.some((k) => k.x === 240 && k.y === 0)).toBe(true);
    expect(run.views.every((v) => !v.contacts.some((c) => c.id === 7) && !(v.lastKnown ?? []).some((k) => k.x === 280))).toBe(true);
    expect(lines(run)).toEqual(['Recon pass inbound', 'Recon pass complete, 2 hostiles']);
  });

  it('hides nobody inside their own HQ, sees a vehicle on the ground, and says so when it found nothing', () => {
    const m = scene({}, { jeepsPerSide: 1, reconCooldownSeconds: 0 });
    const jeep = m.vehicles.find((v) => v.kind === 'jeep' && v.side === 'pact')!;
    Object.assign(jeep, { x: 150, y: 100 });
    const hq = play(m, PASS + 2, [recon(m, { x: 415, y: -200 })]); // straight over the Pact HQ, where 6..11 stand
    expect(hq.views.every((v) => v.contacts.length === 0)).toBe(true);
    expect(lines(hq)).toEqual(['Recon pass inbound', 'Recon pass complete, no contacts']);
    const run = play(m, PASS + 2, [{ ...recon(m), tick: m.tick }]);
    expect(run.views[over(100)]!.vehicles!.some((v) => v.id === jeep.id)).toBe(true);
    expect(run.views[over(-100)]!.vehicles!.some((v) => v.id === jeep.id)).toBe(false);
    expect(lines(run)).toEqual(['Recon pass inbound', 'Recon pass complete, 1 hostile']);
  });

  it('a kill on an enemy only it revealed, within the grace window, scores a UAV assist', () => {
    const m = scene({ 6: { x: 200, y: 0, fx: 1 } }, { hitChance: 1, damage: [100, 100], fireRangeM: 140 });
    play(m, over(0) + 1);
    Object.assign(m.soldiers[0]!, { x: 100, y: 0 }); // walks up, sees it, shoots it down
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * HZ && m.soldiers[6]!.state !== 'dead'; i++) events.push(...step(m, []));
    expect(events.filter((e) => e.kind === 'award')).toEqual([{ kind: 'award', side: 'nato', category: 'uav', points: 50, reason: 'UAV assist' }]);
  });

  it('is hashed: the same call replays the same, and its state moves the hash', () => {
    const [a, b] = [scene({ 6: { x: 240, y: 0 } }), scene({ 6: { x: 240, y: 0 } })];
    play(a, over(100));
    play(b, over(100));
    expect(stateHash(a)).toBe(stateHash(b));
    b.assets.effects[0]!.found!.push(7);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe('Recon Plane: the enemy AA', () => {
  it('an AA on its line shoots it down: "Recon lost", and the enemies beyond stay hidden', () => {
    let downed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = scene({ 6: { x: 240, y: -400 }, 7: { x: 240, y: 400 } }, { aasPerSide: 1 }, seed);
      const aa = m.vehicles.find((v) => v.kind === 'aa' && v.side === 'pact')!;
      Object.assign(aa, { x: 300, y: 0, seats: [11] }); // 100 m off the line: it sees the aircraft, the aircraft never sees it
      Object.assign(m.soldiers[11]!, { x: 300, y: 0, vehicle: aa.id });
      const run = play(m, PASS + 3 * HZ);
      const lost = run.events.find((e) => e.kind === 'radio' && e.text === 'Recon lost')?.tick ?? -1;
      if (lost < 0) continue;
      downed++;
      expect(lines(run)).toEqual(['Recon pass inbound', 'Recon lost']);
      expect(effect(run.views[lost]!)).toMatchObject({ lost: true });
      expect(effect(run.views[lost]!)!.craft!.y).toBeLessThan(300);
      expect(effect(run.views[lost + 2 * HZ]!)).toBeUndefined();
      expect(run.views.some((v) => v.contacts.some((c) => c.id === 6))).toBe(true);
      expect(run.views.every((v) => !v.contacts.some((c) => c.id === 7))).toBe(true);
      expect(m.wrecks).toEqual([]);
    }
    expect(downed).toBeGreaterThanOrEqual(8);
  });
});
