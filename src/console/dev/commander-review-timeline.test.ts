import { describe, expect, it } from 'vitest';
import { insidePolygon } from '../../sim/geometry';
import type { SimEvent } from '../../sim/types';
import { CHAPTERS, eventsBetween, LENGTH, viewAt } from './commander-review-timeline';

const chapter = (title: string) => CHAPTERS.find((c) => c.title === title)!.at + 1;

// Kaltenbach play area (simplified bounding octagon; the real polygon is tighter).
const PLAY_AREA = [
  { x: 456, y: -12 },
  { x: 460, y: 200 },
  { x: 330, y: 432 },
  { x: -330, y: 332 },
  { x: -456, y: 12 },
  { x: -460, y: -200 },
  { x: -330, y: -432 },
  { x: 330, y: -332 },
];

describe('commander review timeline (#69)', () => {
  it('Overlap: two friendly Squads close enough that their members interleave', () => {
    const view = viewAt(chapter('Overlap'));
    const [a, b] = view.squads;
    const of = (id: number) => view.friendlies.filter((f) => f.squad === id);
    // interleaved: sorted by x, the two Squads alternate at least once in the middle
    const byX = [...of(a!.id), ...of(b!.id)].sort((p, q) => p.x - q.x).map((f) => f.squad);
    const swaps = byX.filter((s, i) => i > 0 && s !== byX[i - 1]).length;
    expect(swaps).toBeGreaterThanOrEqual(2);
    expect(a!.leader).toBe(of(a!.id)[0]!.id);
  });

  it('Firing: friendly Soldiers and visible Contacts fire, with shot and suppressive Events', () => {
    const t = chapter('Firing');
    const events = eventsBetween(t, t + 5);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('shot');
    expect(kinds).toContain('suppressive');
    const fire = events.filter((e): e is Extract<SimEvent, { kind: 'shot' | 'suppressive' }> => e.kind === 'shot' || e.kind === 'suppressive');
    for (const side of ['nato', 'pact'] as const) for (const kind of ['shot', 'suppressive'] as const) expect(fire.some((e) => e.side === side && e.kind === kind), `${side} ${kind}`).toBe(true);
  });

  const squad = (view: ReturnType<typeof viewAt>, name: string) => view.squads.find((q) => q.name === name)!;
  const friendly = (view: ReturnType<typeof viewAt>, id: number) => view.friendlies.find((f) => f.id === id);

  it('Wounded leader: a Wounded Squad Leader keeps the tag', () => {
    const view = viewAt(chapter('Wounded leader'));
    const q = squad(view, 'Alpha');
    expect(friendly(view, q.leader!)?.state).toBe('wounded');
    expect(q.strength).toBe(q.size - 1);
    expect(eventsBetween(chapter('Wounded leader') - 1.5, chapter('Wounded leader'))).toContainEqual(expect.objectContaining({ kind: 'wounded', side: 'nato', id: q.leader }));
  });

  it('Leader down: the dead leader leaves the Squad without one; their Squad Respawn brings them back as leader', () => {
    const before = squad(viewAt(chapter('Leader down') - 2), 'Alpha');
    const view = viewAt(chapter('Leader down'));
    const q = squad(view, 'Alpha');
    expect(friendly(view, before.leader!)).toBeUndefined();
    expect(q.leader).toBeNull();
    expect(q.respawnIn).toHaveLength(1);
    expect(view.friendlies.filter((f) => f.squad === q.id).length).toBe(q.size - 1);
    expect(eventsBetween(chapter('Leader down') - 1.5, chapter('Leader down'))).toContainEqual(expect.objectContaining({ kind: 'death', side: 'nato', id: before.leader }));
    const later = viewAt(chapter('Leader down') + 10);
    expect(friendly(later, before.leader!)?.state).toBe('alive');
    expect(squad(later, 'Alpha').leader).toBe(before.leader);
    expect(eventsBetween(chapter('Leader down'), chapter('Leader down') + 10)).toContainEqual(expect.objectContaining({ kind: 'respawn', side: 'nato', id: before.leader }));
  });

  it('Wipe and Redeploy: a wiped Squad counts down with no friendlies and no leader, then Redeploys at the HQ with roster member 0 leading', () => {
    const view = viewAt(chapter('Wipe'));
    const q = squad(view, 'Bravo');
    expect(q.redeployIn).toBeGreaterThan(0);
    expect(q.leader).toBeNull();
    expect(q.respawnIn).toEqual([]);
    expect(view.friendlies.filter((f) => f.squad === q.id)).toEqual([]);
    expect(eventsBetween(chapter('Wipe') - 1.5, chapter('Wipe')).filter((e) => e.kind === 'death')).toHaveLength(q.size);
    const back = viewAt(chapter('Redeploy'));
    const r = squad(back, 'Bravo');
    const men = back.friendlies.filter((f) => f.squad === r.id);
    expect(r.redeployIn).toBeNull();
    expect(men).toHaveLength(r.size);
    expect(r.leader).toBe(Math.min(...men.map((m) => m.id)));
    for (const m of men) expect(Math.hypot(m.x + 415, m.y)).toBeLessThan(35);
    expect(eventsBetween(chapter('Redeploy') - 1.5, chapter('Redeploy'))).toContainEqual(expect.objectContaining({ kind: 'redeploy', side: 'nato', squad: r.id }));
  });

  it('viewAt is a pure function of time', () => {
    const a = viewAt(23.4);
    viewAt(60);
    eventsBetween(0, LENGTH);
    expect(viewAt(23.4)).toEqual(a);
    expect(eventsBetween(10, 11)).toEqual(eventsBetween(10, 11));
    expect(eventsBetween(10, 10)).toEqual([]);
  });

  it('keeps every Soldier inside the Kaltenbach Play Area', () => {
    for (let t = 0; t <= LENGTH; t += 1)
      for (const s of [...viewAt(t).friendlies, ...viewAt(t).contacts]) expect(insidePolygon(PLAY_AREA, s.x, s.y), `${s.id} at ${t}`).toBe(true);
  });

  it('every shooter is in the view when it fires, so the Console can place the tracer', () => {
    for (let t = 0; t < LENGTH; t += 0.25) {
      const view = viewAt(t + 0.25);
      for (const e of eventsBetween(t, t + 0.25)) {
        if (e.kind !== 'shot' && e.kind !== 'suppressive') continue;
        const shooter = [...view.friendlies, ...view.contacts].find((s) => s.id === e.from);
        expect(shooter, `shooter ${e.from} at ${t}`).toBeDefined();
      }
    }
  });

  it('#107 Tank: two of Charlie ride their tank (badged, no chevrons), it drives with its turret on an enemy tank in sight, fires its main gun, and a Wreck lies by the road', () => {
    const t = chapter('Tank');
    const early = viewAt(t);
    const late = viewAt(LENGTH - 1);
    const own = (v: typeof late) => v.vehicles!.find((x) => x.side === 'nato' && !x.wreck)!;
    expect(own(early).seats).toEqual([8, 9]);
    expect(early.friendlies.filter((f) => f.vehicle === own(early).id).map((f) => f.id)).toEqual([8, 9]);
    expect(own(late).x).not.toBe(own(early).x);
    const enemy = late.vehicles!.find((x) => x.side === 'pact')!;
    expect(Math.atan2(own(late).ty, own(late).tx)).toBeCloseTo(Math.atan2(enemy.y - own(late).y, enemy.x - own(late).x));
    expect(late.vehicles!.filter((x) => x.wreck)).toHaveLength(1);
    expect(eventsBetween(t, LENGTH).filter((e) => e.kind === 'impact' && e.asset === 'tank')).toHaveLength(2);
    for (const v of late.vehicles!) expect(insidePolygon(PLAY_AREA, v.x, v.y)).toBe(true);
  });
});
