import { describe, expect, it } from 'vitest';
import { insidePolygon } from '../../sim/geometry';
import { DEFAULT_TUNE } from '../../sim/tune';
import type { SimEvent } from '../../sim/types';
import { CHAPTERS, eventsBetween, GUNSHIP_LOOP_M, GUNSHIP_STATION_S, LENGTH, viewAt } from './commander-review-timeline';

const chapter = (title: string) => CHAPTERS.find((c) => c.title === title)!.at + 1;
const OLD = chapter('Ferry') - 1; // #131: the chapters before it end here (the Parachute chapter's end was the timeline's)

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

  it('keeps every Soldier inside the Kaltenbach Play Area (#110: but a jet\'s pilot, who flies out of it)', () => {
    for (let t = 0; t <= LENGTH; t += 1) {
      const view = viewAt(t);
      const flying = (s: { vehicle?: number }) => view.vehicles!.some((v) => v.id === s.vehicle && v.kind === 'jet');
      for (const s of [...view.friendlies.filter((f) => !flying(f)), ...view.contacts]) expect(insidePolygon(PLAY_AREA, s.x, s.y), `${s.id} at ${t}`).toBe(true);
    }
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
    expect(heli(viewAt(t + 0.5)).seats).toEqual([12, 11, -1, 13, 14, 15]); // #129: Delta's pilot and Charlie's 11 on the left gun, the right gun unmanned
    expect(delta(viewAt(t + 0.5)).every((f) => f.vehicle === pad.id)).toBe(true);
    expect(viewAt(t + 0.5).friendlies.find((f) => f.id === 11)).toMatchObject({ squad: 2, vehicle: pad.id });
    const flights = [...Array((OLD - t) * 4).keys()].map((k) => viewAt(t + k / 4));
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
    expect(heli(flights[again]!).seats).toEqual([12, 11, -1, -1, -1, -1]);
    for (const f of delta(flights[again]!).filter((f) => f.id !== 12)) expect(Math.hypot(f.x - D.x, f.y - D.y)).toBeGreaterThan(DEFAULT_TUNE.captureRadius); // still walking in
    for (const f of delta(viewAt(OLD - 1)).filter((f) => f.id !== 12)) expect(Math.hypot(f.x - D.x, f.y - D.y)).toBeLessThan(DEFAULT_TUNE.captureRadius);
    const back = flights.slice(again, flights.findIndex((v, i) => i > again && !heli(v).airborne)).map(heli);
    expect(Math.abs(bulge(back, lz, pad))).toBeGreaterThan(0.05 * Math.hypot(lz.x - pad.x, lz.y - pad.y)); // a dogleg home ...
    expect(Math.sign(bulge(back, lz, pad))).not.toBe(Math.sign(bulge(out, lz, pad))); // ... on the other side
    const home = heli(viewAt(OLD - 1));
    expect(home).toMatchObject({ x: pad.x, y: pad.y, seats: [12, 11, -1, -1, -1, -1] });
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
    expect(viewAt(OLD - 1).vehicles!.filter((x) => x.kind === 'helicopter' && x.wreck)).toHaveLength(1);
    expect(viewAt(OLD - 1).squads.find((q) => q.id === 3)!.name).toBe('Delta');
  });

  it('#129 Helicopter: the left gunner fires at the Lookout from the helicopter\'s left side, never the nose, only inside its 120 degree arc and 160 m', () => {
    const from = chapter('Helicopter');
    const shots = eventsBetween(from - 1, OLD).filter((e) => e.kind === 'shot' && e.from === 11) as { from: number; to: number; tick?: number }[];
    expect(shots.length).toBeGreaterThan(5);
    let n = 0;
    for (let t = from; t < OLD; t += 0.1) {
      const fired = eventsBetween(t - 0.05, t + 0.05).some((e) => e.kind === 'shot' && e.from === 11);
      if (!fired) continue;
      n++;
      const v = viewAt(t);
      const h = v.vehicles!.find((x) => x.kind === 'helicopter' && x.side === 'nato')!;
      const g = v.friendlies.find((f) => f.id === 11)!;
      const look = v.contacts.find((c) => c.id === 23)!;
      expect((g.x - h.x) * -h.fy + (g.y - h.y) * h.fx).toBeCloseTo(2, 1); // 2 m out to the left, none along the nose
      expect((g.x - h.x) * h.fx + (g.y - h.y) * h.fy).toBeCloseTo(0, 1);
      const d = Math.hypot(look.x - h.x, look.y - h.y);
      expect(d).toBeLessThanOrEqual(DEFAULT_TUNE.mgRangeM + 1);
      expect((look.x - h.x) * -h.fy + (look.y - h.y) * h.fx).toBeGreaterThanOrEqual(0.5 * d - 1); // within 60 degrees of the beam
    }
    expect(n).toBeGreaterThan(3);
    expect(new Set(viewAt(from + 20).friendlies.filter((f) => f.vehicle !== undefined && f.vehicle === 35).map((f) => f.squad)).size).toBeGreaterThan(1);
  });

  it('#130 Parachute: Bravo\'s riders jump from a crippled helicopter, come down over chuteSeconds on a chevron that grows from 0.7 to 1 and land on their own spots; the pilot stays', () => {
    const t = chapter('Parachute') - 1;
    const bravo = (v: ReturnType<typeof viewAt>, id: number) => v.friendlies.find((f) => f.id === id)!;
    const heli = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.id === 37)!;
    expect(heli(viewAt(t + 1)).hp).toBeLessThan(1 / 3 + 0.05);
    expect(heli(viewAt(t + 1)).seats).toEqual([4, 5, 6, 7]);
    const frames = [...Array((OLD - t) * 4).keys()].map((k) => viewAt(t + k / 4));
    const down = frames.filter((v) => bravo(v, 5).chute !== undefined);
    expect(down.length / 4).toBeCloseTo(DEFAULT_TUNE.chuteSeconds, 0);
    expect(frames.some((v) => heli(v).seats![1] === -1 && bravo(v, 5).chute === undefined && bravo(v, 5).vehicle === undefined)).toBe(true);
    expect(bravo(viewAt(OLD - 1), 4).vehicle).toBe(37);
    expect(bravo(viewAt(OLD - 1), 5).vehicle).toBeUndefined();
    const sizes = down.map((v) => 0.7 + 0.3 * bravo(v, 5).chute!);
    expect(sizes[0]).toBeGreaterThanOrEqual(0.7);
    expect(sizes.at(-1)).toBeLessThanOrEqual(1);
    expect(sizes.at(-1)).toBeGreaterThan(0.95);
    for (const [a, b] of [[5, 6], [6, 7]] as const) expect(Math.hypot(bravo(viewAt(OLD - 1), a).x - bravo(viewAt(OLD - 1), b).x, bravo(viewAt(OLD - 1), a).y - bravo(viewAt(OLD - 1), b).y)).toBeGreaterThan(1);
    for (const v of down) expect(eventsBetween(v.seconds - 0.25, v.seconds).some((e) => e.kind === 'shot' && e.from >= 5 && e.from <= 7)).toBe(false);
  });

  // #131: the helicopter's jobs, one helicopter (35) through four chapters
  const at4 = (from: number, to: number) => [...Array(Math.round((to - from) * 4)).keys()].map((k) => viewAt(from + k / 4));
  const heli = (v: ReturnType<typeof viewAt>) => v.vehicles!.find((x) => x.id === 35 && !x.wreck);
  const PAD = { x: -409.01, y: 0.3 };
  const B = { x: 0, y: 300 };
  const C = { x: 0, y: 0 };
  const hypot = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  /** The point is on the helicopter's left: its left gun faces it. */
  const leftOf = (h: { x: number; y: number; fx: number; fy: number }, p: { x: number; y: number }) => (p.x - h.x) * -h.fy + (p.y - h.y) * h.fx > 0;
  /** The frames in which the helicopter flies on the circle of radius orbitM about `c`. */
  const ring = (frames: ReturnType<typeof viewAt>[], c: { x: number; y: number }) => frames.filter((v) => heli(v)?.airborne && Math.abs(hypot(heli(v)!, c) - DEFAULT_TUNE.orbitM) < 3);
  const shots = (frames: ReturnType<typeof viewAt>[], to: number[]) => eventsBetween(frames[0]!.seconds - 0.25, frames.at(-1)!.seconds).filter((e) => e.kind === 'shot' && e.from === 11 && to.includes(e.to)).length;

  it('#131 Ferry: Echo, far from the HQ, is fetched: the helicopter lands by it, it boards, circles the hot point at orbitM with the left gun firing, the riders jump over the Landing Zone and it flies home', () => {
    const t0 = chapter('Ferry') - 1;
    const frames = at4(t0, chapter('Support') - 1);
    const echo = (v: ReturnType<typeof viewAt>) => v.friendlies.filter((f) => f.squad === 4);
    expect(echo(frames[0]!)).toHaveLength(4);
    expect(hypot(echo(frames[0]!)[0]!, PAD)).toBeGreaterThan(200); // far from the HQ
    const boarded = frames.findIndex((v) => echo(v).every((f) => f.vehicle === 35));
    expect(boarded).toBeGreaterThan(0);
    const down = frames[boarded - 1]!;
    expect(heli(down)!.airborne).toBeUndefined();
    expect(hypot(heli(down)!, echo(frames[0]!)[0]!)).toBeGreaterThan(DEFAULT_TUNE.lzM[0]); // lands by Echo, as a Landing Zone does ...
    expect(hypot(heli(down)!, echo(frames[0]!)[0]!)).toBeLessThan(DEFAULT_TUNE.lzM[1]);
    expect(heli(frames[boarded]!)!.seats!.filter((id) => id >= 0)).toEqual(expect.arrayContaining([12, 11, 16, 17, 18, 19])); // pilot, left gun, Echo
    const orbit = ring(frames, B);
    expect(orbit.length / 4).toBeGreaterThan(DEFAULT_TUNE.orbitSeconds - 2);
    expect(orbit.length / 4).toBeLessThan(DEFAULT_TUNE.orbitSeconds + 3);
    for (const v of orbit.slice(4, -4)) expect(leftOf(heli(v)!, B)).toBe(true); // all the way round, but the second it leaves the circle for its Landing Zone
    expect(shots(orbit, [24, 25])).toBeGreaterThan(8);
    const jumped = frames.filter((v) => echo(v).some((f) => f.chute !== undefined));
    expect(jumped.length / 4).toBeCloseTo(DEFAULT_TUNE.chuteSeconds, 0);
    expect(heli(jumped[0]!)!.airborne).toBe(true);
    expect(hypot(echo(jumped[0]!)[0]!, heli(jumped[0]!)!)).toBeLessThan(5); // over the Landing Zone
    expect(jumped.at(-1)!.friendlies.find((f) => f.id === 16)!.chute!).toBeGreaterThan(0.9);
    expect(heli(frames.at(-1)!)).toMatchObject({ x: PAD.x, y: PAD.y });
    expect(heli(frames.at(-1)!)!.airborne).toBeUndefined();
    expect(heli(frames.at(-1)!)!.seats).toEqual([12, 11, -1, -1, -1, -1]);
  });

  it('#131 Support: it lifts off again, flies to C and circles it at orbitM, its left gun firing at the Contacts there', () => {
    const frames = at4(chapter('Support') - 1, chapter('Repair') + 3);
    const orbit = ring(frames, C);
    expect(orbit.length / 4).toBeGreaterThan(15);
    for (const v of orbit) expect(leftOf(heli(v)!, C)).toBe(true);
    expect(shots(orbit, [20, 21, 22])).toBeGreaterThan(8);
  });

  it('#131 Repair: under half its hit points it leaves the circle for the pad, lands, and regains heliRepairHpPerS until full', () => {
    const frames = at4(chapter('Repair') - 1, chapter('Bail') - 1);
    expect(heli(frames[0]!)!.hp).toBe(1);
    const low = frames.findIndex((v) => heli(v)!.hp! < DEFAULT_TUNE.heliRepairBelow);
    expect(low).toBeGreaterThan(0);
    const landed = frames.findIndex((v, i) => i > low && !heli(v)!.airborne);
    expect(hypot(heli(frames[landed]!)!, PAD)).toBeLessThan(1);
    const hp = (secs: number) => heli(frames[landed + secs * 4]!)!.hp!;
    expect(((hp(7) - hp(2)) * DEFAULT_TUNE.heliHp) / 5).toBeCloseTo(DEFAULT_TUNE.heliRepairHpPerS, 1);
    expect(heli(frames.at(-1)!)!.hp).toBe(1);
  });

  it('#131 Bail: under a third of its hit points the pilot and gunner jump, it glides crashSeconds and crashes: a Wreck, nobody hurt', () => {
    const frames = at4(chapter('Bail') - 1, LENGTH);
    const hit = frames.findIndex((v) => heli(v)!.hp! < 1 / 3);
    expect(hit).toBeGreaterThan(0);
    const out = frames.findIndex((v) => v.friendlies.find((f) => f.id === 12)!.chute !== undefined);
    expect(out).toBeGreaterThanOrEqual(hit);
    for (const id of [11, 12]) expect(frames[out]!.friendlies.find((f) => f.id === id)!.vehicle).toBeUndefined();
    expect(heli(frames[out]!)!.seats!.every((id) => id < 0)).toBe(true);
    const crash = frames.findIndex((v) => !heli(v));
    expect((crash - out) / 4).toBeCloseTo(DEFAULT_TUNE.crashSeconds, 0);
    expect(heli(frames[crash - 1]!)!.airborne).toBe(true); // it glided on, in the air
    const last = frames.at(-1)!;
    const wreck = last.vehicles!.find((x) => x.wreck && x.side === 'nato' && x.kind === 'helicopter')!;
    expect(hypot(wreck, heli(frames[crash - 1]!)!)).toBeLessThan(DEFAULT_TUNE.orbitMps); // where it came down
    for (const id of [11, 12]) expect(last.friendlies.find((f) => f.id === id)!.state).toBe('alive');
    expect(last.friendlies.find((f) => f.id === 12)!.chute).toBeUndefined(); // landed
  });

  it('#131 the helicopter stays inside the Play Area through all four job chapters, and waits on its pad before Support and Bail (Repair begins over the circle)', () => {
    for (const v of at4(chapter('Ferry') - 1, LENGTH)) for (const x of v.vehicles!.filter((o) => o.kind === 'helicopter')) expect(insidePolygon(PLAY_AREA, x.x, x.y), `${x.id} at ${v.seconds}`).toBe(true);
    for (const title of ['Support', 'Bail']) expect(heli(viewAt(chapter(title) - 1)), title).toMatchObject({ x: PAD.x, y: PAD.y }); // each starts from the pad, the one before is over
  });

  const gunship = (v: ReturnType<typeof viewAt>, side: 'nato' | 'pact') => v.effects!.find((e) => e.asset === 'gunship' && e.side === side);

  it('#101 Gunship: nato\'s circles its route round C counter-clockwise, banked on station, shelling the Contacts; the ring counts its station down, then it flies home', () => {
    const from = chapter('Gunship') - 1;
    const frames = Array.from({ length: (chapter('Gunship down') - from) * 4 }, (_, i) => viewAt(from + i / 4));
    const phases = [...new Set(frames.map((v) => gunship(v, 'nato')?.phase).filter(Boolean))];
    expect(phases).toEqual(['inbound', 'station', 'leaving']);
    const station = frames.filter((v) => gunship(v, 'nato')?.phase === 'station');
    expect(station.length / 4).toBeCloseTo(GUNSHIP_STATION_S, 0);
    for (const v of station) {
      const e = gunship(v, 'nato')!;
      expect(e).toMatchObject({ x: 0, y: 0, radius: DEFAULT_TUNE.gunshipFocusM }); // C
      expect(Math.hypot(e.craft!.x - e.x, e.craft!.y - e.y)).toBeCloseTo(GUNSHIP_LOOP_M, 3);
      expect((e.craft!.x - e.x) * e.craft!.fy - (e.craft!.y - e.y) * e.craft!.fx).toBeGreaterThan(0); // the centre on its left
      expect(e.left).toBeGreaterThan(0);
      expect(v.vehicles).toContainEqual(expect.objectContaining({ kind: 'gunship', side: 'nato', x: e.craft!.x, y: e.craft!.y, airborne: true }));
    }
    expect(station.some((v) => gunship(v, 'nato')!.shells!.length)).toBe(true);
    const events = eventsBetween(from, chapter('Gunship down'));
    const shells = events.filter((e) => e.kind === 'impact' && e.asset === 'gunship');
    expect(shells.length).toBeGreaterThanOrEqual(10); // about 11 over 45 s
    for (const text of ['Gunship on station', 'Splash', 'Gunship leaving']) expect(events).toContainEqual(expect.objectContaining({ kind: 'radio', text }));
    expect(viewAt(chapter('Gunship') + 10).assets!.find((a) => a.asset === 'gunship')!.readyIn).toBeGreaterThan(0);
  });

  it('#101 Gunship: Bravo\'s 6 rides in its gun seat firing bursts and bails out as it leaves; Bravo\'s 7 jumps where the route passes nearest B', () => {
    const from = chapter('Gunship') - 1;
    const frames = Array.from({ length: (chapter('Gunship down') - from) * 4 }, (_, i) => viewAt(from + i / 4));
    const man = (v: ReturnType<typeof viewAt>, id: number) => v.friendlies.find((f) => f.id === id)!;
    const aboard = (id: number) => frames.filter((v) => man(v, id).vehicle !== undefined);
    expect(aboard(6).length).toBeGreaterThan(0);
    expect(aboard(7).length).toBeGreaterThan(0);
    expect(aboard(7).length).toBeLessThan(aboard(6).length);
    const chute7 = frames.find((v) => man(v, 7).chute !== undefined)!;
    expect(Math.hypot(man(chute7, 7).x - 0, man(chute7, 7).y - 300)).toBeLessThan(300 - GUNSHIP_LOOP_M + 20); // near the circle's nearest to B, 100 m short of it
    const leave = frames.findIndex((v) => gunship(v, 'nato')?.phase === 'leaving');
    expect(man(frames[leave]!, 6).chute).toBeDefined();
    const shots = eventsBetween(from, chapter('Gunship down')).filter((e) => e.kind === 'shot' && e.from === 6);
    expect(shots.length).toBeGreaterThan(8); // bursts
    expect(frames.some((v) => v.squads.some((q) => q.id === 1) && man(v, 6).vehicle === 44)).toBe(true);
  });

  it('#101 Gunship down: pact\'s comes in from the east; the AA fires bursts at it with its turret on it; it leaves early and falls as a Wreck, its last shell still landing', () => {
    const from = chapter('Gunship down') - 1;
    const events = eventsBetween(from, LENGTH);
    const fire = events.filter((e): e is Extract<SimEvent, { kind: 'shot' }> => e.kind === 'shot' && e.to === 45);
    expect(fire.length).toBeGreaterThan(40);
    expect(fire.every((e) => e.side === 'nato' && e.from === 2)).toBe(true);
    const mid = viewAt(chapter('Gunship down') + 8);
    const g = gunship(mid, 'pact')!;
    const aa = mid.vehicles!.find((v) => v.kind === 'aa')!;
    expect(mid.vehicles).toContainEqual(expect.objectContaining({ id: 45, kind: 'gunship', side: 'pact', airborne: true })); // the sky rule
    expect(Math.hypot(g.craft!.x - aa.x, g.craft!.y - aa.y)).toBeLessThanOrEqual(DEFAULT_TUNE.aaRangeM);
    expect(aa.tx * (g.craft!.x - aa.x) + aa.ty * (g.craft!.y - aa.y)).toBeCloseTo(Math.hypot(g.craft!.x - aa.x, g.craft!.y - aa.y), 6); // laid on it
    const phases = [...new Set(Array.from({ length: 160 }, (_, i) => gunship(viewAt(from + i / 4), 'pact')?.phase ?? null))];
    expect(phases).toEqual(['inbound', 'station', 'leaving', null]);
    const last = viewAt(LENGTH);
    expect(last.vehicles).toContainEqual(expect.objectContaining({ kind: 'gunship', side: 'pact', wreck: true }));
    expect(last.vehicles!.some((v) => v.id === 45)).toBe(false);
    expect(events.some((e) => e.kind === 'impact' && e.asset === 'gunship' && e.side === 'pact')).toBe(true);
  });

  it('#136 Mark: three Marks, one fading through the chapter by A, one called clear, one taking Alpha\'s suppressive fire', () => {
    const from = chapter('Mark') - 1;
    expect(viewAt(from - 1).marks).toEqual([]);
    const mid = viewAt(from + 10);
    expect(mid.marks!.map((k) => k.id)).toEqual([1, 2, 3]);
    const a = mid.points.find((p) => p.id === 'A')!;
    const byA = mid.marks![0]!;
    expect(a.owner).toBe('nato');
    expect(Math.hypot(byA.x - a.x, byA.y - a.y)).toBeLessThan(a.radius + DEFAULT_TUNE.threatenedM); // A counts as threatened
    const fades = [5, 20, 35].map((dt) => viewAt(from + dt).marks![0]!.fade);
    expect(fades[0]).toBeGreaterThan(fades[1]!);
    expect(fades[1]).toBeGreaterThan(fades[2]!);
    expect(fades[2]).toBeGreaterThan(0);
    expect(viewAt(from + 20).marks!.map((k) => k.id)).toEqual([1, 3]); // 2 was checked
    const events = eventsBetween(from, LENGTH);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'radio', type: 'clear', squad: 0, grid: 'F6' }));
    const aim = mid.marks![2]!;
    const fire = events.filter((e): e is Extract<SimEvent, { kind: 'suppressive' }> => e.kind === 'suppressive' && e.side === 'nato' && Math.hypot(e.x - aim.x, e.y - aim.y) < 6);
    expect(fire.length).toBeGreaterThan(10);
  });
});

