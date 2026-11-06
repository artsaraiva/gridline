import { describe, expect, it } from 'vitest';
import { cursorReadout, drainLine, dtg, edgeLine, endSummary, latlon, mgrs, orderLine, radioLine, requestLine, selectionMarks, squadTag } from './summary';
import type { CommanderView, MapGrid, MatchResult, SideId, SimEvent, SquadView } from '../sim/types';

function ended(side: SideId, result: MatchResult, tickets: Record<SideId, number>, seconds: number): CommanderView {
  return { side, tick: seconds * 20, seconds, friendlies: [], contacts: [], squads: [], points: [], tickets, result };
}

describe('end summary', () => {
  it("a Warsaw Pact Commander wins when the Pact does, and sees their own Tickets first", () => {
    const s = endSummary(ended('pact', { winner: 'pact', reason: 'tickets' }, { nato: 0, pact: 37 }, 754.95));
    expect(s).toEqual({
      result: 'VICTORY',
      reason: 'NATO Tickets ran out',
      friendly: { faction: 'Warsaw Pact', tickets: 37 },
      enemy: { faction: 'NATO', tickets: 0 },
      time: '12:34',
    });
  });

  it('a NATO Commander loses when the Pact wins', () => {
    const s = endSummary(ended('nato', { winner: 'pact', reason: 'tickets' }, { nato: 0, pact: 12 }, 61));
    expect(s.result).toBe('DEFEAT');
    expect(s.reason).toBe('NATO Tickets ran out');
    expect(s.friendly).toEqual({ faction: 'NATO', tickets: 0 });
  });

  it('equal Tickets at the 25 min cap is a draw', () => {
    const s = endSummary(ended('nato', { winner: null, reason: 'time' }, { nato: 40, pact: 40 }, 1500));
    expect(s.result).toBe('DRAW');
    expect(s.reason).toBe('Time ran out');
    expect(s.time).toBe('25:00');
  });
});

describe('Order line and Squad tag', () => {
  const view = { points: [{ id: 'C', name: 'C' }] } as CommanderView;
  const squad = (extra: Partial<SquadView> = {}): SquadView => ({ id: 0, name: 'Bravo', size: 4, strength: 3, respawnIn: [7.2], redeployIn: null, ...extra });

  it('the Order line names the verb, the point and what delays it', () => {
    expect(orderLine(squad(), view)).toBe('NO ORDER');
    expect(orderLine(squad({ order: { point: 'C', state: 'pending' } }), view)).toBe('ORDER SENT · C');
    expect(orderLine(squad({ order: { point: null, state: 'pending' } }), view)).toBe('CLEAR SENT');
    expect(orderLine(squad({ order: { point: 'C', state: 'following' } }), view)).toBe('TAKE C');
    expect(orderLine(squad({ order: { point: 'C', state: 'holding' } }), view)).toBe('HOLD C');
    expect(orderLine(squad({ order: { point: 'C', state: 'delayed', reason: 'resupply' } }), view)).toBe('RESUPPLYING · ORDER C');
  });

  it('the Squad tag shows name, strength with respawn timers, task, Order state and alerts', () => {
    expect(squadTag(squad({ task: 'move', order: { point: 'C', state: 'delayed', reason: 'retreat' } }), true)).toBe('BRAVO 3/4 +8 · MOVE · DELAYED · SUPPRESSED');
    expect(squadTag(squad({ respawnIn: [] }), false)).toBe('BRAVO 3/4');
    expect(squadTag(squad({ respawnIn: [], takingFire: true }), false)).toBe('BRAVO 3/4 · TAKING FIRE');
    expect(squadTag(squad({ respawnIn: [], takingFire: true }), true)).toBe('BRAVO 3/4 · SUPPRESSED');
  });
});

describe('radio log line', () => {
  const view = { ...ended('nato', null as never, { nato: 1, pact: 1 }, 0), squads: [{ id: 3, name: 'Bravo' } as SquadView] };
  const say = (type: string, side: SideId = 'nato', squad: number | null = 3): SimEvent => ({ kind: 'radio', side, squad, type, text: 'x', grid: 'E5', priority: 1 });

  it('names the Squad, keeps the grid and marks bad news', () => {
    expect(radioLine(say('contact'), view)).toEqual({ from: 'BRAVO', text: 'x', grid: 'E5', squad: 3, bad: false, request: false, onAir: true });
    for (const bad of ['mandown', 'wiped', 'lost', 'fire']) expect(radioLine(say(bad), view)!.bad).toBe(true);
  });

  it('a Request is marked, for the amber line', () => {
    expect(radioLine(say('request'), view)).toMatchObject({ request: true, bad: false, grid: 'E5' });
    expect(radioLine(say('contact'), view)!.request).toBe(false);
  });

  it('a wiped Squad is reported by the net, a rejected Command by HQ, and the other Side is never shown', () => {
    expect(radioLine(say('wiped'), view)!.from).toBe('NET');
    expect(radioLine(say('asset', 'nato', null), view)!.from).toBe('NET');
    expect(radioLine({ kind: 'rejected', side: 'nato', command: { tick: 0, side: 'nato', kind: 'order', squad: 9, point: null }, reason: 'unknown squad' }, view)).toMatchObject({ from: 'HQ', bad: true, onAir: false });
    expect(radioLine(say('contact', 'pact'), view)).toBeNull();
  });
});

