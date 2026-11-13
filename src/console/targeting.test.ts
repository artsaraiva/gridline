import { beforeEach, describe, expect, it } from 'vitest';
import type { SimHost } from '../host/host';
import type { UnstampedCommand } from '../host/protocol';
import { TEST_FIELD } from '../maps/test-field';
import { session } from './session';
import type { CommanderView } from '../sim/types';
import { answer, arm, clearOrder, confirm, disarm, escape, markMode, placeConfirm, ready, select, strip, tap, targeting } from './targeting';

// The Sim host is the boundary: a fake one records what the Console sends.
let sent: UnstampedCommand[];
beforeEach(() => {
  sent = [];
  session.host = { map: TEST_FIELD, send: (c: UnstampedCommand) => sent.push(c) } as unknown as SimHost;
  session.commanderSide = 'nato';
  session.view = view;
  disarm();
  select(null);
  markMode(false);
});

// Squad 0 stands (two Soldiers) 100 m west of point B; Squad 1 stands in B's ring; Squad 8, not Elite (#153), stands in A's ring.
const soldier = (id: number, squad: number, x: number, y: number) => ({ id, squad, x, y, fx: 1, fy: 0, state: 'alive' as const, suppressed: false });
const view = {
  side: 'nato',
  friendlies: [soldier(0, 0, -100, 0), soldier(1, 0, -102, 3), soldier(2, 1, 10, 5), soldier(3, 8, 5, 195)],
  squads: [{ id: 0 }, { id: 1 }],
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

  it('with no Squad selected a tap on a point does nothing; a tap on empty ground drops the selection and sends nothing', () => {
    tap({ x: 0, y: 190 }, 5, 6);
    select(0);
    tap({ x: 300, y: 300 }, 5, 6);
    expect(sent).toEqual([]);
    expect(targeting.selected).toBeNull();
  });

  it('#153: the chevron of a Squad that is not Elite is not a Squad to select: the tap goes to the ring it stands in', () => {
    select(0);
    tap({ x: 5, y: 195 }, 5, 6);
    expect(sent).toEqual([{ side: 'nato', kind: 'order', squad: 0, point: 'A' }]);
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

describe('Answering a Request', () => {
  const ask = (readyIn: number, grid = true) => {
    session.view = {
      ...view,
      result: null,
      assets: [{ asset: 'barrage', readyIn, cooldown: 120, radius: 40 }],
      squads: [{ id: 1, request: { asset: 'barrage', at: grid ? { x: 50, y: 50 } : { x: 277, y: 0 }, grid: 'G6', left: 20 } }],
    } as unknown as CommanderView;
  };

  it('selects the Squad and arms the matching Asset with the ring pinned at the grid; the confirm is still needed', () => {
    ask(0);
    answer(1);
    expect(targeting).toMatchObject({ selected: 1, armed: 'barrage', spot: { x: 50, y: 50 } });
    expect(sent).toEqual([]);
    tap({ x: 52, y: 50 }, 5);
    expect(sent).toEqual([{ side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 50, y: 50 } }]);
  });

  it('an Asset that is cooling down only selects the Squad', () => {
    ask(30);
    answer(1);
    expect(targeting).toMatchObject({ selected: 1, armed: null, spot: null });
  });

  it('#139: with the Barrage cooling down the Drone Strike answers "fire support" instead; with neither ready it only selects', () => {
    ask(30);
    const drone = (readyIn: number, off?: string) => (session.view!.assets as unknown[]).push({ asset: 'drone', readyIn, cooldown: 60, radius: 15, ...(off && { off }) });
    drone(0);
    answer(1);
    expect(targeting).toMatchObject({ selected: 1, armed: 'drone', spot: { x: 50, y: 50 } });
    disarm();
    ask(30);
    drone(0, 'in the air');
    answer(1);
    expect(targeting).toMatchObject({ selected: 1, armed: null });
  });

  it('a Squad with no open Request only selects, and a grid on the enemy HQ arms without pinning', () => {
    ask(0);
    answer(0);
    expect(targeting).toMatchObject({ selected: 0, armed: null });
    ask(0, false);
    answer(1);
    expect(targeting).toMatchObject({ armed: 'barrage', spot: null });
  });
});

describe('Mark (#136)', () => {
  const marked = { ...view, marks: [{ id: 4, x: 300, y: 100, fade: 0.5 }] } as CommanderView;

  it('in Mark mode a tap on the map places a Mark and the mode stays on', () => {
    markMode(true);
    tap({ x: 50, y: 60 }, 5);
    tap({ x: -100, y: 0 }, 5); // on Squad 0: still a Mark, not a selection
    expect(sent).toEqual([
      { side: 'nato', kind: 'mark', at: { x: 50, y: 60 } },
      { side: 'nato', kind: 'mark', at: { x: -100, y: 0 } },
    ]);
    expect(targeting.marking).toBe(true);
    expect(targeting.selected).toBeNull();
  });

  it('in Mark mode a tap on a Mark renews it; out of Mark mode it clears it', () => {
    session.view = marked;
    markMode(true);
    tap({ x: 303, y: 98 }, 5);
    markMode(false);
    tap({ x: 303, y: 98 }, 5);
    expect(sent).toEqual([
      { side: 'nato', kind: 'mark', id: 4, at: { x: 300, y: 100 } },
      { side: 'nato', kind: 'mark', id: 4, at: null },
    ]);
  });

  it('a tap outside the Play Area places nothing', () => {
    markMode(true);
    tap({ x: 9000, y: 0 }, 5);
    expect(sent).toEqual([]);
  });

  it('arming an Asset leaves Mark mode, Mark mode disarms an Asset, and Esc leaves Mark mode before it drops the selection', () => {
    markMode(true);
    arm('scan');
    expect(targeting.marking).toBe(false);
    markMode(true);
    expect(targeting.armed).toBeNull();
    select(0);
    escape();
    expect([targeting.marking, targeting.selected]).toEqual([false, 0]);
  });
});

describe('Line targeting (#138)', () => {
  // The Smoke Screen's row says it is line-shaped: 60 m from the first tap towards the second.
  const SMOKE = { asset: 'smoke', readyIn: 0, cooldown: 90, radius: 7.5, line: { length: 60, width: 15 } };
  beforeEach(() => {
    session.view = { ...view, assets: [SMOKE, { asset: 'scan', readyIn: 0, cooldown: 60, radius: 60 }] } as unknown as CommanderView;
  });

  it('the first tap sets the start, the second the direction, and Confirm calls it with both', () => {
    arm('smoke');
    tap({ x: 10, y: 20 }, 5);
    expect([targeting.spot, targeting.aim, ready()]).toEqual([{ x: 10, y: 20 }, null, false]);
    confirm();
    expect(sent).toEqual([]); // no direction yet
    tap({ x: 10, y: 100 }, 5);
    expect([targeting.spot, targeting.aim, ready()]).toEqual([{ x: 10, y: 20 }, { x: 10, y: 100 }, true]);
    expect(sent).toEqual([]);
    confirm();
    expect(sent).toEqual([{ side: 'nato', kind: 'asset', asset: 'smoke', at: { x: 10, y: 20 }, to: { x: 10, y: 100 } }]);
    expect([targeting.armed, targeting.spot, targeting.aim]).toEqual([null, null, null]);
  });

  it('a second tap on the start is no direction; a third tap moves the direction, and one on it confirms', () => {
    arm('smoke');
    tap({ x: 10, y: 20 }, 5);
    tap({ x: 12, y: 21 }, 5);
    expect(targeting.aim).toBeNull();
    tap({ x: 10, y: 100 }, 5);
    tap({ x: 100, y: 20 }, 5);
    expect([targeting.spot, targeting.aim]).toEqual([{ x: 10, y: 20 }, { x: 100, y: 20 }]);
    tap({ x: 102, y: 21 }, 5);
    expect(sent).toEqual([{ side: 'nato', kind: 'asset', asset: 'smoke', at: { x: 10, y: 20 }, to: { x: 100, y: 20 } }]);
  });

  it('Escape clears the first tap and keeps the Asset armed; again, it disarms', () => {
    arm('smoke');
    tap({ x: 10, y: 20 }, 5);
    tap({ x: 10, y: 100 }, 5);
    escape();
    expect([targeting.armed, targeting.spot, targeting.aim]).toEqual(['smoke', null, null]);
    escape();
    expect(targeting.armed).toBeNull();
  });

  it('the strip runs its length from the start towards the direction, however far the second tap is', () => {
    arm('smoke');
    expect(strip({ x: 50, y: 50 })).toBeNull(); // no start yet
    tap({ x: 10, y: 20 }, 5);
    expect(strip({ x: 10, y: 500 })).toEqual({ from: { x: 10, y: 20 }, to: { x: 10, y: 80 }, width: 15, ok: true });
    tap({ x: 40, y: 60 }, 5);
    expect(strip(null)).toEqual({ from: { x: 10, y: 20 }, to: { x: 46, y: 68 }, width: 15, ok: true }); // the pinned direction: 3-4-5
  });

  it('a direction whose wall leaves the Play Area or crosses the enemy HQ is not taken', () => {
    arm('smoke');
    tap({ x: 0, y: 280 }, 5);
    expect(strip({ x: 0, y: 400 })!.ok).toBe(false);
    tap({ x: 0, y: 400 }, 5); // north, over the edge at y = 298
    expect(targeting.aim).toBeNull();
    arm('smoke');
    arm('smoke');
    tap({ x: 277, y: -50 }, 5); // 50 m south of the enemy HQ (radius 35)
    tap({ x: 277, y: 50 }, 5); // through it: both ends are clear
    expect(targeting.aim).toBeNull();
  });

  it('an Asset that is not line-shaped still takes one tap, and Escape disarms it', () => {
    arm('scan');
    tap({ x: 10, y: 20 }, 5);
    expect(ready()).toBe(true);
    expect(strip(null)).toBeNull();
    escape();
    expect(targeting.armed).toBeNull();
  });

  it('#139: a line that runs across the map (the Recon Plane): the strip spans the Play Area through the start and past each edge, wherever it points', () => {
    session.view = { ...view, assets: [{ asset: 'recon', readyIn: 0, cooldown: 90, radius: 60, line: { length: 0, width: 120, across: true, beyond: 150 } }] } as unknown as CommanderView;
    arm('recon');
    tap({ x: 10, y: 20 }, 5);
    const edge = Math.max(...TEST_FIELD.playArea.map((p) => p.y));
    expect(strip({ x: 10, y: 30 })).toEqual({ from: { x: 10, y: -edge - 150 }, to: { x: 10, y: edge + 150 }, width: 120, ok: true, across: true });
    tap({ x: 10, y: 30 }, 5); // a direction ten metres off is enough
    expect(ready()).toBe(true);
    confirm();
    expect(sent).toEqual([{ side: 'nato', kind: 'asset', asset: 'recon', at: { x: 10, y: 20 }, to: { x: 10, y: 30 } }]);
  });
});
