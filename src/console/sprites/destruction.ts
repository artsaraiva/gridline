// How a vehicle dies on the map, from its `destroyed` event: the Wreck is what the death leaves, not a swap. A tank cooks
// off and throws its turret; a jeep is kicked by its fuel going up and loses a wheel; an AA sets off its own ammunition and
// one missile; a helicopter spins down where it was hit; a jet comes down burning, lands still moving and slides to where
// the Simulation put its Wreck. Every Wreck then burns for a while under black smoke and smoulders on.
// Console look only: the times, sizes and counts here are judged by eye, not Tune values. layers/destruction.ts draws it;
// the vehicle layers ask `fallOf`, `turretOf` and `kickOf` where to draw the Wreck meanwhile.
import type { SimEvent, Vec2 } from '../../sim/types';
import { type ImpactGlow, type ImpactSprite, type ImpactStreak, WIND } from './impact';
import { ALTITUDE_LIFT_PER_M } from './missile';
import { SHADOW_DIR } from './sheet';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

export type DestroyedEvent = Extract<SimEvent, { kind: 'destroyed' }>;

export interface DeathRecord extends Vec2 {
  kind: DestroyedEvent['vehicle'];
  id: number;
  fx: number;
  fy: number;
  /** Where it was in the air when it was hit; absent when it died on the ground. */
  from?: Vec2;
  at: number;
  seed: number;
  /** A helicopter bailed out of was already turning by this much when it was hit. */
  turn0: number;
  /** How many of its blasts (`blastsOf`) the layer has set off. */
  blasts: number;
}

/** Console constant: deaths kept (a thrown turret, a scar, a wheel stay as long); past this the oldest is dropped. */
export const DEATH_CAP = 40;

/** Records a death at `at` ms, dropping the oldest past DEATH_CAP. Returns `list`. */
export function recordDeath(list: DeathRecord[], e: DestroyedEvent, at: number, turn0 = 0): DeathRecord[] {
  list.push({ kind: e.vehicle, id: e.id, x: e.x, y: e.y, fx: e.fx, fy: e.fy, ...(e.from && { from: e.from }), at, seed: (list.at(-1)?.seed ?? -1) + 1, turn0, blasts: 0 });
  if (list.length > DEATH_CAP) list.splice(0, list.length - DEATH_CAP);
  return list;
}

/** The death of the Wreck at `w`, if it is still kept: the latest there. */
export const deathOf = (list: DeathRecord[], w: { kind: string } & Vec2) => list.filter((d) => d.kind === w.kind && Math.abs(d.x - w.x) < 0.01 && Math.abs(d.y - w.y) < 0.01).at(-1);

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;
const UP = { x: -SHADOW_DIR.x, y: -SHADOW_DIR.y }; // the way altitude lifts a thing on the map
const ease = (u: number) => 1 - (1 - u) ** 2;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

/** A jet falls for this long before it touches down, then slides; a helicopter drops for its own. */
const JET_FALL_MS = 1800;
const JET_SLIDE_MS = 700;
const JET_SLIDE_M = 30;
const HELI_FALL_MS = 1200;
/** A tank's ammunition goes this long after the hit, and its turret is in the air for this long after that. */
const COOK_OFF_MS = 450;
const TURRET_AIR_MS = 900;
const TURRET_THROW_M = 9;
const JEEP_KICK_MS = 700;
const WHEEL_MS = 1300;
const WHEEL_M = 18;
/** A dead AA's rounds go off from here to here, and one missile leaves the rack in between. */
const AA_ROUNDS_MS: [number, number] = [300, 5000];
const AA_MISSILE_MS: [number, number] = [1800, 2900];
/** The cruise altitude a falling aircraft starts from, as a lift on the map in metres (sprites/missile.ts). */
const CRUISE_LIFT_M = 50 * ALTITUDE_LIFT_PER_M;

