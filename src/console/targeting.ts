// Targeting: the Console's arm / preview / confirm state machine for Assets. No DOM here: input.ts feeds it pointer
// moves and taps, chrome/assets.ts arms and confirms, layers/effects.ts draws the preview from it.
// Arm an Asset, and its preview ring follows the pointer; a tap pins the ring, a second tap on the same spot (or Confirm)
// calls the Asset there; arming it again, Cancel or Esc disarms. Squad selection and Orders (#36) join this module.
import { insidePolygon } from '../sim/geometry';
import { DEFAULT_TUNE } from '../sim/tune';
import { enemyOf, type AssetKind, type Vec2 } from '../sim/types';
import { session } from './session';

export const targeting = {
  armed: null as AssetKind | null,
  /** Where the pointer is over the map, in metres; null when it is off the map. */
  pointer: null as Vec2 | null,
  /** The pinned target spot; null until the first tap. */
  spot: null as Vec2 | null,
};

export function disarm() {
  targeting.armed = null;
  targeting.spot = null;
}

/** Arms `asset`, or disarms when it is the one already armed. */
export function arm(asset: AssetKind) {
  if (targeting.armed === asset) return disarm();
  targeting.armed = asset;
  targeting.spot = null;
}

export const hover = (p: Vec2 | null) => (targeting.pointer = p);

/** Assets land anywhere inside the Play Area except on the enemy HQ (the Simulation rejects the rest). */
export function validSpot(p: Vec2): boolean {
  const map = session.host?.map;
  if (!map || !insidePolygon(map.playArea, p.x, p.y)) return false;
  const hq = map.hqs[enemyOf(session.commanderSide)];
  const r = hq.radius ?? DEFAULT_TUNE.hqRadius;
  return (p.x - hq.x) ** 2 + (p.y - hq.y) ** 2 >= r * r;
}

/** Called after an Asset is confirmed (the feed throws a static burst). */
export const confirmed: (() => void)[] = [];

/** Calls the armed Asset on the pinned spot. */
export function confirm() {
  const { armed, spot } = targeting;
  if (!armed || !spot) return;
  session.host?.send({ side: session.commanderSide, kind: 'asset', asset: armed, at: spot });
  disarm();
  for (const f of confirmed) f();
}

/** A tap on the map at `p`; within `sameM` metres of the pinned spot counts as the same spot. */
export function tap(p: Vec2, sameM: number) {
  const { armed, spot } = targeting;
  if (!armed || !validSpot(p)) return;
  if (spot && (p.x - spot.x) ** 2 + (p.y - spot.y) ** 2 <= sameM * sameM) return confirm();
  targeting.spot = p;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MARGIN = 8; // from the screen edge
const GAP = 14; // from the ring

/**
 * Top-left corner, in screen px, of the map Confirm button for the ring at `ring` (centre and radius in px): below the
 * ring, else above, right, then left, the first that is fully on screen and clear of `panels`; else below, clamped.
 */
export function placeConfirm(ring: { x: number; y: number; r: number }, size: { w: number; h: number }, screen: { w: number; h: number }, panels: Box[]): Vec2 {
  const { w, h } = size;
  const spots = [
    { x: ring.x - w / 2, y: ring.y + ring.r + GAP },
    { x: ring.x - w / 2, y: ring.y - ring.r - GAP - h },
    { x: ring.x + ring.r + GAP, y: ring.y - h / 2 },
    { x: ring.x - ring.r - GAP - w, y: ring.y - h / 2 },
  ];
  const onScreen = (s: Vec2) => s.x >= MARGIN && s.y >= MARGIN && s.x + w <= screen.w - MARGIN && s.y + h <= screen.h - MARGIN;
  const clear = (s: Vec2) => !panels.some((p) => overlaps({ left: s.x - 4, top: s.y - 4, right: s.x + w + 4, bottom: s.y + h + 4 }, p));
  const s = spots.find((s) => onScreen(s) && clear(s)) ?? spots[0]!;
  return { x: Math.max(MARGIN, Math.min(screen.w - MARGIN - w, s.x)), y: Math.max(MARGIN, Math.min(screen.h - MARGIN - h, s.y)) };
}

export const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
