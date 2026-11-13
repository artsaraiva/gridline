// Targeting: the Console's arm / preview / confirm state machine for Assets. No DOM here: input.ts feeds it pointer
// moves and taps, chrome/assets.ts arms and confirms, layers/effects.ts draws the preview from it.
// Arm an Asset, and its preview ring follows the pointer; a tap pins the ring, a second tap on the same spot (or Confirm)
// calls the Asset there; arming it again, Cancel or Esc disarms. #101: while the Gunship is up its row arms again, and the call moves its focus.
// #138: a line-shaped Asset (its row carries `line`) takes two taps: the start, then the direction; Esc clears the first tap.
// Orders (#36): select a Squad (its tile, or its chevrons on the map), then tap a Capture Point: the Order goes out as a
// Command and the Squad stays selected; Clear sends a null Order. Only the Simulation decides what an Order does.
// Mark (#136): in Mark mode every tap places a Mark, or renews the one tapped; out of it a tap on a Mark clears it. The spec
// says both "tap a Mark to clear it" and "re-tapped" renews it: the mode is what tells them apart.
import { hqHolds, insidePolygon, lineHits } from '../sim/geometry';
import { DEFAULT_TUNE } from '../sim/tune';
import { enemyOf, type AssetKind, type Vec2 } from '../sim/types';
import { session } from './session';
import { eliteSquad } from './summary';

export const targeting = {
  armed: null as AssetKind | null,
  /** Where the pointer is over the map, in metres; null when it is off the map. */
  pointer: null as Vec2 | null,
  /** The pinned target spot; null until the first tap. */
  spot: null as Vec2 | null,
  /** #138: a line-shaped Asset's second tap, the way its line runs from `spot`; null until then. */
  aim: null as Vec2 | null,
  /** The selected friendly Squad's id; null = none. */
  selected: null as number | null,
  /** #136: Mark mode is on. */
  marking: false,
};

export function disarm() {
  targeting.armed = null;
  targeting.spot = targeting.aim = null;
}

/** Arms `asset`, or disarms when it is the one already armed. */
export function arm(asset: AssetKind) {
  if (targeting.armed === asset) return disarm();
  markMode(false);
  targeting.armed = asset;
  targeting.spot = targeting.aim = null;
}

export const hover = (p: Vec2 | null) => (targeting.pointer = p);

export const select = (squad: number | null) => (targeting.selected = squad);

/** #136: enters or leaves Mark mode; entering disarms an armed Asset. */
export function markMode(on: boolean) {
  if (on) disarm();
  targeting.marking = on;
}

/** Esc: disarms an armed Asset (#138: a line-shaped one with its start set loses that first), else leaves Mark mode, else drops the Squad selection. */
export function escape() {
  if (lineOf() && targeting.spot) targeting.spot = targeting.aim = null;
  else if (targeting.armed) disarm();
  else if (targeting.marking) markMode(false);
  else select(null);
}

/**
 * Answers a Squad's open Request (#41): selects the Squad and arms the matching Asset with its ring pinned at the requested
 * grid. The confirm is still the Commander's. An Asset that is cooling down, or a Request that has closed, only selects.
 */
export function answer(squad: number) {
  select(squad);
  const view = session.view;
  const r = view?.squads.find((q) => q.id === squad)?.request;
  if (!view || view.result || !r || view.assets?.find((a) => a.asset === r.asset)?.readyIn !== 0) return;
  markMode(false);
  targeting.armed = r.asset;
  targeting.aim = null;
  targeting.spot = validSpot(r.at) ? { ...r.at } : null;
}

/** Clears the selected Squad's Order. */
export function clearOrder() {
  const { selected } = targeting;
  if (selected !== null) session.host?.send({ side: session.commanderSide, kind: 'order', squad: selected, point: null });
}

const inPlayArea = (p: Vec2) => !!session.host && insidePolygon(session.host.map.playArea, p.x, p.y);

/** Assets land anywhere inside the Play Area except on the enemy HQ (the Simulation rejects the rest). */
export function validSpot(p: Vec2): boolean {
  const map = session.host?.map;
  if (!map || !inPlayArea(p)) return false;
  return !hqHolds(map.hqs[enemyOf(session.commanderSide)], DEFAULT_TUNE.hqRadius, p);
}

