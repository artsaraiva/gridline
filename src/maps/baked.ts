import type { MapData, SideId, Vec2 } from '../sim/types';

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
  points: (MapData['points'][number] & { radius: number })[];
  crossings: { id: string; kind: 'bridge' | 'footbridge' | 'ford'; x: number; y: number; halfWidth: number }[];
  /** Columns A.. west to east, rows 1.. north to south, from the map's north-west corner. */
  grid: { cols: number; rows: number; squareM: number; letters: string };
  /**
   * 1 m top-down data render, row-major, row 0 at the north edge, column 0 at the west edge.
   * `cover`: one byte per cell (ids in `coverIds`); `ground`, `top`: float32 heights in metres,
   * ground without objects and top of whatever is highest.
   */
  data: { cells: number; cellM: number; cover: string; ground: string; top: string; coverIds: Record<string, number> };
  images: {
    /** Play-area bake, largest first, halving down to 1 px: a ready-made mip chain. The 4096 level doubles as the fallback. */
    play: string[];
    /** Low-detail surroundings, centred on the map. */
    outer: { file: string; sizeM: number };
  };
}
