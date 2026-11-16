import { describe, expect, it } from 'vitest';
import { ASSET_TABLE } from './asset-table';

describe('the Asset table (#184)', () => {
  it('labels each Asset on the map by its glossary name, but for the three short labels CODING_STANDARDS.md allows', () => {
    const short = Object.entries(ASSET_TABLE).filter(([, e]) => e.label !== e.name);
    expect(short.map(([k, e]) => [k, e.label])).toEqual([['barrage', 'Barrage'], ['missile', 'Missile'], ['beacon', 'Beacon']]);
  });
});
