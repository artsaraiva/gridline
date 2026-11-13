// The Drone Strike's drone (#139): its baked sheet (a row a Faction, then the shadow), where it is in its flight, its short
// contrail, and its fall when the enemy AA shoots it down. layers/drone.ts draws it.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { EffectView, SideId, Vec2 } from '../../sim/types';
import { downed, levelFlight, lifted, type LevelFlight } from './level-flight';
import { CRUISE_ALTITUDE_M } from './missile';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per Faction (heading k at k * 360 / DRONE_HEADINGS deg from east). */
export const DRONE_HEADINGS = 16;
/** Faction rows (the FactionPaint material role), in SIDES order: nato, then pact. */
export const DRONE_FACTIONS = 2;
export const DRONE_SHADOW_FRAME = DRONE_FACTIONS * DRONE_HEADINGS;
/** True world size in metres of one frame (ORTHO_M in assets/objects/drone/build.py; a 3.6 m span). */
export const DRONE_WORLD_M = 4;
/** Tunable exaggeration on its world scale so it reads at close tactical zoom, as the Scan UAV's. */
export const DRONE_EXAGGERATION = 3;
/** The contrail reaches this far back along the flown path: thin and short. */
const TRAIL_M = 90;
/** It flies level until this far from its spot, then comes down on a steady shallow slope to hit the ground there (about 17 deg; the Cruise Missile drops straight down). */
const DESCENT_M = 160;
/** Its altitude when `d` metres short of its spot. */
const altitudeAt = (d: number) => CRUISE_ALTITUDE_M * Math.min(1, d / DESCENT_M);

export const DRONE_SHEET: SpriteSheetSpec = {
  file: 'objects/drone.png',
  frames: DRONE_SHADOW_FRAME + 1,
  framePx: 128,
  cols: DRONE_HEADINGS,
  constants: { DRONE_HEADINGS, DRONE_FACTIONS, DRONE_WORLD_M },
};

// The tactical icon, in chevrons, nose +y, the shape a drone is known by: a bulbous nose on a thin body, long slender wings
// set back, a V tail. The right half; the left mirrors it. layers/drone.ts fills it on the map, chrome/icons.ts in the Asset row.
const HALF: [number, number][] = [[0, 0.68], [0.08, 0.62], [0.12, 0.5], [0.12, 0.38], [0.06, 0.24], [0.06, 0.04], [0.74, -0.04], [0.74, -0.12], [0.06, -0.18], [0.05, -0.42], [0.27, -0.58], [0.27, -0.66], [0.04, -0.55], [0, -0.6]];
export const DRONE_OUTLINE: [number, number][] = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];

export interface DroneInFlight extends LevelFlight {
  side: SideId;
  size: number;
  /** The spot it flies at. */
  to: Vec2;
  /** Shot down: it falls onto its shadow, then fades; no mark, no icon. */
  lost: boolean;
  opacity: number;
  /** The contrail along the path it flew, at the altitude it flew it: from `tail` to where it is (to where it was hit, once it falls). */
  trail: { tail: Vec2; head: Vec2 };
}

type DroneView = EffectView & { side: SideId; from: Vec2; craft: NonNullable<EffectView['craft']> };

/** A drone in the air (or falling): its pose, frame and world scale, its contrail and the spot it is bound for. */
export function droneInFlight(e: DroneView, exaggeration = DRONE_EXAGGERATION): DroneInFlight {
  const { height, opacity } = e.lost ? downed(e.left, DEFAULT_TUNE.barrageContactSeconds) : { height: 1, opacity: 1 };
  const short = Math.hypot(e.x - e.craft.x, e.y - e.craft.y);
  const head = lifted(e.craft, altitudeAt(short));
  const back = Math.min(TRAIL_M, Math.hypot(e.craft.x - e.from.x, e.craft.y - e.from.y));
  const tail = lifted({ x: e.craft.x - e.craft.fx * back, y: e.craft.y - e.craft.fy * back }, altitudeAt(short + back));
  return {
    ...levelFlight(e.craft, e.side, DRONE_HEADINGS, altitudeAt(short) * height),
    side: e.side,
    size: DRONE_WORLD_M * exaggeration,
    to: { x: e.x, y: e.y },
    lost: !!e.lost,
    opacity,
    trail: { tail, head },
  };
}

/** Every drone in the air in `effects`, the enemy's included (the sky rule); one that has hit is the impact layer's. */
export const dronesInFlight = (effects: EffectView[] | undefined) => (effects ?? []).flatMap((e) => (e.asset === 'drone' && e.side && e.from && e.craft ? [droneInFlight({ ...e, side: e.side, from: e.from, craft: e.craft })] : []));
