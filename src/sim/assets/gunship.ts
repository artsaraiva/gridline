// Gunship (#101): a heavy Strike that hunts for a while. Usable only while the caller holds every keystone Capture Point
// (the Cruise Missile's gate); the cooldown runs regardless, and losing one mid-sortie changes nothing. The call names its
// focus: the spot it works over. While it is flying in or on station another call moves the focus (no new cooldown, whatever
// the gate says), and it turns for the new one.
// At the call its Side's Gunship vehicle (vehicles/lent.ts) wakes at the missile's launch point, beyond the Play Area behind the
// caller's HQ, and flies level at `gunshipSpeedMps`, turning no faster than `gunshipTurnDegPerS`: wide arcs, never a sudden
// about-face. It flies in at the focus and is on station once that is within `gunshipRangeM`, for `gunshipStationSeconds`.
// There it flies as a jet's pilot would, slowly: at a mark drawn among the enemies on foot its Side knows (those within
// `gunshipFocusM` of the focus first, the more of them close together the likelier), over it, then at the next; with none known, over the focus.
// A mark too close inside its turn to reach is flown away from first, so it comes back round in a loop. Then it turns for home
// and flies back to the launch point, where it sleeps until the next call. On station the enemies on foot within
// `gunshipRangeM` of the ground under it are Contacts, and its cannon fires one shell every `gunshipShotSeconds` at the one
// nearest (none in range: no shot): it leaves the aircraft, flies `gunshipShellFlightSeconds` and lands a Barrage shell's blast
// within `gunshipScatterM` of where that enemy was. Soldiers coming back may take its gun seat or a passenger seat
// (vehicles/lent.ts `gunshipOnReturn`); each passenger jumps as it passes its goal (`paradrop`), and everyone aboard jumps as it
// turns for home (`homeward`). It is in the sky, so both Sides' views carry it; the enemy AA fires on it as on a helicopter: under
// a third of its hit points it leaves early, at 0 it falls as a Wreck where it was and fires no more (shells already in the air
// still land).
// Its path is stepped a tick at a time, turning by `turnToward`'s polynomial step (no trig).
import { dist2, inHq, launchPoint } from '../geometry';
import { known, markable } from '../vehicles/jet';
import { turnToward } from '../momentum';
import { pickWeighted, rnd } from '../rng';
import { ticksOf, vehicleOf, type Mix } from '../state';
import type { Match } from '../index';
import { enemyOf, type SimEvent, type Tune, type Vec2 } from '../types';
import { borrow, crippled, homeward, lost, paradrop, release, steer, type Vehicle } from '../vehicles';
import { shellBlast } from './barrage';
import { assetRadio, type Effect, type Kind } from './core';
import { heavyGate } from './missile';
import { blast } from './strike';

const PHASES = ['inbound', 'station', 'leaving', 'down'] as const;

/** The radius of its tightest turn. */
const turnM = (t: Tune) => (t.gunshipSpeedMps * 180) / (Math.PI * t.gunshipTurnDegPerS);
/** A spot it flew out from is clear of its turn this many turn radii from the turn's centre: on the rim itself it would circle the spot and never reach it. */
const CLEAR = 1.25;
/** Within this of a mark it is over it: the pass is flown, the next mark is drawn. */
const OVER_M = 25;

/** The caller's enemies on foot in reach of the aircraft `v`: alive, not under a parachute, outside their own HQ (the Scan UAV's rule: an HQ hides its own). */
function inRange(m: Match, e: Effect, v: Vehicle) {
  const r = m.tune.gunshipRangeM;
  return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && !s.chute && dist2(s, v) <= r * r && !inHq(m, s.side, s));
}

/** Turns for home: the radio says so, and everyone aboard jumps. */
function leave(m: Match, e: Effect, v: Vehicle, events: SimEvent[]) {
  Object.assign(e, { phase: 'leaving', phaseAt: m.tick });
  homeward(m, v);
  assetRadio(m, e, 'Gunship leaving', events);
}

/** Lands the shells due; the first says "Splash". */
function land(m: Match, e: Effect, events: SimEvent[]) {
  const t = m.tune;
  for (const s of e.shells!) {
    if (s.done || s.land > m.tick) continue;
    s.done = true;
    events.push({ kind: 'impact', side: e.side, x: s.x, y: s.y, asset: 'gunship' });
    if (!e.told) {
      e.told = true;
      assetRadio(m, e, 'Splash', events);
    }
    blast(m, e.side, s, shellBlast(t), 'gunship', events, { damage: (v) => (v.airborne ? 0 : t.shellVehicleDamage) });
  }
}

