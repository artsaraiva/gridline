// Edge-clamped marks (#99): a thing off screen is shown at the edge where its line to `toward` leaves the screen, so
// the Commander sees which way it is coming from. The Cruise Missile uses it, and the jet (#110) and the Gunship (#101).
import type { Vec2 } from '../sim/types';

export interface Clamped extends Vec2 {
  clamped: boolean;
}

/** The part of the screen a mark may sit in, in px: inside the margins (it sits under the chrome panels, as in BF4). */
export interface Inset {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * `p` itself when it is inside `inset`, else where the segment from `toward` to `p` crosses the inset's edge; when
 * `toward` is outside too, the nearest point of the inset to `p`.
 */
export function edgeClamp(p: Vec2, toward: Vec2, { x0, y0, x1, y1 }: Inset): Clamped {
  const inside = (q: Vec2) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
  if (inside(p)) return { x: p.x, y: p.y, clamped: false };
  if (!inside(toward)) return { x: Math.max(x0, Math.min(x1, p.x)), y: Math.max(y0, Math.min(y1, p.y)), clamped: true };
  // Walk from `toward` out to `p`: the first edge the segment reaches bounds the fraction.
  const dx = p.x - toward.x;
  const dy = p.y - toward.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (x1 - toward.x) / dx);
  if (dx < 0) t = Math.min(t, (x0 - toward.x) / dx);
  if (dy > 0) t = Math.min(t, (y1 - toward.y) / dy);
  if (dy < 0) t = Math.min(t, (y0 - toward.y) / dy);
  return { x: toward.x + dx * t, y: toward.y + dy * t, clamped: true };
}
