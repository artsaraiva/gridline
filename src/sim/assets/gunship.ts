// Gunship (#101): a heavy Strike that works its route for a while. Usable only while the caller holds every keystone Capture Point
// (the Cruise Missile's gate) and its Side's Gunship is not already up; the cooldown runs regardless, and losing the point
// mid-sortie changes nothing. Its route is fixed, so the call names no spot: a counter-clockwise circle (the Scan UAV's way
// round) `gunshipOrbitM` round the keystone Capture Points (#150: the middle of them, where a map names more than one).
// ponytail: the route is that circle until maps carry their own; `route`, the tangent in `start` and `routeGap` change with it.
// At the call its Side's Gunship vehicle (vehicles.ts) wakes at the missile's launch point, beyond the Play Area behind the
// caller's HQ, and flies level at `gunshipSpeedMps` straight to where that line touches the circle; there it circles for
// `gunshipStationSeconds`, then turns for home and flies back to the launch point, where it sleeps until the next call. On
// station the enemies on foot within `gunshipRangeM` of the ground under it are Contacts, and its cannon fires one shell every
// `gunshipShotSeconds` at the one nearest (none in range: no shot): it leaves the aircraft, flies `gunshipShellFlightSeconds`
// and lands a Barrage shell's blast within `gunshipScatterM` of where that enemy was. Soldiers coming back may take its gun seat
// or a passenger seat (vehicles.ts `gunshipOnReturn`); each passenger jumps where the route passes nearest its goal, and
// everyone aboard bails out as it turns for home. It is in the sky, so both Sides' views carry it; the enemy AA fires on it as
// on a helicopter: under a third of its hit points it leaves early, at 0 it falls as a Wreck where it was and fires no more
// (shells already in the air still land). Its path is stepped a tick at a time; the orbit turns by `turnToward`'s polynomial
// step (no trig).
import { dist2, inHq, keystone } from '../geometry';
import { turnToward } from '../momentum';
import { rnd } from '../rng';
import { ticksOf, vehicleOf, type Mix } from '../state';
import type { Match } from '../index';
import type { SideId, SimEvent, Tune } from '../types';
import { bail, crippled, goalOf, jump, live, riders, routeGap, sleep, wake, type Vehicle } from '../vehicles';
import { shellBlast } from './barrage';
import { assetRadio, type Effect, type Kind } from './core';
import { heavyGate, launchPoint } from './missile';
import { blast } from './strike';

const PHASES = ['inbound', 'station', 'leaving', 'down'] as const;

/** Degrees a second it turns: its orbit's rate at its speed (the Scan UAV's way round, not its Console-drawn pace), and the same turning for home. */
const turnRate = (t: Tune) => ((t.gunshipSpeedMps / t.gunshipOrbitM) * 180) / Math.PI;

/** `side`'s Gunship vehicle. */
const body = (m: Match, side: SideId) => m.vehicles.find((v) => v.kind === 'gunship' && v.side === side)!;

/** The caller's enemies on foot in reach of the aircraft `v`: alive, not under a parachute, outside their own HQ (the Scan UAV's rule: an HQ hides its own). */
function inRange(m: Match, e: Effect, v: Vehicle) {
  const r = m.tune.gunshipRangeM;
  return m.soldiers.filter((s) => s.side !== e.side && s.state === 'alive' && s.vehicle < 0 && !s.chute && dist2(s, v) <= r * r && !inHq(m, s.side, s));
}