describe('Request line', () => {
  it('names the Asset, the grid and the seconds left', () => {
    expect(requestLine({ asset: 'barrage', at: { x: 0, y: 0 }, grid: 'E5', left: 23.2 })).toBe('FIRE SUPPORT · E5 · 00:24');
    expect(requestLine({ asset: 'supply', at: { x: 0, y: 0 }, grid: null, left: 5 })).toBe('SUPPLIES · 00:05');
  });
});

describe('Rails score drain, HUD readouts and edge hugging', () => {
  const grid: MapGrid = { cols: 13, rows: 13, squareM: 960 / 13, letters: 'ABCDEFGHIJKLM' };

  it('the drain line shows point counts and even drain or the losing Side interval', () => {
    const base = ended('nato', null as never, { nato: 150, pact: 150 }, 0);
    const pt = (id: string, owner: SideId | null) => ({ id, name: id, x: 0, y: 0, radius: 25, owner, progress: 0 });
    expect(drainLine({ ...base, points: [pt('A', 'nato'), pt('B', null), pt('E', 'pact')] })).toBe('Points 1–1 · even drain');
    expect(drainLine({ ...base, points: [pt('A', 'nato'), pt('B', 'nato'), pt('E', 'pact')] })).toBe('Points 2–1 · Warsaw Pact −1 / 6 s');
    expect(drainLine({ ...base, points: [pt('A', 'pact'), pt('B', 'pact'), pt('E', 'pact')] })).toBe('Points 0–3 · NATO −1 / 2.5 s');
  });

  it('formats MGRS, corner lat/long, date-time group and cursor readout from the selected Squad', () => {
    expect(mgrs({ x: 0, y: 0 })).toBe('32U NB 6720 1895');
    expect(latlon({ x: 0, y: 0 })).toBe('50°43\'07"N 009°57\'07"E');
    expect(dtg(0)).toBe('UAV-2 // FEED 04 · NORTH-UP · 04103200Z NOV 34');

    const view: CommanderView = {
      ...ended('nato', null as never, { nato: 150, pact: 150 }, 0),
      squads: [
        { id: 0, name: 'Alpha', size: 4, strength: 4, respawnIn: [], redeployIn: null },
        { id: 1, name: 'Bravo', size: 4, strength: 4, respawnIn: [], redeployIn: null },
      ],
      friendlies: [
        { id: 0, squad: 0, x: -100, y: 0, fx: 1, fy: 0, state: 'alive', suppressed: false },
        { id: 1, squad: 1, x: 0, y: -100, fx: 0, fy: 1, state: 'alive', suppressed: false },
      ],
    };
    expect(cursorReadout(null, view, grid, 1)).toBe('Cursor off map');
    expect(cursorReadout({ x: 0, y: 0 }, view, grid, 1)).toBe('G7 · 32U NB 6720 1895 · 000° 100 m from Bravo');
    expect(cursorReadout({ x: 0, y: 0 }, view, grid, null)).toBe('G7 · 32U NB 6720 1895 · 090° 100 m from Alpha');
  });

  it('places edge labels on one straight line along the first clear edge and drops labels behind deep panels', () => {
    const screen = { w: 1366, h: 768 };
    const rail = { left: 16, top: 16, right: 264, bottom: 320 };
    const radio = { left: 16, top: 610, right: 486, bottom: 752 };
    const leftAt = edgeLine([rail, radio], 'left', 300, [100, 450, 680], screen);
    expect(leftAt(100)).toBe(264);
    expect(leftAt(450)).toBe(264);
    expect(leftAt(680)).toBeNull();

    const topAt = edgeLine([rail, radio], 'top', 140, [100, 400, 800], screen);
    expect(topAt(100)).toBeNull();
    expect(topAt(400)).toBe(0);
    expect(topAt(800)).toBe(0);
  });
});

describe('selection marks (#71)', () => {
  const base = ended('nato', null as never, { nato: 150, pact: 150 }, 0);
  const soldier = (id: number, squad: number, state: 'alive' | 'wounded' = 'alive') => ({ id, squad, x: 0, y: 0, fx: 1, fy: 0, state, suppressed: false });
  const view: CommanderView = {
    ...base,
    squads: [
      { id: 0, name: 'Alpha', size: 4, strength: 3, respawnIn: [], redeployIn: null, leader: 0 },
      { id: 1, name: 'Bravo', size: 4, strength: 2, respawnIn: [], redeployIn: null, leader: null },
    ],
    friendlies: [soldier(0, 0, 'wounded'), soldier(1, 0), soldier(2, 0), soldier(4, 1), soldier(5, 1)],
  };

  it('marks every present member of the selected Squad, Wounded included, and its leader', () => {
    expect(selectionMarks(view, 0)).toEqual({ members: [0, 1, 2], leader: 0 });
  });

  it('marks no leader for a leaderless Squad and nothing with no selection', () => {
    expect(selectionMarks(view, 1)).toEqual({ members: [4, 5], leader: null });
    expect(selectionMarks(view, null)).toEqual({ members: [], leader: null });
  });
});
