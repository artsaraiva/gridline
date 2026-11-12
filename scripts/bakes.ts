/// <reference types="node" />
// A committed bake as MapData, read from disk for the balance runner, the bench and tests (the Console fetches it instead).
import { readFileSync } from 'node:fs';
import { terrainOf } from '../src/maps/load';
import type { BakedMap } from '../src/maps/baked';
import type { MapId } from '../src/host/protocol';
import { DEFAULT_TUNE } from '../src/sim/tune';

export function bake(id: MapId): BakedMap {
  const dir = new URL(`../public/maps/${id}/`, import.meta.url);
  const meta: BakedMap = JSON.parse(readFileSync(new URL('map.json', dir), 'utf8'));
  return { ...meta, terrain: terrainOf(meta, new Uint8Array(readFileSync(new URL(meta.data.cover, dir))), DEFAULT_TUNE.cellM) };
}

export const KALTENBACH = bake('kaltenbach');