/** Turns for home: the radio says so, and everyone aboard jumps. */
function leave(m: Match, e: Effect, v: Vehicle, events: SimEvent[]) {
  Object.assign(e, { phase: 'leaving', phaseAt: m.tick });
  bail(m, v);
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
 * Each passenger jumps where the route takes it nearest its goal: heading away from the goal again, and as near it as the circle
 * ever comes (a tick's flight of slack, so one who boarded heading away waits for the next pass); with no goal, at once.
 */
function drop(m: Match, e: Effect, v: Vehicle) {
  const slack = m.tune.gunshipSpeedMps / m.tune.hz;
  for (const s of riders(m, v)) {
    if (s.crew) continue;
    const p = m.points[goalOf(m, m.squads[s.squad]!, s)];
    if (!p || ((p.x - v.x) * v.fx + (p.y - v.y) * v.fy <= 0 && Math.sqrt(dist2(p, v)) <= routeGap(m, e, p) + slack)) jump(m, s);
  }
}

export const gunship: Kind = {
  name: 'Gunship',
  sky: true,
  cooldownSeconds: (t) => t.gunshipCooldownSeconds,
  firstReadySeconds: (t) => t.gunshipCooldownSeconds, // starts on cooldown, as the Cruise Missile does
  seconds: (t) => t.gunshipStationSeconds, // `until` is set at the call, and again as it ends
  radius: (t) => t.gunshipOrbitM,
  // One aircraft a Side: not while the last is still flying (only once the cooldown is over, so in play, with a cooldown longer than any sortie, never: the row keeps its timers)
  gate: (m, side) => heavyGate(m, side) ?? (m.tick >= m.assets.readyAt[side].gunship! && live(body(m, side)) ? 'up' : null),
  route: (m) => {
    const keys = keystone(m); // #150: Auental's twin town has two; the circle goes round the middle of them
    return { x: keys.reduce((a, p) => a + p.x, 0) / (keys.length || 1), y: keys.reduce((a, p) => a + p.y, 0) / (keys.length || 1) };
  },

  start(m, e) {
    const t = m.tune;
    const R = t.gunshipOrbitM;
    const from = launchPoint(m, e.side);
    const [ox, oy] = [from.x - e.x, from.y - e.y];
    const d2 = ox * ox + oy * oy;
    const l = Math.sqrt(d2 - R * R); // the launch point is always far outside the circle
    // Where the line in touches the circle running on counter-clockwise: R²/d² of the way out to the launch point, R·l/d² to its left
    const to = { x: e.x + (R * R * ox - R * l * oy) / d2, y: e.y + (R * R * oy + R * l * ox) / d2 };
    const v = wake(m, body(m, e.side), (to.x - from.x) / l, (to.y - from.y) / l);
    Object.assign(e, { from, vehicle: v.id, phase: 'inbound', phaseAt: m.tick, nextShot: m.tick, shells: [] });
    // ponytail: a bound, not the exact end (the way in, the station, home from the circle's far side with a full turn); reaching home ends it sooner
    e.until = m.tick + ticksOf(t, (l + Math.sqrt(d2) + R + 2 * Math.PI * R) / t.gunshipSpeedMps + t.gunshipStationSeconds);
  },

  work(m, e, events) {
    const t = m.tune;
    land(m, e, events);
    if (e.phase === 'down') return;
    const v = vehicleOf(m, e.vehicle!)!;
    if (!live(v)) { // shot down: vehicles.ts `hurt` left the Wreck and bailed its riders out
      Object.assign(e, { phase: 'down', phaseAt: m.tick, until: Math.max(m.tick, ...e.shells!.filter((s) => !s.done).map((s) => s.land)) + 1 });
      return;
    }
    if (m.tick + 1 >= e.until) return void sleep(v); // the bound in `start` ran out before home: gone all the same, never left flying
    if (e.phase !== 'leaving' && crippled(m, v)) leave(m, e, v, events); // breaks off early
    const step = t.gunshipSpeedMps / t.hz;
    v.movedAt = m.tick;
    if (e.phase === 'inbound') {
      const ahead = (e.x - v.x) * v.fx + (e.y - v.y) * v.fy; // to the touching point: the line's nearest to the centre
      Object.assign(v, { x: v.x + v.fx * Math.min(step, ahead), y: v.y + v.fy * Math.min(step, ahead) });
      if (ahead <= step) {
        Object.assign(e, { phase: 'station', phaseAt: m.tick, nextShot: m.tick });
        assetRadio(m, e, 'Gunship on station', events);
      }
    } else if (e.phase === 'station') {
      const R = t.gunshipOrbitM;
      const u = turnToward((v.x - e.x) / R, (v.y - e.y) / R, (e.y - v.y) / R, (v.x - e.x) / R, turnRate(t), t.hz); // a step round, the centre on its left
      Object.assign(v, { x: e.x + u.fx * R, y: e.y + u.fy * R, fx: -u.fy, fy: u.fx });
      drop(m, e, v);
      if (m.tick >= e.phaseAt! + ticksOf(t, t.gunshipStationSeconds)) leave(m, e, v, events);
      else if (m.tick >= e.nextShot!) shoot(m, e, v);
    } else {
      const home = e.from!;
      const d = Math.sqrt(dist2(v, home));
      if (d <= step) {
        sleep(v); // off the map: gone
        e.until = m.tick + 1;
        return;
      }
      const f = turnToward(v.fx, v.fy, (home.x - v.x) / d, (home.y - v.y) / d, turnRate(t), t.hz);
      Object.assign(v, { x: v.x + f.fx * step, y: v.y + f.fy * step, ...f });
    }
  },

  contacts: (m, e) => (e.phase === 'station' ? inRange(m, e, vehicleOf(m, e.vehicle!)!) : []),

  view(m, e) {
    const t = m.tune;
    const sp = t.gunshipSpeedMps;
    const v = vehicleOf(m, e.vehicle!)!;
    const inbound = Math.sqrt(dist2(e.from!, e) - t.gunshipOrbitM * t.gunshipOrbitM) / sp;
    const left =
      e.phase === 'inbound'
        ? ((e.x - v.x) * v.fx + (e.y - v.y) * v.fy) / sp + t.gunshipStationSeconds
        : e.phase === 'station'
          ? (e.phaseAt! + ticksOf(t, t.gunshipStationSeconds) - m.tick) / t.hz
          : 0;
    const shells = e.shells!.filter((s) => !s.done && s.launch <= m.tick).map((s) => ({ x: s.x, y: s.y, from: s.from!, flight: (m.tick - s.launch) / (s.land - s.launch) }));
    return { side: e.side, from: e.from!, left: Math.max(0, left), total: inbound + t.gunshipStationSeconds, shells, ...(e.phase !== 'down' && live(v) && { phase: e.phase, craft: { x: v.x, y: v.y, fx: v.fx, fy: v.fy } }) }; // shot down this tick: its Asset learns next tick
  },

  hash(e, mix: Mix) {
    for (const n of [e.from!.x, e.from!.y]) mix(Math.round(n * 1000));
    for (const n of [e.vehicle!, PHASES.indexOf(e.phase!), e.phaseAt!, e.nextShot!, e.shells!.length]) mix(n);
    for (const s of e.shells!) for (const n of [Math.round(s.x * 1000), Math.round(s.y * 1000), Math.round(s.from!.x * 1000), Math.round(s.from!.y * 1000), s.launch, s.land, +s.done]) mix(n);
  },
};