/** One shell at the enemy in range nearest the aircraft, if there is one, landing uniformly over a disc round where it is. */
function shoot(m: Match, e: Effect, v: Vehicle) {
  const t = m.tune;
  let prey: { x: number; y: number } | null = null;
  for (const s of inRange(m, e, v)) if (!prey || dist2(s, v) < dist2(prey, v)) prey = s;
  if (!prey) return;
  const R = t.gunshipScatterM;
  let dx: number;
  let dy: number;
  do {
    dx = (rnd(m) * 2 - 1) * R;
    dy = (rnd(m) * 2 - 1) * R;
  } while (dx * dx + dy * dy > R * R);
  e.shells!.push({ x: prey.x + dx, y: prey.y + dy, from: { x: v.x, y: v.y }, launch: m.tick, land: m.tick + ticksOf(t, t.gunshipShellFlightSeconds), done: false });
  e.nextShot = m.tick + ticksOf(t, t.gunshipShotSeconds);
}

/**
 * Where it flies now: its mark's last known spot, or the focus (`prey` -1). A mark it is over, or one its Side has lost, is
 * done, and so is a pass at the focus once it is over it or an enemy is known within `gunshipFocusM` of the focus. The next is
 * drawn among the known enemies on foot outside their HQ and not under it, each weighing as many as the known enemies within
 * `gunshipRangeM` of it: those round the focus when there are any; else all of them, the farther from the focus the less
 * likely, and the focus itself (as one enemy there).
 */
function aim(m: Match, e: Effect, v: Vehicle): Vec2 {
  const spots = known(m, e.side);
  const over = (p: Vec2) => dist2(p, v) <= OVER_M * OVER_M;
  const r2 = m.tune.gunshipRangeM * m.tune.gunshipRangeM;
  const foes = [...spots].filter(([id, p]) => m.soldiers[id] && markable(m, id) && !inHq(m, enemyOf(e.side), p));
  const ahead = foes.filter(([, p]) => !over(p));
  const focused = ahead.filter(([, p]) => dist2(p, e) <= m.tune.gunshipFocusM * m.tune.gunshipFocusM);
  const at = e.prey! < 0 ? (focused.length ? undefined : e) : markable(m, e.prey!) ? spots.get(e.prey!) : undefined;
  if (at && !over(at)) return at;
  const marks: [number, Vec2][] = focused.length ? focused : over(e) ? ahead : [...ahead, [-1, e]];
  // ponytail: every known enemy against every other, once a pass; a grid of counts if a 128 v 128 match ever shows it in `pnpm bench`
  const pick = marks.length > 1 ? Math.max(0, pickWeighted(m, marks.map(([id, p]) => (id < 0 ? 1 : foes.filter(([, q]) => dist2(p, q) <= r2).length) / (1 + dist2(p, e) / r2)))) : 0;
  e.prey = marks[pick]?.[0] ?? -1;
  return marks[pick]?.[1] ?? e;
}

/**
 * One tick ahead, turning toward `to` at `gunshipTurnDegPerS`. A spot inside the turn on its side is out of reach: it flies
 * straight on (`out`) until the spot is CLEAR of that turn, then comes round onto it.
 */
function fly(m: Match, e: Effect, v: Vehicle, to: Vec2) {
  const t = m.tune;
  const R = turnM(t);
  const [dx, dy] = [to.x - v.x, to.y - v.y];
  const d = Math.sqrt(dx * dx + dy * dy);
  const left = v.fx * dy - v.fy * dx >= 0 ? 1 : -1;
  const [cx, cy] = [-v.fy * left * R, v.fx * left * R]; // the centre of its tightest turn that way
  const gap = Math.sqrt((dx - cx) * (dx - cx) + (dy - cy) * (dy - cy)) / R; // from the turn's centre, in turn radii: under 1 is inside it
  e.out = gap < 1 || (e.out! && gap < CLEAR);
  const f = d === 0 || e.out ? { fx: v.fx, fy: v.fy } : turnToward(v.fx, v.fy, dx / d, dy / d, t.gunshipTurnDegPerS, t.hz);
  const cross = v.fx * f.fy - v.fy * f.fx;
  e.turn = Math.abs(cross) < t.gunshipTurnDegPerS / t.hz / 115 ? 0 : Math.sign(cross); // half a tick's turn (in radians) or more: banked that way
  const step = t.gunshipSpeedMps / t.hz;
  steer(m, v, { x: v.x + f.fx * step, y: v.y + f.fy * step }, f);
}