/** What each kind burns like: its hull's size in metres, how many fires, how long they burn hard, the blast when it goes. */
const KIND: Partial<Record<DeathRecord['kind'], { body: number; fires: number; burnS: number; blast: number }>> = {
  tank: { body: 12, fires: 3, burnS: 11, blast: 0.55 },
  jeep: { body: 7, fires: 1, burnS: 6, blast: 0.4 },
  aa: { body: 12, fires: 2, burnS: 9, blast: 0.4 },
  helicopter: { body: 14, fires: 2, burnS: 5, blast: 0.7 },
  jet: { body: 14, fires: 2, burnS: 5, blast: 0.7 },
  gunship: { body: 30, fires: 4, burnS: 8, blast: 1 },
};
const SMOULDER = 0.25;
const SMOULDER_S = 45;

/** How long after the hit it touches the ground: at once for a ground vehicle. */
export const touchdownMs = (d: DeathRecord) => (!d.from ? 0 : d.kind === 'jet' ? JET_FALL_MS : d.kind === 'helicopter' ? HELI_FALL_MS : 0);
/** How long after the hit its Wreck lies still where the Simulation has it. */
export const restMs = (d: DeathRecord) => touchdownMs(d) + (d.from && d.kind === 'jet' ? JET_SLIDE_MS : 0);

/** A jet touches down this far short of its Wreck and slides the rest. */
function touchdown(d: DeathRecord): Vec2 {
  const far = d.from ? Math.hypot(d.x - d.from.x, d.y - d.from.y) : 0;
  const slide = Math.min(JET_SLIDE_M, far * 0.4);
  return { x: d.x - d.fx * slide, y: d.y - d.fy * slide };
}

export interface Fall extends Vec2 {
  /** Metres it is lifted north-east of (x, y), its spot on the ground. */
  lift: number;
  /** Radians its hull is turned from the Wreck's facing. */
  turn: number;
}

/**
 * Where a shot-down aircraft is `now`, until its Wreck lies still (then null): a helicopter spins down over the spot, faster and
 * faster; a jet keeps its way, slowing and turning, to its touchdown, then slides to its Wreck, straightening.
 */
export function fallOf(d: DeathRecord, now: number): Fall | null {
  const age = now - d.at;
  if (!d.from || age >= restMs(d) || (d.kind !== 'jet' && d.kind !== 'helicopter')) return null;
  const s = age / 1000;
  if (d.kind === 'helicopter') {
    const u = age / HELI_FALL_MS;
    return { x: d.x, y: d.y, lift: CRUISE_LIFT_M * (1 - u * u), turn: d.turn0 + 6 * s + 3 * s * s };
  }
  const t = touchdown(d);
  if (age < JET_FALL_MS) {
    const u = age / JET_FALL_MS;
    const along = (u - 0.3 * u * u) / 0.7; // it keeps its way, slowing
    return { x: d.from.x + (t.x - d.from.x) * along, y: d.from.y + (t.y - d.from.y) * along, lift: CRUISE_LIFT_M * (1 - u * u), turn: 7 * s };
  }
  const v = (age - JET_FALL_MS) / JET_SLIDE_MS;
  return { x: t.x + (d.x - t.x) * ease(v), y: t.y + (d.y - t.y) * ease(v), lift: 0, turn: 0.5 * (1 - v) ** 2 };
}

export interface Thrown {
  /** Metres from the hull's centre to where the part is, on the ground. */
  dx: number;
  dy: number;
  /** Metres it is in the air (it is drawn lifted and a little bigger). */
  up: number;
  /** Radians it is turned from where it pointed. */
  turn: number;
}

/**
 * A dead tank's or AA's turret: the tank's sits until the ammunition goes, then is thrown clear, tumbling, and lies where it
 * landed; the AA's slews round and stops.
 */
