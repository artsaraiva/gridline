import { describe, expect, it } from 'vitest';
import { insidePolygon } from '../../sim/geometry';
import { DEFAULT_TUNE } from '../../sim/tune';
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
    const late = viewAt(chapter('Helicopter')); // #130: the end of the timeline is now Bravo's parachute chapter
    const own = (v: typeof late) => v.vehicles!.find((x) => x.side === 'nato' && !x.wreck)!;
    expect(own(early).seats).toEqual([8, 9]);
    expect(early.friendlies.filter((f) => f.vehicle === own(early).id).map((f) => f.id)).toEqual([8, 9]);
    expect(own(late).x).not.toBe(own(early).x);
    const enemy = late.vehicles!.find((x) => x.side === 'pact')!;
    expect(Math.atan2(own(late).ty, own(late).tx)).toBeCloseTo(Math.atan2(enemy.y - own(late).y, enemy.x - own(late).x));
    expect(late.vehicles!.filter((x) => x.kind === 'tank' && x.wreck)).toHaveLength(1);
    expect(eventsBetween(t, LENGTH).filter((e) => e.kind === 'impact' && e.asset === 'tank')).toHaveLength(2);
    const shot = eventsBetween(t, LENGTH).find((e) => e.kind === 'impact')!;
    const before = CHAPTERS.find((c) => c.title === 'Tank')!.at + 11.6; // the first round in the air
    expect(viewAt(before).vehicles!.find((x) => x.side === 'nato' && x.seats?.[0] === 8)!.rounds![0]!.to).toMatchObject({ x: (shot as { x: number }).x });
    expect(late.vehicles!.filter((x) => x.kind === 'tank' && x.empty)).toHaveLength(1); // the abandoned tank, grey-white
    for (const v of late.vehicles!) expect(insidePolygon(PLAY_AREA, v.x, v.y)).toBe(true);
  });

  it('#108 Jeep: Bravo boards its parked jeep (badged, no chevrons), drives east while its gunner fires the MG, stops and gets out by it; a jeep Wreck and an enemy jeep in sight', () => {
    const t = chapter('Jeep');
    const jeep = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.kind === 'jeep' && x.side === 'nato' && !x.wreck)!;
    const bravo = (v: ReturnType<typeof viewAt>) => v.friendlies.filter((f) => f.squad === 1);
    expect(jeep(viewAt(t - 2)).empty).toBe(true);
    const riding = viewAt(t + 2);
    expect(jeep(riding).seats).toEqual([4, 5, 6, 7]);
    expect(bravo(riding).map((f) => f.vehicle)).toEqual([jeep(riding).id, jeep(riding).id, jeep(riding).id, jeep(riding).id]);
    expect(jeep(viewAt(t + 10)).x).toBeGreaterThan(jeep(riding).x + 100);
    const mg = eventsBetween(t, t + 14).filter((e) => e.kind === 'shot' && e.side === 'nato' && bravo(riding).some((f) => f.id === e.from));
    expect(mg.length).toBeGreaterThan(5);
    expect(new Set(mg.map((e) => (e as { from: number }).from))).toEqual(new Set([5])); // only the gunner fires from the jeep
    const late = viewAt(chapter('Helicopter')); // #130: the end of the timeline is now Bravo's parachute chapter
    expect(jeep(late).empty).toBe(true);
    for (const f of bravo(late)) {
      expect(f.vehicle).toBeUndefined();
      expect(Math.hypot(f.x - jeep(late).x, f.y - jeep(late).y)).toBeLessThan(15);
    }
    expect(late.vehicles!.filter((x) => x.kind === 'jeep' && x.wreck)).toHaveLength(1);
    expect(late.vehicles!.filter((x) => x.kind === 'jeep' && x.side === 'pact')).toHaveLength(1);
    for (const v of late.vehicles!) expect(insidePolygon(PLAY_AREA, v.x, v.y)).toBe(true);
  });

  it('#109 Helicopter: Delta boards the empty helicopter on the pad, it spools and lifts off, flies a dogleg to D, flares over its Landing Zone off the point, lands, they get out and walk in, and it flies home with its pilot by another dogleg; an enemy one shows only while Alpha sees it, then fades to a Last Known Position', () => {
    const t = chapter('Helicopter') - 1;
    const heli = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.kind === 'helicopter' && x.side === 'nato')!;
    const enemy = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.kind === 'helicopter' && x.side === 'pact' && !x.wreck);
    const delta = (v: ReturnType<typeof viewAt>) => v.friendlies.filter((f) => f.squad === 3);
    const pad = heli(viewAt(0));
    expect(pad).toMatchObject({ x: -409.01, y: 0.3, empty: true });
    expect(pad.airborne).toBeUndefined();
    expect(heli(viewAt(t + 0.5)).seats).toEqual([12, 13, 14, 15]);
    expect(delta(viewAt(t + 0.5)).every((f) => f.vehicle === pad.id)).toBe(true);
    const flights = [...Array((LENGTH - t) * 4).keys()].map((k) => viewAt(t + k / 4));
    const air = flights.map((v) => !!heli(v).airborne);
    const lift = air.indexOf(true);
    const land = air.indexOf(false, lift);
    const D = { x: 0, y: -300 };
    const lz = heli(flights[land]!);
    expect(Math.hypot(lz.x - D.x, lz.y - D.y)).toBeGreaterThan(DEFAULT_TUNE.lzM[0]); // #124: a Landing Zone off the point, within lzM
    expect(Math.hypot(lz.x - D.x, lz.y - D.y)).toBeLessThan(DEFAULT_TUNE.lzM[1]);
    const hover = flights.slice(0, land).filter((v) => heli(v).airborne && Math.hypot(heli(v).x - lz.x, heli(v).y - lz.y) < 0.01).length;
    expect(hover / 4).toBeCloseTo(DEFAULT_TUNE.flareSeconds, 0); // it hovers over it, still airborne, before it touches down
    expect(air.indexOf(true) - flights.findIndex((v) => heli(v).seats![0] === 12 && heli(v).seats![1] === 13)).toBeGreaterThanOrEqual((1 + DEFAULT_TUNE.spoolSeconds) * 4 - 1); // the rotor spools before lift-off
    const bulge = (track: { x: number; y: number }[], a: { x: number; y: number }, b: { x: number; y: number }) =>
      track.map((q) => ((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)).reduce((far, d) => (Math.abs(d) > Math.abs(far) ? d : far), 0);
    const again = air.indexOf(true, land);
    const out = flights.slice(lift, land).map(heli);
    expect(Math.abs(bulge(out, pad, lz))).toBeGreaterThan(0.05 * Math.hypot(lz.x - pad.x, lz.y - pad.y)); // a dogleg out
    expect((again - land) / 4).toBeCloseTo(3 + 1.5, 0); // unloadSeconds, then spoolSeconds
    expect(heli(flights[again]!).seats).toEqual([12, -1, -1, -1]);
    for (const f of delta(flights[again]!).filter((f) => f.id !== 12)) expect(Math.hypot(f.x - D.x, f.y - D.y)).toBeGreaterThan(DEFAULT_TUNE.captureRadius); // still walking in
    for (const f of delta(viewAt(LENGTH - 1)).filter((f) => f.id !== 12)) expect(Math.hypot(f.x - D.x, f.y - D.y)).toBeLessThan(DEFAULT_TUNE.captureRadius);
    const back = flights.slice(again, flights.findIndex((v, i) => i > again && !heli(v).airborne)).map(heli);
    expect(Math.abs(bulge(back, lz, pad))).toBeGreaterThan(0.05 * Math.hypot(lz.x - pad.x, lz.y - pad.y)); // a dogleg home ...
    expect(Math.sign(bulge(back, lz, pad))).not.toBe(Math.sign(bulge(out, lz, pad))); // ... on the other side
    const home = heli(viewAt(LENGTH - 1));
    expect(home).toMatchObject({ x: pad.x, y: pad.y, seats: [12, -1, -1, -1] });
    expect(home.airborne).toBeUndefined();
    // #119: the enemy one shows only while Alpha sees it (a Soldier sees a vehicle at visionM 150 x vehicleVisionMul 1.5),
    // from the moment it comes into that sight, in the air and on the ground; lost, a Last Known Position fades out
    const SIGHT = 225;
    const range = (v: ReturnType<typeof viewAt>, e: { x: number; y: number }) => Math.min(...v.friendlies.filter((f) => f.squad === 0).map((f) => Math.hypot(f.x - e.x, f.y - e.y)));
    const shown = flights.map((v) => enemy(v));
    const first = shown.findIndex((e) => e);
    const last = shown.length - 1 - [...shown].reverse().findIndex((e) => e);
    expect(first).toBeGreaterThan(lift);
    expect(shown.slice(first, last + 1).every((e) => e)).toBe(true);
    expect(shown.slice(first, last + 1).some((e) => e!.airborne)).toBe(true);
    expect(shown.slice(first, last + 1).some((e) => !e!.airborne)).toBe(true);
    shown.forEach((e, i) => e && expect(range(flights[i]!, e)).toBeLessThanOrEqual(SIGHT));
    expect(range(flights[first]!, shown[first]!)).toBeGreaterThan(SIGHT - 10); // it shows as it comes into sight (a frame's flight short of the edge), not later
    expect(range(flights[last]!, shown[last]!)).toBeGreaterThan(SIGHT - 10);
    expect(flights.slice(0, last + 1).every((v) => !v.lastKnown!.length)).toBe(true);
    const [lkp, ...more] = flights[last + 1]!.lastKnown!;
    expect(more).toEqual([]);
    expect(Math.hypot(lkp!.x - shown[last]!.x, lkp!.y - shown[last]!.y)).toBeLessThan(30 / 4); // within a frame's flight (heliMps)
    expect(range(flights[last + 1]!, lkp!)).toBeLessThanOrEqual(SIGHT);
    expect(lkp!.fade).toBeCloseTo(1, 1);
    expect(flights[last + 1 + 4 * 4]!.lastKnown).toEqual([]); // gone lkpSeconds (3.5) later
    expect(viewAt(LENGTH - 1).vehicles!.filter((x) => x.kind === 'helicopter' && x.wreck)).toHaveLength(1);
    expect(viewAt(LENGTH - 1).squads.find((q) => q.id === 3)!.name).toBe('Delta');
  });

  it('#130 Parachute: Bravo\'s riders jump from a crippled helicopter, come down over chuteSeconds on a chevron that grows from 0.7 to 1 and land on their own spots; the pilot stays', () => {
    const t = chapter('Parachute') - 1;
    const bravo = (v: ReturnType<typeof viewAt>, id: number) => v.friendlies.find((f) => f.id === id)!;
    const heli = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.id === 37)!;
    expect(heli(viewAt(t + 1)).hp).toBeLessThan(1 / 3 + 0.05);
    expect(heli(viewAt(t + 1)).seats).toEqual([4, 5, 6, 7]);
    const frames = [...Array((LENGTH - t) * 4).keys()].map((k) => viewAt(t + k / 4));
    const down = frames.filter((v) => bravo(v, 5).chute !== undefined);
    expect(down.length / 4).toBeCloseTo(DEFAULT_TUNE.chuteSeconds, 0);
    expect(frames.some((v) => heli(v).seats![1] === -1 && bravo(v, 5).chute === undefined && bravo(v, 5).vehicle === undefined)).toBe(true);
    expect(bravo(viewAt(LENGTH - 1), 4).vehicle).toBe(37);
    expect(bravo(viewAt(LENGTH - 1), 5).vehicle).toBeUndefined();
    const sizes = down.map((v) => 0.7 + 0.3 * bravo(v, 5).chute!);
    expect(sizes[0]).toBeGreaterThanOrEqual(0.7);
    expect(sizes.at(-1)).toBeLessThanOrEqual(1);
    expect(sizes.at(-1)).toBeGreaterThan(0.95);
    for (const [a, b] of [[5, 6], [6, 7]] as const) expect(Math.hypot(bravo(viewAt(LENGTH - 1), a).x - bravo(viewAt(LENGTH - 1), b).x, bravo(viewAt(LENGTH - 1), a).y - bravo(viewAt(LENGTH - 1), b).y)).toBeGreaterThan(1);
    for (const v of down) expect(eventsBetween(v.seconds - 0.25, v.seconds).some((e) => e.kind === 'shot' && e.from >= 5 && e.from <= 7)).toBe(false);
  });
});

