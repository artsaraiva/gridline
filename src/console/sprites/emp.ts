// The EMP Strike (#143): its baked missile (the Drone Strike's sprite family: a row a Faction, then the shadow), where it is in
// its level flight from the HQ, the white-blue flash of its airburst, its ring while it holds, and the crackle on each vehicle it
// holds. layers/emp.ts draws them.
import type { EffectView, SideId, Vec2, VehicleKind } from '../../sim/types';
import { levelFlight, lifted, type LevelFlight } from './level-flight';
import { CRUISE_ALTITUDE_M } from './missile';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per Faction (heading k at k * 360 / EMP_HEADINGS deg from east). */
export const EMP_HEADINGS = 16;
/** Faction rows (the FactionPaint material role), in SIDES order: nato, then pact. */
export const EMP_FACTIONS = 2;
export const EMP_SHADOW_FRAME = EMP_FACTIONS * EMP_HEADINGS;
/** True world size in metres of one frame (ORTHO_M in assets/munitions/emp-missile/build.py; the missile is 2.6 m long). */
export const EMP_WORLD_M = 3.2;
/** Tunable exaggeration on its world scale so it reads at close tactical zoom, as the drone's. */
export const EMP_EXAGGERATION = 3;
/** The EMP's own colour, white-blue: its flash, its ring and the crackle and bolt on what it holds. */
export const EMP_BLUE = 0xa8e6ff;
/** The flash collapses from the ring's size to nothing over this long from the burst. */
export const FLASH_SECONDS = 0.5;
/** The held ring is this faint, and fades out over the effect's last FADE_SECONDS. */
const RING_OPACITY = 0.3;
const FADE_SECONDS = 1.5;
/** The contrail reaches this far back along the flown path: thin and short, as the drone's. */
const TRAIL_M = 90;
/** The crackle is redrawn this often, each time somewhere else on the hull. */
const SPARK_SECONDS = 0.09;
const SPARKS = 3;
/** How big each class's hull is as its layer draws it (exaggeration included), in metres: the crackle keeps on it. */
export const HULL_M: Partial<Record<VehicleKind, number>> = { tank: 12, aa: 12, jeep: 7, helicopter: 14 };

export const EMP_SHEET: SpriteSheetSpec = {
  file: 'munitions/emp-missile.png',
  frames: EMP_SHADOW_FRAME + 1,
  framePx: 128,
  cols: EMP_HEADINGS,
  constants: { EMP_HEADINGS, EMP_FACTIONS, EMP_WORLD_M },
};

// The tactical icon, in chevrons, nose +y: a small missile with a fat warhead, strakes and tail fins. The right half; the left
// mirrors it. layers/emp.ts fills it on the map (bracketed, as the drone's), chrome/icons.ts in the Asset row.
const HALF: [number, number][] = [[0, 0.66], [0.09, 0.6], [0.14, 0.46], [0.14, 0.2], [0.08, 0.13], [0.08, -0.02], [0.28, -0.16], [0.28, -0.28], [0.08, -0.26], [0.08, -0.4], [0.26, -0.56], [0.26, -0.66], [0.06, -0.6], [0, -0.64]];
export const EMP_OUTLINE: [number, number][] = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];
/** A lightning bolt, in chevrons: the mark on a vehicle the EMP holds, beside its tactical icon. */
export const BOLT_OUTLINE: [number, number][] = [[0.1, 0.5], [-0.2, 0.02], [0.0, 0.02], [-0.12, -0.5], [0.22, 0.08], [0.02, 0.08], [0.18, 0.5]];

export interface EmpInFlight extends LevelFlight {
  side: SideId;
  size: number;
  /** The spot it bursts over. */
  to: Vec2;
  /** The contrail along the path it flew, at the altitude it flew it, from `tail` to where it is. */
  trail: { tail: Vec2; head: Vec2 };
}

type EmpView = EffectView & { side: SideId; from: Vec2; flight: number };

/** The missile in the air, level all the way from the HQ it left to the spot it bursts over (the burst is in the air: it never comes down). */
export function empInFlight(e: EmpView, exaggeration = EMP_EXAGGERATION): EmpInFlight {
  const [dx, dy] = [e.x - e.from.x, e.y - e.from.y];
  const d = Math.hypot(dx, dy) || 1;
  const craft = { x: e.from.x + dx * e.flight, y: e.from.y + dy * e.flight, fx: dx / d, fy: dy / d };
  const back = Math.min(TRAIL_M, d * e.flight);
  return {
    ...levelFlight(craft, e.side, EMP_HEADINGS),
    side: e.side,
    size: EMP_WORLD_M * exaggeration,
    to: { x: e.x, y: e.y },
    trail: { tail: lifted({ x: craft.x - craft.fx * back, y: craft.y - craft.fy * back }), head: lifted(craft) },
  };
}

/** Every EMP missile still in the air in `effects`, the enemy's included (the sky rule); one that has burst is the flash's. */
export const empsInFlight = (effects: EffectView[] | undefined) =>
  (effects ?? []).flatMap((e) => (e.asset === 'emp' && e.side && e.from && e.flight !== undefined && e.burst === undefined ? [empInFlight({ ...e, side: e.side, from: e.from, flight: e.flight })] : []));

/** The burst `burst` seconds on: a disc over the spot that starts at the ring's `radius` and collapses to nothing as it fades, slowly then fast; null once over. */
export function empFlash(burst: number, radius: number): { r: number; opacity: number } | null {
  if (burst < 0 || burst >= FLASH_SECONDS) return null;
  const f = burst / FLASH_SECONDS;
  return { r: radius * (1 - f * f), opacity: 1 - f };
}

/** How strong the ring shows while the EMP holds, with `left` seconds of it to go: faint, fading out at the end. */
export const empRing = (left: number) => RING_OPACITY * Math.max(0, Math.min(1, left / FADE_SECONDS));

/** The airburst's spot, high where the missile flew: where the flash's bright core sits. */
export const burstAt = (spot: Vec2) => lifted(spot, CRUISE_ALTITUDE_M);

/** A number in [0, 1) from the integers given: the same ones, the same number (so a spark holds still between redraws). */
function hash(...n: number[]) {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return (h ^ (h >>> 13)) / 4294967296;
}

/**
 * The crackle on a vehicle the EMP holds (`id`, centred on `at`, `sizeM` across as drawn) at `seconds` (any running clock): a few
 * short jagged sparks, two segments each, inside its hull, redrawn every SPARK_SECONDS somewhere else.
 */
export function crackle(id: number, at: Vec2, sizeM: number, seconds: number): Vec2[][] {
  const slot = Math.floor(seconds / SPARK_SECONDS);
  return Array.from({ length: SPARKS }, (_, k) => {
    const r = (i: number) => hash(id, slot, k, i);
    const reach = sizeM * 0.32;
    const a = 2 * Math.PI * r(0);
    let p = { x: at.x + Math.cos(a) * reach * r(1), y: at.y + Math.sin(a) * reach * r(1) };
    const pts = [p];
    let heading = 2 * Math.PI * r(2);
    for (let s = 0; s < 2; s++) {
      const len = sizeM * (0.12 + 0.12 * r(3 + s));
      heading += (r(5 + s) - 0.5) * 2.2; // a jag
      p = { x: p.x + Math.cos(heading) * len, y: p.y + Math.sin(heading) * len };
      const off = Math.hypot(p.x - at.x, p.y - at.y);
      if (off > reach) p = { x: at.x + ((p.x - at.x) * reach) / off, y: at.y + ((p.y - at.y) * reach) / off }; // kept on the hull
      pts.push(p);
    }
    return pts;
  });
}
