import { describe, expect, it } from 'vitest';
import type { EffectView } from '../../sim/types';
import { aloft } from './missile';
import { RECON_EXAGGERATION, RECON_HEADINGS, RECON_SHEET, RECON_WORLD_M, reconsInFlight, sweepBand } from './recon';

/** nato's Recon Plane 400 m into a pass north along x = 200, from 606 m south of the centre. */
const pass: EffectView = { asset: 'recon', x: 200, y: 0, radius: 60, left: 8, total: 12, side: 'nato', from: { x: 200, y: -606 }, line: { to: { x: 200, y: 606 }, width: 120 }, craft: { x: 200, y: -206, fx: 0, fy: 1, turn: 0 } };
/** The enemy's view of it: the aircraft, without its pass. */
const { from: _f, line: _l, ...enemy } = pass;

describe('Recon Plane in flight', () => {
  it('is drawn from its effect, in the enemy\'s view too: its Faction\'s frame flying north, exaggerated, lifted over its shadow', () => {
    const [r] = reconsInFlight([pass]);
    expect(r).toMatchObject({ ...aloft({ x: 200, y: -206 }), side: 'nato', frame: 4, size: RECON_WORLD_M * RECON_EXAGGERATION, lost: false, opacity: 1, shadow: { x: 200, y: -206 } });
    expect(reconsInFlight([{ ...enemy, side: 'pact' }])[0]!.frame).toBe(RECON_HEADINGS + 4);
    expect(RECON_SHEET.frames).toBe(2 * RECON_HEADINGS + 1);
    expect(reconsInFlight([{ ...pass, asset: 'scan' }])).toEqual([]);
  });

  it('shot down, it falls where it was hit and fades', () => {
    const [r] = reconsInFlight([{ ...pass, lost: true, left: 0.4 }]);
    expect(r).toMatchObject({ x: 200, y: -206, lost: true });
    expect(r!.opacity).toBeCloseTo(0.5);
  });
});

describe('sweep band', () => {
  it('lies under the aircraft as wide as it reveals, strongest under it and fading to nothing 240 m behind', () => {
    const band = sweepBand(pass);
    expect(band).toHaveLength(8);
    expect(band[0]).toMatchObject({ to: { x: 200, y: -206 }, from: { x: 200, y: -236 }, width: 120 });
    expect(band.at(-1)!.from.y).toBeCloseTo(-446);
    const o = band.map((b) => b.opacity);
    expect(o[0]).toBeCloseTo(0.3);
    expect(o.every((v, i) => i === 0 || v < o[i - 1]!)).toBe(true);
    expect(o.at(-1)).toBeGreaterThan(0);
  });

  it('never reaches back past the start of the pass; the enemy sees none, nor is there one once it is shot down', () => {
    const young = sweepBand({ ...pass, craft: { ...pass.craft!, y: -561 } }); // 45 m in
    expect(young.map((b) => [b.from.y, b.to.y])).toEqual([[-591, -561], [-606, -591]]);
    expect(sweepBand({ ...enemy, side: 'pact' })).toEqual([]);
    expect(sweepBand({ ...pass, lost: true })).toEqual([]);
  });
});
