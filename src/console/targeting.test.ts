import { beforeEach, describe, expect, it } from 'vitest';
import type { SimHost } from '../host/host';
import type { UnstampedCommand } from '../host/protocol';
import { TEST_FIELD } from '../maps/test-field';
import { session } from './session';
import { arm, confirm, disarm, placeConfirm, tap, targeting } from './targeting';

// The Sim host is the boundary: a fake one records what the Console sends.
let sent: UnstampedCommand[];
beforeEach(() => {
  sent = [];
  session.host = { map: TEST_FIELD, send: (c: UnstampedCommand) => sent.push(c) } as unknown as SimHost;
  session.commanderSide = 'nato';
  disarm();
});

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