export const gunship: Kind = {
  name: 'Gunship',
  sky: true,
  cooldownSeconds: (t) => t.gunshipCooldownSeconds,
  firstReadySeconds: (t) => t.gunshipCooldownSeconds, // starts on cooldown, as the Cruise Missile does
  seconds: (t) => t.gunshipStationSeconds, // `until` is set at the call, and again as it ends
  radius: (t) => t.gunshipFocusM,
  gate: heavyGate,
  retask(m, side, at) {
    const e = m.assets.effects.find((o) => o.asset === 'gunship' && o.side === side && (o.phase === 'inbound' || o.phase === 'station'));
    if (e && at) Object.assign(e, { x: at.x, y: at.y, prey: -1 }); // it turns for the new focus at once
    return e;
  },

  start(m, e) {
    const t = m.tune;
    const from = launchPoint(m, e.side);
    const d = Math.sqrt(dist2(from, e));
    const v = borrow(m, e.side, 'gunship', from, { fx: (e.x - from.x) / d, fy: (e.y - from.y) / d }); // it waits at the launch point
    Object.assign(e, { from, vehicle: v.id, phase: 'inbound', phaseAt: m.tick, nextShot: m.tick, shells: [], prey: -1, turn: 0, out: false });
    // ponytail: a bound, not the exact end (in to the far side of the Play Area and home from there, a full turn each way and one to spare); reaching home ends it sooner
    const far = Math.sqrt(Math.max(...m.map.playArea.map((p) => dist2(p, from))));
    e.until = m.tick + ticksOf(t, (2 * far) / t.gunshipSpeedMps + 3 * (360 / t.gunshipTurnDegPerS) + t.gunshipStationSeconds);
  },

  work(m, e, events) {
    const t = m.tune;
    land(m, e, events);
    if (e.phase === 'down') return;
    const v = vehicleOf(m, e.vehicle!)!;
    if (lost(v)) { // shot down: vehicles/core.ts `hurt` left the Wreck and bailed its riders out
      Object.assign(e, { phase: 'down', phaseAt: m.tick, until: Math.max(m.tick, ...e.shells!.filter((s) => !s.done).map((s) => s.land)) + 1 });
      return;
    }
    if (m.tick + 1 >= e.until) return release(v); // the bound in `start` ran out before home: gone all the same, never left flying
    if (e.phase !== 'leaving' && crippled(m, v)) leave(m, e, v, events); // breaks off early
    if (e.phase === 'leaving') {
      const home = e.from!;
      if (dist2(v, home) <= (t.gunshipSpeedMps / t.hz) ** 2) {
        release(v); // off the map: gone
        e.until = m.tick + 1;
        return;
      }
      return fly(m, e, v, home);
    }
    fly(m, e, v, e.phase === 'inbound' ? e : aim(m, e, v));
    if (e.phase === 'inbound') {
      if (dist2(v, e) > t.gunshipRangeM * t.gunshipRangeM) return;
      Object.assign(e, { phase: 'station', phaseAt: m.tick, nextShot: m.tick });
      assetRadio(m, e, 'Gunship on station', events);
    }
    paradrop(m, v); // each passenger jumps as it passes its goal
    if (m.tick >= e.phaseAt! + ticksOf(t, t.gunshipStationSeconds)) leave(m, e, v, events);
    else if (m.tick >= e.nextShot!) shoot(m, e, v);
  },

  contacts: (m, e) => (e.phase === 'station' ? inRange(m, e, vehicleOf(m, e.vehicle!)!) : []),

  view(m, e) {
    const t = m.tune;
    const v = vehicleOf(m, e.vehicle!)!;
    const left = e.phase === 'inbound' ? t.gunshipStationSeconds : e.phase === 'station' ? (e.phaseAt! + ticksOf(t, t.gunshipStationSeconds) - m.tick) / t.hz : 0;
    const shells = e.shells!.filter((s) => !s.done && s.launch <= m.tick).map((s) => ({ x: s.x, y: s.y, from: s.from!, flight: (m.tick - s.launch) / (s.land - s.launch) }));
    return { side: e.side, from: e.from!, left: Math.max(0, left), total: t.gunshipStationSeconds, shells, ...(e.phase !== 'down' && !lost(v) && { phase: e.phase, craft: { x: v.x, y: v.y, fx: v.fx, fy: v.fy, turn: e.turn! } }) }; // shot down this tick: its Asset learns next tick
  },

  hash(e, mix: Mix) {
    for (const n of [e.from!.x, e.from!.y]) mix(Math.round(n * 1000));
    for (const n of [e.vehicle!, PHASES.indexOf(e.phase!), e.phaseAt!, e.nextShot!, e.prey!, e.turn!, +e.out!, e.shells!.length]) mix(n);
    for (const s of e.shells!) for (const n of [Math.round(s.x * 1000), Math.round(s.y * 1000), Math.round(s.from!.x * 1000), Math.round(s.from!.y * 1000), s.launch, s.land, +s.done]) mix(n);
  },
};
