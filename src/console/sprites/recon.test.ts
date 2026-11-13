import { describe, expect, it } from 'vitest';
import type { EffectView } from '../../sim/types';
import { aloft } from './missile';
import { passOf, RECON_EXAGGERATION, RECON_HEADINGS, RECON_SHEET, RECON_WORLD_M, reconsInFlight, sweepBand } from './recon';

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
  const p = passOf(pass)!;

  it('the pass is the caller\'s alone: where it starts, which way it runs, how wide it looks, how far the aircraft is along it', () => {
    expect(p).toEqual({ from: { x: 200, y: -606 }, fx: 0, fy: 1, width: 120, flown: 400 });
    expect(passOf({ ...enemy, side: 'pact' })).toBeNull();
  });

  it('lights the ground the aircraft has crossed, as wide as it reveals, strongest under it and fading over the 6 s (600 m) behind', () => {
    const band = sweepBand(p, 400);
    expect(band).toHaveLength(20); // 20 m cells from the start of the pass
    expect(band[0]).toMatchObject({ from: { x: 200, y: -606 }, to: { x: 200, y: -586 }, width: 120 });
    expect(band.at(-1)).toMatchObject({ from: { x: 200, y: -226 }, to: { x: 200, y: -206 } });
    const o = band.map((b) => b.opacity);
    expect(o.at(-1)).toBeCloseTo(0.3 * (1 - 10 / 600));
    expect(o.every((v, i) => i === 0 || v > o[i - 1]!)).toBe(true);
    expect(sweepBand(p, 1000)[0]!.from.y).toBeCloseTo(-606 + 400); // what it crossed more than 6 s ago is dark again
  });

  it('the cells stay where they are on the ground: as the aircraft flies on each only fades', () => {
    const cell = (headM: number) => sweepBand(p, headM).find((b) => b.from.y === -506)!;
    expect(cell(200)).toMatchObject({ to: { x: 200, y: -486 } });
    expect(cell(400)).toMatchObject({ to: { x: 200, y: -486 } });
    expect(cell(400).opacity).toBeLessThan(cell(200).opacity);
  });

  it('once the aircraft is gone (off the far end, or shot down) nothing new lights: what it crossed fades out and is gone 6 s on', () => {
    const left = sweepBand(p, 700, 400); // 3 s after its look ended 400 m along
    expect(left.at(-1)).toMatchObject({ to: { x: 200, y: -206 } });
    expect(left.at(-1)!.opacity).toBeCloseTo(0.3 * (1 - 310 / 600));
    expect(left[0]!.from.y).toBeCloseTo(-506);
    expect(sweepBand(p, 1000, 400)).toEqual([]);
  });
});