export function turretOf(d: DeathRecord, now: number): Thrown {
  const age = now - d.at;
  if (d.kind === 'aa') return { dx: 0, dy: 0, up: 0, turn: 0.9 * ease(clamp01(age / 2500)) };
  const u = clamp01((age - COOK_OFF_MS) / TURRET_AIR_MS);
  const a = hash(d.seed * 3 + 1) * Math.PI * 2;
  return { dx: Math.cos(a) * TURRET_THROW_M * u, dy: Math.sin(a) * TURRET_THROW_M * u, up: 4 * u * (1 - u) * 5, turn: 7.4 * u };
}

/** The unit vector (x, y) turned by `a` radians. */
export const turned = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
/** Where a thrown part is drawn, from the hull's centre: where it is on the ground, lifted north-east by its height. */
export const drawnAt = (t: Thrown): Vec2 => ({ x: t.dx + UP.x * t.up * 0.6, y: t.dy + UP.y * t.up * 0.6 });
/** Where a falling aircraft's hull is drawn: lifted north-east of its spot on the ground. */
export const aloftAt = (f: Fall): Vec2 => ({ x: f.x + UP.x * f.lift, y: f.y + UP.y * f.lift });

/** A dead jeep's hull as its fuel goes up: a hop off the ground and a slew that settles back on the Wreck's facing. */
export function kickOf(d: DeathRecord, now: number): Thrown {
  const u = clamp01((now - d.at) / JEEP_KICK_MS);
  return { dx: 0, dy: 0, up: 4 * u * (1 - u) * 1.5, turn: 0.5 * Math.sin(u * Math.PI * 3) * (1 - u) };
}

/** A blast the death sets off, `ms` after the hit, `size` of a shell's. */
export interface DeathBlast extends Vec2 {
  ms: number;
  size: number;
}

/** The blasts of one death, in order: when the tank's ammunition goes, when an aircraft meets the ground, else at the hit. */
export function blastsOf(d: DeathRecord): DeathBlast[] {
  const k = KIND[d.kind];
  if (!k) return [];
  const at = d.kind === 'jet' && d.from ? touchdown(d) : d;
  return [{ x: at.x, y: at.y, ms: d.kind === 'tank' ? COOK_OFF_MS : touchdownMs(d), size: k.blast }];
}

/** A loose part lying (or bouncing) on the map: a dark disc `size` metres across over its shadow. */
export interface DeathPiece extends Vec2 {
  size: number;
  shadow: Vec2;
}

/** A dark streak on the ground from (x0, y0) to (x1, y1), `width` metres wide. */
export interface DeathScar {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  opacity: number;
}

export interface DeathLook {
  /** The ground burned black under the Wreck; it stays. */
  scorch: ImpactGlow | null;
  /** The track a jet's slide tore; it stays. */
  scar: DeathScar | null;
  /** Each fire's glow and, right after it, its hot core; `high` ones burn on an aircraft still in the air. */
  fires: (ImpactGlow & { high?: boolean })[];
  /** Black smoke off the fire, rising and leaning with the wind. */
  smoke: ImpactSprite[];
  /** Grey puffs: flak bursts, a missile's trail, dust off a slide. */
  puffs: ImpactSprite[];
  flashes: ImpactGlow[];
  /** Rounds going off, blades and fragments thrown, flame from a hatch. */
  streaks: ImpactStreak[];
  pieces: DeathPiece[];
}

/** How hard it burns `s` seconds after it met the ground: full, then down to a smoulder, which dies out. */
export function burn(d: DeathRecord, s: number): number {
  const k = KIND[d.kind];
  if (!k || s < 0) return 0;
  if (s < k.burnS) return 1;
  if (s < SMOULDER_S) return Math.max(SMOULDER, 1 - (s - k.burnS) / 4);
  return Math.max(0, SMOULDER * (1 - (s - SMOULDER_S) / 10));
}

const SMOKE_EVERY_S = 0.35;
const SMOKE_LIFE_S = 5;

