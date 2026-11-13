// The Recon Plane (#139): its baked sheet (a row a Faction, then the shadow), where it is in its pass, the sweep band under
// it that fades behind, and its fall when the enemy AA shoots it down. layers/recon.ts draws it.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { EffectView, SideId, Vec2 } from '../../sim/types';
import { downed, levelFlight, type LevelFlight } from './level-flight';
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
/** The sweep band reaches this far back from the aircraft, in this many steps, each fainter than the one ahead of it. */
const BAND = { lengthM: 2.4 * DEFAULT_TUNE.reconSpeedMps, steps: 8, opacity: 0.3 }; // the material's opacity curve makes that a faint wash

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
  const { fall, opacity } = e.lost ? downed(e.left, DEFAULT_TUNE.barrageContactSeconds) : { fall: 0, opacity: 1 };
  return { ...levelFlight(e.craft, e.side, RECON_HEADINGS, fall), side: e.side, size: RECON_WORLD_M * exaggeration, lost: !!e.lost, opacity };
}

export interface BandStep {
  from: Vec2;
  to: Vec2;
  width: number;
  opacity: number;
}

/**
 * The sweep band on the ground under the aircraft: `line.width` across, from the aircraft back along the pass (never before
 * its start, `from`), strongest under it and fading to nothing behind. Only the caller's view carries the pass, so only its
 * Console draws the band; none once it is shot down.
 */
export function sweepBand(e: EffectView): BandStep[] {
  if (!e.craft || !e.from || !e.line || e.lost) return [];
  const { x, y, fx, fy } = e.craft;
  const flown = Math.hypot(x - e.from.x, y - e.from.y);
  const step = BAND.lengthM / BAND.steps;
  const out: BandStep[] = [];
  for (let k = 0; k < BAND.steps && k * step < flown; k++) {
    const [a, b] = [k * step, Math.min(flown, (k + 1) * step)];
    out.push({ from: { x: x - fx * b, y: y - fy * b }, to: { x: x - fx * a, y: y - fy * a }, width: e.line.width, opacity: BAND.opacity * (1 - k / BAND.steps) });
  }
  return out;
}

/** Every Recon Plane in the air in `effects`, the enemy's included (the sky rule). */
export const reconsInFlight = (effects: EffectView[] | undefined) => (effects ?? []).flatMap((e) => (e.asset === 'recon' && e.side && e.craft ? [{ ...reconInFlight({ ...e, side: e.side, craft: e.craft }), e }] : []));
