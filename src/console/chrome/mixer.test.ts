import { describe, expect, it } from 'vitest';
import { DEFAULT_MIX, parseMix } from './mixer';

describe('the kept mix (#85): what the mixer panel reads back from localStorage', () => {
  it('defaults to Radio 80, Combat 60, Chatter 40 and mute off when nothing is kept', () => {
    expect(parseMix(null)).toEqual({ radio: 80, chatter: 40, combat: 60, mute: false });
    expect(DEFAULT_MIX).toEqual(parseMix(null));
  });

  it('reads back what the panel kept', () => {
    const mix = { radio: 55, chatter: 0, combat: 100, mute: true };
    expect(parseMix(JSON.stringify(mix))).toEqual(mix);
  });

  it('a bad or missing value falls back to its default, field by field', () => {
    expect(parseMix('not json')).toEqual(DEFAULT_MIX);
    expect(parseMix('[1, 2, 3]')).toEqual(DEFAULT_MIX);
    expect(parseMix('null')).toEqual(DEFAULT_MIX);
    expect(parseMix(JSON.stringify({ radio: '90', chatter: null, mute: 'yes' }))).toEqual(DEFAULT_MIX);
    expect(parseMix(JSON.stringify({ combat: 25 }))).toEqual({ ...DEFAULT_MIX, combat: 25 });
  });

  it('a level outside 0..100 is clamped, a fraction rounded to the slider step', () => {
    expect(parseMix(JSON.stringify({ radio: -5, chatter: 250, combat: 59.6 }))).toMatchObject({ radio: 0, chatter: 100, combat: 60 });
  });
});
