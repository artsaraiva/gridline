import type { MapData, MapGrid, SideId, Vec2 } from '../sim/types';

/**
 * Metadata a map bake writes next to its images and data grids (`public/maps/<id>/map.json`).
 * The Blender script that writes it is the source of truth (ADR 0001, ADR 0002).
 * Metres, origin at map centre, x east, y north.
 */
export interface BakedMap extends MapData {
  village: string;
  river: string;
  sizeM: number;
  hqs: Record<SideId, Vec2 & { radius: number }>;
  /** `radius` is the per-point override (25 m by default); `owner` is the Side holding the point at the start. */
  points: (MapData['points'][number] & { radius: number; owner: SideId | null })[];
  crossings: { id: string; kind: 'bridge' | 'footbridge' | 'ford'; x: number; y: number; halfWidth: number }[];
  grid: MapGrid;
  /**
   * 1 m top-down data render, row-major, row 0 at the north edge, column 0 at the west edge.
   * `cover`: one byte per cell (ids in `coverIds`); `ground`, `top`: float32 heights in metres,
   * ground without objects and top of whatever is highest, in cells of `heightCellM` metres (`cellM` when absent).
   */
  data: {
    cells: number; cellM: number; cover: string; ground: string; top: string; heightCellM?: number; coverIds: Record<string, number>;
  };
  images: {
    /** Play-area bake, largest first, halving down to 1 px: a ready-made mip chain. The 4096 level doubles as the fallback. */
    play: string[];
    /** Low-detail surroundings, centred on the map. */
    outer: { file: string; sizeM: number };
  };
}