/** #138: the armed Asset's line shape, when it is line-shaped. */
const lineOf = () => (targeting.armed && session.view?.assets?.find((a) => a.asset === targeting.armed)?.line) || null;

/**
 * #138: the strip of the armed line-shaped Asset: from the pinned start, its length towards the pinned direction, or towards
 * `pointer` until there is one. `ok` is false where the Simulation would reject it (an end outside the Play Area, or the
 * line across the enemy HQ). Null with no line-shaped Asset armed, no start, or nothing to point at.
 */
export function strip(pointer: Vec2 | null, aim = targeting.aim): { from: Vec2; to: Vec2; width: number; ok: boolean } | null {
  const line = lineOf();
  const from = targeting.spot;
  const toward = aim ?? pointer;
  const map = session.host?.map;
  if (!line || !from || !toward || !map) return null;
  const d = Math.hypot(toward.x - from.x, toward.y - from.y);
  if (!d) return null;
  const to = { x: from.x + ((toward.x - from.x) / d) * line.length, y: from.y + ((toward.y - from.y) / d) * line.length };
  return { from, to, width: line.width, ok: inPlayArea(from) && inPlayArea(to) && !lineHits(map.hqs[enemyOf(session.commanderSide)], DEFAULT_TUNE.hqRadius, from, to) };
}

/** The armed Asset has all it needs for Confirm: its spot, and (#138) a line-shaped one its direction. */
export const ready = () => !!targeting.spot && (!lineOf() || !!targeting.aim);

/** Called after an Asset is confirmed (the feed throws a static burst). */
export const confirmed: (() => void)[] = [];

/** Calls the armed Asset on the pinned spot. */
export function confirm() {
  const { armed, spot, aim } = targeting;
  if (!armed || !spot || !ready()) return;
  session.host?.send({ side: session.commanderSide, kind: 'asset', asset: armed, at: spot, ...(aim && { to: aim }) });
  disarm();
  for (const f of confirmed) f();
}

/**
 * A tap on the map at `p`. With an Asset armed it pins or confirms (within `sameM` metres of the pinned spot is the same
 * spot; #138: a line-shaped Asset pins its start, then its direction, and a tap on the direction confirms). Otherwise a friendly Soldier of an Elite Squad (#153) within `pickM` selects its Squad, a Capture Point (its ring, at
 * least `pickM` wide) gives the selected Squad its Order, and empty ground drops the selection. #136: a Mark within `pickM`
 * is cleared, before anything under it; in Mark mode the tap renews that Mark instead, or places one anywhere in the Play Area.
 */
export function tap(p: Vec2, sameM: number, pickM = sameM) {
  const { armed, spot, aim } = targeting;
  if (armed && spot && lineOf()) {
    const same = (q: Vec2) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= sameM * sameM;
    if (aim && same(aim)) return confirm();
    if (!same(spot) && strip(p, null)?.ok) targeting.aim = p;
    return;
  }
  if (armed) {
    if (!validSpot(p)) return;
    if (spot && (p.x - spot.x) ** 2 + (p.y - spot.y) ** 2 <= sameM * sameM) return confirm();
    targeting.spot = p;
    return;
  }
  const near = (q: Vec2, r: number) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= r * r;
  const view = session.view;
  const side = session.commanderSide;
  const mark = view?.marks?.find((k) => near(k, pickM));
  if (mark) return session.host?.send({ side, kind: 'mark', id: mark.id, at: targeting.marking ? { x: mark.x, y: mark.y } : null });
  if (targeting.marking) return inPlayArea(p) ? session.host?.send({ side, kind: 'mark', at: p }) : undefined;
  const friend = view?.friendlies.find((f) => near(f, pickM) && eliteSquad(view, f.squad));
  if (friend) return select(friend.squad);
  const point = view?.points.find((q) => near(q, Math.max(q.radius, pickM)));
  if (!point) return select(null); // a tap on empty ground drops the selection
  if (targeting.selected !== null) session.host?.send({ side: session.commanderSide, kind: 'order', squad: targeting.selected, point: point.id });
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