/** One thing going off at (x, y): a flash, and fragments thrown from it. */
function pop(look: DeathLook, x: number, y: number, age: number, seed: number, size = 5) {
  if (age < 0 || age >= 0.4) return;
  if (age < 0.1) look.flashes.push({ x, y, size, opacity: 1 - age / 0.1 });
  for (let k = 0; k < 4; k++) {
    const a = hash(seed + k * 1.7) * Math.PI * 2;
    const v = 20 + 25 * hash(seed + k * 2.3);
    const out = (sec: number) => (v * (1 - Math.exp(-5 * Math.max(0, sec)))) / 5;
    look.streaks.push({ x0: x + Math.cos(a) * out(age - 0.04), y0: y + Math.sin(a) * out(age - 0.04), x1: x + Math.cos(a) * out(age), y1: y + Math.sin(a) * out(age), opacity: 1 - age / 0.4, heat: 1 - age / 0.4 });
  }
}

/** A grey puff `age` seconds old that hangs for `life`, swelling from `size` and drifting with the wind. */
const puff = (x: number, y: number, age: number, life: number, size: number, k: number, opacity = 0.5): ImpactSprite => ({
  x: x + WIND.x * age * 3,
  y: y + WIND.y * age * 3,
  size: size * (1 + 1.2 * Math.sqrt(age / life)),
  frame: k % SMOKE_PUFF_VARIANTS,
  flip: k % 2 === 1,
  opacity: opacity * Math.min(1, age / 0.1) * (1 - age / life),
});

/** The dead AA's missile `g` seconds off the rack: where it is and which way it points, corkscrewing. */
function strayMissile(d: DeathRecord, g: number) {
  let [x, y, h] = [d.x, d.y, Math.atan2(d.fy, d.fx) - 1.3 + hash(d.seed * 5) * 2.6];
  const dt = 1 / 60;
  for (let t = 0; t < g; t += dt) {
    h += (Math.sin(t * 11) * 3 + 0.9) * dt;
    x += Math.cos(h) * 80 * dt;
    y += Math.sin(h) * 80 * dt;
  }
  return { x, y, h };
}

