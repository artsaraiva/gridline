import { describe, expect, it } from 'vitest';
import { chuteScale } from './chute';

describe('#130 chuteScale', () => {
  it('runs evenly from 0.7 to 1 over the descent, and is 1 on the ground', () => {
    expect(chuteScale(0)).toBeCloseTo(0.7);
    expect(chuteScale(0.5)).toBeCloseTo(0.85);
    expect(chuteScale(1)).toBe(1);
    expect(chuteScale(undefined)).toBe(1);
  });
});
