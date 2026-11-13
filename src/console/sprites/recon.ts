// The Recon Plane (#139): its baked sheet (a row a Faction, then the shadow), where it is in its pass, the sweep band under
// it that fades behind, and its fall when the enemy AA shoots it down. layers/recon.ts draws it.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { EffectView, SideId, Vec2 } from '../../sim/types';
import { downed, levelFlight, type LevelFlight } from './level-flight';
import { CRUISE_ALTITUDE_M } from './missile';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per Faction (heading k at k * 360 / RECON_HEADINGS deg from east). */
export const RECON_HEADINGS = 16;
/** Faction rows (the FactionPaint material role), in SIDES order: nato, then pact. */
export const RECON_FACTIONS = 2;
export const RECON_SHADOW_FRAME = RECON_FACTIONS * RECON_HEADINGS;
/** True world size in metres of one frame (ORTHO_M in assets/objects/recon/build.py; a 12.2 m span). */
export const RECON_WORLD_M = 14;
/** Tunable exaggeration on its world scale so it reads at close tactical zoom. */
export const RECON_EXAGGERATION = 1.6;
/**
 * The sweep band: the ground it has looked at lights up under it and fades over `seconds`, in cells `cellM` long that stay
 * where they are on the ground (so nothing slides along with the aircraft); `opacity` is a cell's as the aircraft crosses it.
 */
const BAND = { seconds: 6, cellM: 20, opacity: 0.3 }; // the material's opacity curve makes that a faint wash

export const RECON_SHEET: SpriteSheetSpec = {
  file: 'objects/recon.png',
  frames: RECON_SHADOW_FRAME + 1,
  framePx: 160,
  cols: RECON_HEADINGS,
  constants: { RECON_HEADINGS, RECON_FACTIONS, RECON_WORLD_M },
};

// The tactical icon, in chevrons, nose +y: a short pod, a long straight wing, two booms back to a wide tailplane. The right
// half; the left mirrors it. layers/recon.ts fills it on the map, chrome/icons.ts in the Asset row.
const HALF: [number, number][] = [[0, 0.6], [0.07, 0.48], [0.08, 0.3], [0.7, 0.24], [0.7, 0.1], [0.28, 0.08], [0.28, -0.46], [0.34, -0.46], [0.34, -0.6], [0, -0.6], [0, -0.46], [0.2, -0.46], [0.2, 0.08], [0.08, 0.06], [0.06, -0.14], [0, -0.2]];
export const RECON_OUTLINE: [number, number][] = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];

export interface ReconInFlight extends LevelFlight {
  side: SideId;
  size: number;
  /** Shot down: it falls onto its shadow, then fades; no band, no icon. */
  lost: boolean;
  opacity: number;
}

type ReconView = EffectView & { side: SideId; craft: NonNullable<EffectView['craft']> };

export function reconInFlight(e: ReconView, exaggeration = RECON_EXAGGERATION): ReconInFlight {
  const { height, opacity } = e.lost ? downed(e.left, DEFAULT_TUNE.barrageContactSeconds) : { height: 1, opacity: 1 };
  return { ...levelFlight(e.craft, e.side, RECON_HEADINGS, CRUISE_ALTITUDE_M * height), side: e.side, size: RECON_WORLD_M * exaggeration, lost: !!e.lost, opacity };
}

export interface BandStep {
  from: Vec2;
  to: Vec2;
  width: number;
  opacity: number;
}

/** A pass as the band needs it: where it starts, its unit direction and how wide it looks. */
export interface Pass {
  from: Vec2;
  fx: number;
  fy: number;
  width: number;
}

/** The pass of a Recon Plane's effect and how far along it the aircraft is; null in the enemy's view (only the caller's carries the pass). */
export function passOf(e: EffectView): (Pass & { flown: number }) | null {
  if (!e.craft || !e.from || !e.line) return null;
  return { from: e.from, fx: e.craft.fx, fy: e.craft.fy, width: e.line.width, flown: Math.hypot(e.craft.x - e.from.x, e.craft.y - e.from.y) };
}

/**
 * The sweep band on the ground of `pass`, with the aircraft `headM` along it: each cell it has crossed, strongest where it
 * is now and fading to nothing where it was BAND.seconds ago. `sweptM` is how far the look reached: short of `headM` once
 * the aircraft is gone (off the far end, or shot down), when `headM` runs on as the time since, so what is left fades out.
 */
export function sweepBand(pass: Pass, headM: number, sweptM = headM): BandStep[] {
  const reach = BAND.seconds * DEFAULT_TUNE.reconSpeedMps;
  const at = (d: number) => ({ x: pass.from.x + pass.fx * d, y: pass.from.y + pass.fy * d });
  const out: BandStep[] = [];
  for (let a = Math.max(0, Math.floor((headM - reach) / BAND.cellM) * BAND.cellM); a < Math.min(headM, sweptM); a += BAND.cellM) {
    const b = Math.min(a + BAND.cellM, headM, sweptM);
    const opacity = BAND.opacity * (1 - (headM - (a + b) / 2) / reach);
    if (opacity > 0) out.push({ from: at(a), to: at(b), width: pass.width, opacity });
  }
  return out;
}

/** Every Recon Plane in the air in `effects`, the enemy's included (the sky rule). */
export const reconsInFlight = (effects: EffectView[] | undefined) => (effects ?? []).flatMap((e) => (e.asset === 'recon' && e.side && e.craft ? [{ ...reconInFlight({ ...e, side: e.side, craft: e.craft }), e }] : []));