/** What one death shows at `now` ms, beside its blasts and the Wreck itself. */
export function deathLook(d: DeathRecord, now: number): DeathLook {
  const look: DeathLook = { scorch: null, scar: null, fires: [], smoke: [], puffs: [], flashes: [], streaks: [], pieces: [] };
  const k = KIND[d.kind];
  if (!k) return look;
  const age = now - d.at;
  const s = age / 1000;
  const down = (age - touchdownMs(d)) / 1000; // seconds on the ground
  const fall = fallOf(d, now);
  const at = fall ?? d; // where the hull is on the ground
  const heading = Math.atan2(d.fy, d.fx);

  if (fall && fall.lift > 0) {
    // still in the air: it burns as it comes down
    const { x, y } = aloftAt(fall);
    const flicker = 0.75 + 0.25 * Math.sin(s * 23);
    look.fires.push({ x, y, size: 6 * flicker, opacity: 0.7, high: true }, { x, y, size: 2.2 * flicker, opacity: 0.95, high: true });
    return look;
  }

  // on the ground: the scorch, the fires and their smoke
  const cooked = d.kind === 'tank' ? s - COOK_OFF_MS / 1000 : down; // a tank burns from its cook-off
  look.scorch = { x: at.x, y: at.y, size: k.body * 1.7, opacity: 0.55 * clamp01(down / 1.2) };
  const heat = burn(d, cooked);
  for (let i = 0; i < k.fires && heat > 0; i++) {
    const x = at.x + (hash(d.seed * 41 + i) - 0.5) * k.body * 0.45;
    const y = at.y + (hash(d.seed * 43 + i) - 0.5) * k.body * 0.3;
    const flicker = 0.6 + 0.4 * Math.sin(s * 23 + i * 2.1);
    look.fires.push({ x, y, size: (3 + k.body * 0.12) * (0.8 + 0.2 * flicker), opacity: 0.6 * flicker * heat }, { x, y, size: (1 + k.body * 0.04) * flicker, opacity: 0.9 * heat });
  }
  if (cooked > 0) {
    const newest = Math.floor(cooked / SMOKE_EVERY_S);
    for (let j = newest; j >= 0 && cooked - j * SMOKE_EVERY_S < SMOKE_LIFE_S; j--) {
      const born = j * SMOKE_EVERY_S;
      const a = cooked - born;
      const thick = burn(d, born);
      if (thick <= 0) continue;
      const q = hash(d.seed * 7 + j);
      const life = a / SMOKE_LIFE_S;
      const rise = a * (3.2 + 1.6 * q); // it climbs, so it is lifted north-east as it ages, clear of the Wreck
      const wander = Math.sin(a * 0.9 + q * 6) * 1.5 * Math.sqrt(life);
      look.smoke.push({
        x: at.x + (q - 0.5) * k.body * 0.3 + UP.x * rise + WIND.x * a * 2.5 - WIND.y * wander,
        y: at.y + (hash(d.seed * 11 + j) - 0.5) * k.body * 0.3 + UP.y * rise + WIND.y * a * 2.5 + WIND.x * wander,
        size: (0.5 + 0.035 * k.body) * (4 + 13 * life) * (0.6 + 0.4 * thick),
        frame: j % SMOKE_PUFF_VARIANTS,
        flip: q < 0.5,
        opacity: Math.min(1, thick + 0.3) * Math.min(1, a / 0.5) * (1 - life) ** 0.8,
      });
    }
  }

  if (d.kind === 'tank') {
    if (age < COOK_OFF_MS) {
      // flame jetting from the hatches until the ammunition goes
      const left = 1 - (age / COOK_OFF_MS) ** 2;
      for (const [turn, length] of [[1.9, 9], [-1.0, 6.5]] as const) {
        const [cx, cy] = [Math.cos(heading + turn), Math.sin(heading + turn)];
        look.streaks.push({ x0: d.x, y0: d.y, x1: d.x + cx * length, y1: d.y + cy * length, opacity: left, heat: 1 });
        look.fires.push({ x: d.x + cx * length * 0.5, y: d.y + cy * length * 0.5, size: 5, opacity: 0.7 * left });
      }
    }
    // rounds cooking off, further and further apart
    for (let n = 0, t = 0.5; t < 6; n++, t += 0.25 + hash(d.seed * 53 + n) * (0.25 + t * 0.25))
      pop(look, d.x + (hash(d.seed * 59 + n) - 0.5) * 5, d.y + (hash(d.seed * 61 + n) - 0.5) * 3.5, cooked - t, d.seed * 67 + n);
  }

  if (d.kind === 'jeep') {
    const w = clamp01(age / WHEEL_MS);
    const a = hash(d.seed * 3 + 2) * Math.PI * 2;
    const [x, y] = [d.x + Math.cos(a) * WHEEL_M * ease(w), d.y + Math.sin(a) * WHEEL_M * ease(w)];
    const up = Math.abs(Math.sin(w * Math.PI * 2.5)) * 3 * (1 - w);
    look.pieces.push({ x: x + UP.x * up, y: y + UP.y * up, size: 1.5, shadow: { x, y } });
  }

  if (d.kind === 'aa') {
    const turret = heading + turretOf(d, now).turn;
    // its rounds go off: each streaks away, and some burst as flak
    for (let n = 0, t = AA_ROUNDS_MS[0] / 1000; t < AA_ROUNDS_MS[1] / 1000; n++, t += (0.05 + 0.09 * hash(d.seed * 71 + n)) * (1 + t * 0.5)) {
      const a = s - t;
      if (a < 0) break;
      const dir = turret + (hash(d.seed * 73 + n) - 0.5) * 3;
      const reach = 25 + 45 * hash(d.seed * 79 + n);
      const [cx, cy] = [Math.cos(dir), Math.sin(dir)];
      const flight = reach / 150;
      if (a < flight) {
        const [head, tail] = [a * 150, Math.max(0, a * 150 - 8)];
        look.streaks.push({ x0: d.x + cx * tail, y0: d.y + cy * tail, x1: d.x + cx * head, y1: d.y + cy * head, opacity: 0.9, heat: 1 });
      } else if (hash(d.seed * 83 + n) < 0.3 && a - flight < 1.8) {
        const [x, y] = [d.x + cx * reach, d.y + cy * reach];
        if (a - flight < 0.09) look.flashes.push({ x, y, size: 4.5, opacity: 1 - (a - flight) / 0.09 });
        look.puffs.push(puff(x, y, a - flight, 1.8, 3, n));
      }
      if (hash(d.seed * 89 + n) < 0.35) pop(look, d.x + (hash(d.seed * 97 + n) - 0.5) * 5, d.y + (hash(d.seed * 101 + n) - 0.5) * 5, a, d.seed * 103 + n, 4);
    }
    // one missile cooks off the rack and corkscrews away to burst
    const g = (age - AA_MISSILE_MS[0]) / 1000;
    const flight = (AA_MISSILE_MS[1] - AA_MISSILE_MS[0]) / 1000;
    if (g >= 0 && g < flight + 2.6) {
      for (let n = 0, t = 0; t < Math.min(g, flight); n++, t += 0.06) {
        const p = strayMissile(d, t);
        if (g - t < 2.6) look.puffs.push(puff(p.x, p.y, g - t, 2.6, 1.6, n, 0.4));
      }
      const p = strayMissile(d, Math.min(g, flight));
      if (g < flight) {
        look.streaks.push({ x0: p.x - Math.cos(p.h) * 5, y0: p.y - Math.sin(p.h) * 5, x1: p.x, y1: p.y, opacity: 1, heat: 1 });
        look.fires.push({ x: p.x - Math.cos(p.h) * 4, y: p.y - Math.sin(p.h) * 4, size: 4, opacity: 0.8 });
      } else {
        if (g - flight < 0.1) look.flashes.push({ x: p.x, y: p.y, size: 7, opacity: 1 - (g - flight) / 0.1 });
        if (g - flight < 2.2) look.puffs.push(puff(p.x, p.y, g - flight, 2.2, 5, 1));
      }
    }
  }

  if (d.kind === 'helicopter' && down < 0.45) {
    // the blades go as it hits
    for (let n = 0; n < 3; n++) {
      const a = hash(d.seed * 107) * Math.PI * 2 + n * 2.1;
      const [head, tail] = [down * 60, Math.max(0, down * 60 - 7)];
      look.streaks.push({ x0: d.x + Math.cos(a) * tail, y0: d.y + Math.sin(a) * tail, x1: d.x + Math.cos(a) * head, y1: d.y + Math.sin(a) * head, opacity: 1 - down / 0.45, heat: 0.4 });
    }
  }

  if (d.kind === 'jet' && d.from) {
    const t = touchdown(d);
    look.scar = { x0: t.x, y0: t.y, x1: at.x, y1: at.y, width: 3, opacity: 0.4 };
    const slid = clamp01((age - JET_FALL_MS) / JET_SLIDE_MS);
    for (let n = 0; n < 3; n++) {
      // fires left along the scar, once the slide has passed them, for five seconds
      const f = 0.15 + 0.3 * n;
      if (ease(slid) < f || down >= 5) continue;
      const flicker = 0.6 + 0.4 * Math.sin(s * 23 + n * 2.1);
      look.fires.push({ x: t.x + (d.x - t.x) * f, y: t.y + (d.y - t.y) * f, size: 3.5 * flicker, opacity: 0.75 * (1 - down / 5) });
    }
    for (let n = 0, born = 0; born < Math.min(down, JET_SLIDE_MS / 1000); n++, born += 0.05) {
      // dust off the slide
      const v = ease(born / (JET_SLIDE_MS / 1000));
      if (down - born < 1.4) look.puffs.push(puff(t.x + (d.x - t.x) * v, t.y + (d.y - t.y) * v, down - born, 1.4, 4, n, 0.3));
    }
  }
  return look;
}