describe('#138 line-shaped Assets', () => {
  const fx = (t: number, asset: 'smoke' | 'creep') => viewAt(t).effects!.find((e) => e.asset === asset);

  it('Smoke Screen: the strip and four shells half a second apart, then four discs that bloom, hold and thin out', () => {
    const call = chapter('Smoke Screen') + 1;
    expect(fx(call - 0.5, 'smoke')).toBeUndefined();
    expect(fx(call + 1, 'smoke')).toMatchObject({ side: 'nato', x: -40, y: -12, line: { to: { x: -40, y: 48 }, width: 15 }, impactIn: 5, shells: [], smoke: [] });
    expect(fx(call + 5.9, 'smoke')!.shells).toHaveLength(4);
    expect(fx(call + 6.6, 'smoke')!.smoke!.map((d) => d.y)).toEqual([-4.5, 10.5]); // two down, two in the air
    expect(fx(call + 6.6, 'smoke')!.shells).toHaveLength(2);
    expect(fx(call + 20, 'smoke')!.smoke!.map((d) => [d.r, d.density])).toEqual([[7.5, 1], [7.5, 1], [7.5, 1], [7.5, 1]]);
    expect(fx(call + 56, 'smoke')!.smoke![0]).toMatchObject({ r: 3.75, density: 0.5 });
    expect(fx(call + 63, 'smoke')).toBeUndefined();
    expect(viewAt(call - 1).assets!.find((a) => a.asset === 'smoke')).toMatchObject({ readyIn: 0, line: { length: 60, width: 15 } }); // armed here, two taps place the strip
  });

  it('Creeping Barrage: twelve impacts march the line, 1.5 s and 10 m apart, from 10 s after the call', () => {
    const call = chapter('Creeping Barrage') + 1;
    const hits = eventsBetween(call, LENGTH).filter((e) => e.kind === 'impact' && e.asset === 'creep') as { x: number; y: number }[];
    expect(hits.map((h) => h.y)).toEqual([62, 52, 42, 32, 22, 12, 2, -8, -18, -28, -38, -48]);
    for (const h of hits) expect(Math.abs(h.x + 16)).toBeLessThanOrEqual(4);
    expect(eventsBetween(call + 9.9, call + 10.1).filter((e) => e.kind === 'impact')).toHaveLength(1);
    expect(eventsBetween(call + 26.4, call + 26.6).filter((e) => e.kind === 'impact')).toHaveLength(1);
    expect(fx(call + 8, 'creep')).toMatchObject({ impactIn: 2, line: { to: { x: -16, y: -58 }, width: 36 }, shells: [{ flight: 0.5 }, { flight: 0.125 }] });
    expect(fx(call + 29, 'creep')).toBeUndefined();
  });
});

