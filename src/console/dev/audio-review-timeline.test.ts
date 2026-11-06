import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/types';
import { eventsBetween, SCENARIOS, type ScenarioId, viewAt } from './audio-review-timeline';

const length = (id: ScenarioId) => SCENARIOS.find((s) => s.id === id)!.length;
const radio = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'radio' }> => e.kind === 'radio');
const texts = (id: ScenarioId) => radio(eventsBetween(id, 0, length(id))).map((e) => e.text);
const at = (id: ScenarioId, text: string) => eventsBetween(id, 0, length(id)).findIndex((e) => e.kind === 'radio' && e.text === text);

describe('audio review timeline (#84)', () => {
  it('quiet observation: no Squad takes fire, only a few friendly shots, a Supply Drop comes down', () => {
    const all = eventsBetween('quiet', 0, length('quiet'));
    for (let t = 0; t <= length('quiet'); t += 1) expect(viewAt('quiet', t).squads.some((q) => q.takingFire), `t=${t}`).toBe(false);
    const shots = all.filter((e) => e.kind === 'shot');
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.length).toBeLessThan(8);
    expect(shots.every((e) => e.side === 'nato')).toBe(true);
    expect(all.some((e) => e.kind === 'impact')).toBe(false);
    expect(texts('quiet')).toEqual(['Supply Drop inbound', 'Supply Drop landed']);
    const falling = viewAt('quiet', 5).effects!.find((e) => e.asset === 'supply')!;
    expect(falling.landsIn).toBeGreaterThan(0);
    expect(viewAt('quiet', 20).effects!.find((e) => e.asset === 'supply')!.landsIn).toBe(0);
  });

  it('UAV confirmation during gunfire: both sides fire, the UAV is drawn while its lines play', () => {
    const all = eventsBetween('uav', 0, length('uav'));
    for (const side of ['nato', 'pact'] as const) expect(all.some((e) => e.kind === 'shot' && e.side === side), side).toBe(true);
    expect(all.some((e) => e.kind === 'suppressive')).toBe(true);
    expect(viewAt('uav', 10).squads.some((q) => q.takingFire)).toBe(true);
    const uav = texts('uav').filter((t) => t.includes('UAV'));
    expect(uav).toEqual(['Scan UAV inbound', 'UAV eyes on 3 hostiles', 'UAV off station, no contacts']);
    const drawn = (t: number) => viewAt('uav', t).effects!.some((e) => e.asset === 'scan');
    const when = (text: string) => secondOf('uav', text);
    expect(drawn(when('Scan UAV inbound'))).toBe(false);
    expect(drawn(when('UAV eyes on 3 hostiles'))).toBe(true);
    expect(drawn(when('UAV off station, no contacts') + 0.5)).toBe(false);
    expect(radio(all).some((e) => e.squad !== null)).toBe(true); // Squad Callouts stay buzz plus text, heard beside the Voice Lines
  });

  it('urgent warning during artillery: shells fly before impacts, then the warnings', () => {
    const all = eventsBetween('artillery', 0, length('artillery'));
    const impacts = all.filter((e) => e.kind === 'impact');
    expect(impacts.length).toBeGreaterThanOrEqual(8);
    const first = secondOf('artillery', 'Splash');
    const shells = viewAt('artillery', first - 1).effects!.find((e) => e.asset === 'barrage')!.shells!;
    expect(shells.length).toBeGreaterThan(0);
    for (const s of shells) expect(s.flight).toBeGreaterThan(0);
    expect(viewAt('artillery', first - 1).effects!.find((e) => e.asset === 'barrage')!.impactIn).toBeGreaterThan(0);
    expect(eventsBetween('artillery', first - 0.01, first + 0.01).some((e) => e.kind === 'impact')).toBe(true);
    // two impacts closer than the spacing, so the audition hears the gate at work
    const times = impactTimes('artillery');
    expect(times.some((t, i) => i > 0 && t - times[i - 1]! < 0.2)).toBe(true);
    const order = ['Barrage inbound', 'Splash', 'Artillery incoming', 'Charlie lost', 'Bravo wiped'].map((t) => at('artillery', t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const wiped = viewAt('artillery', secondOf('artillery', 'Bravo wiped') + 0.5);
    expect(wiped.friendlies.some((f) => f.squad === 1)).toBe(false);
    expect(wiped.squads.find((q) => q.name === 'Bravo')!.redeployIn).toBeGreaterThan(0);
  });

  it('viewAt and eventsBetween are pure functions of time', () => {
    const a = viewAt('uav', 12.3);
    viewAt('artillery', 30);
    eventsBetween('uav', 0, length('uav'));
    expect(viewAt('uav', 12.3)).toEqual(a);
    expect(eventsBetween('uav', 10, 11)).toEqual(eventsBetween('uav', 10, 11));
    expect(eventsBetween('uav', 10, 10)).toEqual([]);
  });

  it('every shooter is in the view when it fires, so the shot is drawn and sounds', () => {
    for (const s of SCENARIOS) {
      for (let t = 0; t < s.length; t += 0.25) {
        const view = viewAt(s.id, t + 0.25);
        for (const e of eventsBetween(s.id, t, t + 0.25)) {
          if (e.kind !== 'shot' && e.kind !== 'suppressive') continue;
          expect([...view.friendlies, ...view.contacts].some((x) => x.id === e.from), `${s.id}: shooter ${e.from} at ${t}`).toBe(true);
        }
      }
    }
  });
});

/** The second a radio line goes out in a scenario, found by walking the timeline in small steps. */
function secondOf(id: ScenarioId, text: string): number {
  for (let t = 0; t < length(id); t += 0.1) if (eventsBetween(id, t, t + 0.1).some((e) => e.kind === 'radio' && e.text === text)) return t + 0.1;
  throw new Error(`${text} never goes out in ${id}`);
}

function impactTimes(id: ScenarioId): number[] {
  const out: number[] = [];
  for (let t = 0; t < length(id); t += 0.05) for (const e of eventsBetween(id, t, t + 0.05)) if (e.kind === 'impact') out.push(t + 0.05);
  return out;
}
