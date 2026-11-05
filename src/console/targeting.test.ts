import { beforeEach, describe, expect, it } from 'vitest';
import type { SimHost } from '../host/host';
import type { UnstampedCommand } from '../host/protocol';
import { TEST_FIELD } from '../maps/test-field';
import { session } from './session';
import type { CommanderView } from '../sim/types';
import { arm, clearOrder, confirm, disarm, escape, placeConfirm, select, tap, targeting } from './targeting';

// The Sim host is the boundary: a fake one records what the Console sends.
let sent: UnstampedCommand[];
beforeEach(() => {
  sent = [];
  session.host = { map: TEST_FIELD, send: (c: UnstampedCommand) => sent.push(c) } as unknown as SimHost;
  session.commanderSide = 'nato';
  session.view = view;
  disarm();
  select(null);
});

// Squad 0 stands (two Soldiers) 100 m west of point B; Squad 1 stands in B's ring.
const soldier = (id: number, squad: number, x: number, y: number) => ({ id, squad, x, y, fx: 1, fy: 0, state: 'alive' as const, suppressed: false });
const view = {
  side: 'nato',
  friendlies: [soldier(0, 0, -100, 0), soldier(1, 0, -102, 3), soldier(2, 1, 10, 5)],
  points: [
    { id: 'A', name: 'A', x: 0, y: 200, radius: 25, owner: null, progress: 0 },
    { id: 'B', name: 'B', x: 0, y: 0, radius: 25, owner: 'nato', progress: 1 },
  ],
} as unknown as CommanderView;

describe('Asset targeting', () => {
  it('the first tap pins the spot, a second tap on the same spot calls the Asset and disarms', () => {
    arm('scan');
    tap({ x: 10, y: 20 }, 5);
    expect(sent).toEqual([]);
    expect(targeting.spot).toEqual({ x: 10, y: 20 });
    tap({ x: 13, y: 20 }, 5);
    expect(sent).toEqual([{ side: 'nato', kind: 'asset', asset: 'scan', at: { x: 10, y: 20 } }]);
    expect(targeting.armed).toBeNull();
  });

  it('a tap elsewhere moves the pin instead', () => {
    arm('scan');
    tap({ x: 10, y: 20 }, 5);
    tap({ x: 50, y: 20 }, 5);
    expect(sent).toEqual([]);
    expect(targeting.spot).toEqual({ x: 50, y: 20 });
  });

  it('Confirm calls it on the pinned spot; with no spot pinned it does nothing', () => {
    arm('scan');
    confirm();
    expect(sent).toEqual([]);
    tap({ x: 10, y: 20 }, 5);
    confirm();
    expect(sent).toHaveLength(1);
    expect(targeting.armed).toBeNull();
  });

  it('a spot outside the Play Area or on the enemy HQ is not pinned', () => {
    arm('scan');
    tap({ x: 0, y: 400 }, 5);
    tap({ x: 277, y: 0 }, 5);
    expect(targeting.spot).toBeNull();
  });

  it('arming the armed Asset again, or disarming, backs out; taps then do nothing', () => {
    arm('scan');
    arm('scan');
    expect(targeting.armed).toBeNull();
    tap({ x: 10, y: 20 }, 5);
    tap({ x: 10, y: 20 }, 5);
    expect(sent).toEqual([]);
  });
});

describe('map Confirm button placement', () => {
  const screen = { w: 1000, h: 800 };
  const size = { w: 100, h: 40 };
  const ring = { x: 500, y: 400, r: 50 };

  it('goes below the ring', () => {
    expect(placeConfirm(ring, size, screen, [])).toEqual({ x: 450, y: 464 });
  });

  it('goes above when below is off screen, then right, then left of the ring when panels block the rest', () => {
    expect(placeConfirm({ ...ring, y: 740 }, size, screen, [])).toEqual({ x: 450, y: 636 });
    const below = { left: 0, top: 460, right: 1000, bottom: 520 };
    const above = { left: 0, top: 290, right: 1000, bottom: 340 };
    expect(placeConfirm(ring, size, screen, [below, above])).toEqual({ x: 564, y: 380 });
    const right = { left: 560, top: 0, right: 700, bottom: 800 };
    expect(placeConfirm(ring, size, screen, [below, above, right])).toEqual({ x: 336, y: 380 });
  });

  it('clamps to the screen when no spot is free', () => {
    const all = { left: 0, top: 0, right: 1000, bottom: 800 };
    expect(placeConfirm({ x: 20, y: 790, r: 50 }, size, screen, [all])).toEqual({ x: 8, y: 752 });
  });
});

describe('Order targeting', () => {
  it('tapping a Squad\'s chevrons selects it; tapping a point then sends its Order, and the Squad stays selected', () => {
    tap({ x: -101, y: 1 }, 5, 6);
    expect(targeting.selected).toBe(0);
    tap({ x: 0, y: 190 }, 5, 6);
    expect(sent).toEqual([{ side: 'nato', kind: 'order', squad: 0, point: 'A' }]);
    expect(targeting.selected).toBe(0);
    tap({ x: 10, y: -10 }, 5, 6); // B's ring, clear of any chevron
    expect(sent.at(-1)).toEqual({ side: 'nato', kind: 'order', squad: 0, point: 'B' });
  });

  it('with no Squad selected a tap on a point does nothing; nor does a tap on empty ground with one selected', () => {
    tap({ x: 0, y: 190 }, 5, 6);
    select(0);
    tap({ x: 300, y: 300 }, 5, 6);
    expect(sent).toEqual([]);
    expect(targeting.selected).toBe(0);
  });

  it('a chevron wins over the point ring it stands in: that taps selects the other Squad instead of ordering', () => {
    select(0);
    tap({ x: 10, y: 5 }, 5, 6);
    expect(sent).toEqual([]);
    expect(targeting.selected).toBe(1);
  });

  it('a tile selects a Squad too, and Clear sends a null Order for it (none selected: nothing)', () => {
    clearOrder();
    expect(sent).toEqual([]);
    select(1);
    clearOrder();
    expect(sent).toEqual([{ side: 'nato', kind: 'order', squad: 1, point: null }]);
  });

  it('an armed Asset takes the taps instead', () => {
    select(0);
    arm('scan');
    tap({ x: 0, y: 190 }, 5, 6);
    expect(sent).toEqual([]);
    expect(targeting.spot).toEqual({ x: 0, y: 190 });
  });

  it('Esc disarms an armed Asset first, then drops the selection', () => {
    select(0);
    arm('scan');
    escape();
    expect([targeting.armed, targeting.selected]).toEqual([null, 0]);
    escape();
    expect(targeting.selected).toBeNull();
  });
});