describe('#139 Drone Strike and Recon Plane chapters', () => {
  const fx = (t: number, asset: 'drone' | 'recon', side = 'nato') => viewAt(t).effects!.find((e) => e.asset === asset && e.side === side);

  it('Drone Strike: nato\'s leaves the HQ, flies straight at the Contacts at 30 m/s and lands one impact; its row is off while it flies', () => {
    const call = chapter('Drone Strike');
    expect(fx(call + 1, 'drone')).toMatchObject({ from: { x: -415, y: 0 }, x: -16, y: 28, radius: 15 });
    const [a, b] = [fx(call + 2, 'drone')!.craft!, fx(call + 4, 'drone')!.craft!];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(60);
    expect(viewAt(call + 2).assets!.find((r) => r.asset === 'drone')).toMatchObject({ off: 'in the air' });
    const hits = eventsBetween(call, LENGTH).filter((e) => e.kind === 'impact' && e.asset === 'drone');
    expect(hits).toEqual([{ kind: 'impact', side: 'nato', x: -16, y: 28, asset: 'drone' }]);
    const landed = call + 400 / 30;
    expect(fx(landed + 0.5, 'drone')!.craft).toBeUndefined();
    expect(fx(landed + 2.5, 'drone')).toBeUndefined();
  });

  it('Drone lost: the Pact\'s comes the other way and falls 2.5 s inside the AA\'s range, short of Alpha, where it was hit', () => {
    const call = chapter('Drone lost');
    const flying = fx(call + 3, 'drone', 'pact')!;
    expect(flying.lost).toBeUndefined();
    expect(flying.craft!.fx).toBeLessThan(0);
    const down = [9, 10].map((s) => fx(call + s, 'drone', 'pact')!);
    expect(down[0]).toMatchObject({ lost: true });
    expect(down[0]!.craft).toEqual(down[1]!.craft);
    expect(Math.hypot(down[0]!.craft!.x + 60, down[0]!.craft!.y - 48)).toBeGreaterThan(200); // from the AA
    expect(Math.hypot(down[0]!.craft!.x + 60, down[0]!.craft!.y - 48)).toBeLessThan(300);
    expect(down[1]!.left).toBeLessThan(down[0]!.left);
    expect(fx(call + 12, 'drone', 'pact')).toBeUndefined();
  });

  it('Recon Plane: one pass north through the Contacts at 100 m/s, with its strip 120 m wide', () => {
    const call = chapter('Recon Plane');
    expect(fx(call + 1, 'recon')).toMatchObject({ line: { to: { x: 20, y: 560 }, width: 120 }, craft: { x: 20, y: -460, fx: 0, fy: 1 } });
    expect(fx(call + 6, 'recon')!.craft!.y).toBeCloseTo(40);
    expect(fx(call + 12, 'recon')).toBeUndefined();
  });
});
