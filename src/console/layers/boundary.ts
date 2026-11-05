// The Play Area's boundary as a signed distance field in a texture, so the map shader can draw an edge, a cream line and the
// out-of-bounds dimming at a constant screen width at any zoom.
import type { Vec2 } from '../../sim/types';
import { insidePolygon } from '../../sim/geometry';

/** Texture bytes per metre of distance: 128 is the edge, outside is above, and it clamps at +-32 m. */
export const SDF_PER_M = 4;

/** `res` x `res` bytes covering `sizeM` metres centred on the origin, row 0 at the south edge (y up). */
export function boundarySdf(poly: Vec2[], sizeM: number, res: number): Uint8Array {
  const out = new Uint8Array(res * res);
  const px = sizeM / res;
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const x = -sizeM / 2 + (i + 0.5) * px;
      const y = -sizeM / 2 + (j + 0.5) * px;
      let d2 = Infinity;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const p = poly[a]!, q = poly[b]!;
        const ex = q.x - p.x, ey = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (y - p.y) * ey) / (ex * ex + ey * ey)));
        d2 = Math.min(d2, (x - p.x - t * ex) ** 2 + (y - p.y - t * ey) ** 2);
      }
      const d = insidePolygon(poly, x, y) ? -Math.sqrt(d2) : Math.sqrt(d2);
      out[j * res + i] = Math.max(0, Math.min(255, Math.round(128 + d * SDF_PER_M)));
    }
  return out;
}
