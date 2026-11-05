/// <reference types="node" />
// The committed Kaltenbach bake as MapData, read from disk for the balance runner and tests (the Console fetches it instead).
import { readFileSync } from 'node:fs';
import { terrainOf } from '../src/maps/load';
import type { BakedMap } from '../src/maps/baked';
import { DEFAULT_TUNE } from '../src/sim/tune';

const dir = new URL('../public/maps/kaltenbach/', import.meta.url);
const meta: BakedMap = JSON.parse(readFileSync(new URL('map.json', dir), 'utf8'));
export const KALTENBACH: BakedMap = { ...meta, terrain: terrainOf(meta, new Uint8Array(readFileSync(new URL(meta.data.cover, dir))), DEFAULT_TUNE.cellM) };
