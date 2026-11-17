import { describe, expect, it } from 'vitest';
import { addAward, FEED_OUT_MS, FEED_WINDOW_MS, type FeedAward, feedLook } from './score-feed';

describe('#72 the score feed: awards that land close together add into one total', () => {
  const kill = (at: number): FeedAward => ({ at, points: 100, reason: 'Barrage kill' });

  it('shows nothing before the first award', () => {
    expect(feedLook([], 0)).toBeNull();
  });

  it('counts the total up to the first award and pops as it lands', () => {
    const list = addAward([], kill(1000));
    expect(feedLook(list, 1000)).toMatchObject({ total: 0, opacity: 1, lift: 0 });
    expect(feedLook(list, 1000)!.scale).toBeGreaterThan(1);
    expect(feedLook(list, 1500)).toMatchObject({ total: 100, scale: 1, lines: [{ reason: 'Barrage kill', times: 1, points: 100 }] });
  });

  it('adds an award that lands inside the window, folding a repeated reason into one line and putting the newest reason first', () => {
    const list = addAward(addAward(addAward([], kill(0)), kill(1200)), { at: 2400, points: 50, reason: 'UAV assist' });
    expect(feedLook(list, 2400)!.total).toBe(200); // counting up from the sum before
    const look = feedLook(list, 3000)!;
    expect(look.total).toBe(250);
    expect(look.lines).toEqual([
      { reason: 'UAV assist', times: 1, points: 50 },
      { reason: 'Barrage kill', times: 2, points: 200 },
    ]);
  });

  it('holds for the window after the last award, then lifts and fades, then is gone', () => {
    const list = addAward([], kill(0));
    expect(feedLook(list, FEED_WINDOW_MS - 1)).toMatchObject({ opacity: 1, lift: 0 });
    const going = feedLook(list, FEED_WINDOW_MS + FEED_OUT_MS / 2)!;
    expect(going.opacity).toBeCloseTo(0.5);
    expect(going.lift).toBeGreaterThan(0);
    expect(feedLook(list, FEED_WINDOW_MS + FEED_OUT_MS)).toBeNull();
  });

  it('starts from zero once the window has closed', () => {
    const list = addAward(addAward([], kill(0)), kill(FEED_WINDOW_MS + 1));
    expect(list).toHaveLength(1);
    expect(feedLook(list, FEED_WINDOW_MS + 1000)!.total).toBe(100);
  });

  it('shows whole points for the fractions a Supply Drop earns', () => {
    const list = addAward([], { at: 0, points: 15.52, reason: 'Supply Drop resupplied Alpha' });
    expect(feedLook(list, 1000)).toMatchObject({ total: 16, lines: [{ points: 16 }] });
  });
});
