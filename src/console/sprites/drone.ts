// The Drone Strike's drone (#139): its baked sheet (a row a Faction, then the shadow), where it is in its flight, its short
// contrail, and its fall when the enemy AA shoots it down. layers/drone.ts draws it.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { EffectView, SideId, Vec2 } from '../../sim/types';
import { downed, levelFlight, lifted, type LevelFlight } from './level-flight';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per Faction (heading k at k * 360 / DRONE_HEADINGS deg from east). */
export const DRONE_HEADINGS = 16;
/** Faction rows (the FactionPaint material role), in SIDES order: nato, then pact. */
export const DRONE_FACTIONS = 2;
export const DRONE_SHADOW_FRAME = DRONE_FACTIONS * DRONE_HEADINGS;
/** True world size in metres of one frame (ORTHO_M in assets/objects/drone/build.py; a 3.4 m span). */
export const DRONE_WORLD_M = 4;
/** Tunable exaggeration on its world scale so it reads at close tactical zoom, as the Scan UAV's. */
export const DRONE_EXAGGERATION = 3;
/** The contrail reaches this far back along the flown path: thin and short, 3 s of flight. */
const TRAIL_M = 3 * DEFAULT_TUNE.droneSpeedMps;

export const DRONE_SHEET: SpriteSheetSpec = {
  file: 'objects/drone.png',
  frames: DRONE_SHADOW_FRAME + 1,
  framePx: 128,
  cols: DRONE_HEADINGS,
  constants: { DRONE_HEADINGS, DRONE_FACTIONS, DRONE_WORLD_M },
};

// The tactical icon, in chevrons, nose +y: a slim fuselage, a long straight wing, a small V tail. The right half; the left
// mirrors it. layers/drone.ts fills it on the map, chrome/icons.ts in the Asset row.
const HALF: [number, number][] = [[0, 0.66], [0.06, 0.52], [0.08, 0.16], [0.7, 0.06], [0.7, -0.08], [0.08, -0.12], [0.06, -0.4], [0.3, -0.52], [0.3, -0.62], [0.04, -0.56], [0, -0.62]];
export const DRONE_OUTLINE: [number, number][] = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];

export interface DroneInFlight extends LevelFlight {
  side: SideId;
  size: number;
  /** The spot it flies at. */
  to: Vec2;
  /** Shot down: it falls onto its shadow, then fades; no mark, no icon. */
  lost: boolean;
  opacity: number;
  /** The contrail along the path it flew, at cruise altitude: from `tail` to where it is (to where it was hit, once it falls). */
  trail: { tail: Vec2; head: Vec2 };
}

type DroneView = EffectView & { side: SideId; from: Vec2; craft: NonNullable<EffectView['craft']> };

/** A drone in the air (or falling): its pose, frame and world scale, its contrail and the spot it is bound for. */
export function droneInFlight(e: DroneView, exaggeration = DRONE_EXAGGERATION): DroneInFlight {
  const { fall, opacity } = e.lost ? downed(e.left, DEFAULT_TUNE.barrageContactSeconds) : { fall: 0, opacity: 1 };
  const head = lifted(e.craft);
  const back = Math.min(TRAIL_M, Math.hypot(e.craft.x - e.from.x, e.craft.y - e.from.y));
  return {
    ...levelFlight(e.craft, e.side, DRONE_HEADINGS, fall),
    side: e.side,
    size: DRONE_WORLD_M * exaggeration,
    to: { x: e.x, y: e.y },
    lost: !!e.lost,
    opacity,
    trail: { tail: { x: head.x - e.craft.fx * back, y: head.y - e.craft.fy * back }, head },
  };
}

/** Every drone in the air in `effects`, the enemy's included (the sky rule); one that has hit is the impact layer's. */
export const dronesInFlight = (effects: EffectView[] | undefined) => (effects ?? []).flatMap((e) => (e.asset === 'drone' && e.side && e.from && e.craft ? [droneInFlight({ ...e, side: e.side, from: e.from, craft: e.craft })] : []));
