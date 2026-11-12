import { describe, expect, it } from 'vitest';
import { awardLine, cursorReadout, drainingSide, endSummary, leaderOf, orderLine, orderState, radioLine, requestLine } from './summary';
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
      score: { total: 0, rows: [{ label: 'Scan UAV', points: 0 }, { label: 'Supply Drop', points: 0 }, { label: 'Artillery Barrage', points: 0 }, { label: 'Orders', points: 0 }] },
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

  it('shows the Commander Score with a row per category, zero rows included (#72)', () => {
    const view = { ...ended('nato', { winner: 'nato', reason: 'time' }, { nato: 40, pact: 30 }, 1500), score: { total: 365.52, uav: 50, supply: 15.52, artillery: 300, orders: 0 } }; // #74: Supply earns fractions, shown whole
    expect(endSummary(view).score).toEqual({
      total: 366,
      rows: [
        { label: 'Scan UAV', points: 50 },
        { label: 'Supply Drop', points: 16 },
        { label: 'Artillery Barrage', points: 300 },
        { label: 'Orders', points: 0 },
      ],
    });
    expect(endSummary(ended('nato', { winner: 'nato', reason: 'time' }, { nato: 40, pact: 30 }, 1500)).score.total).toBe(0);
  });
});

describe('contribution message (#72)', () => {
  const view = ended('nato', null as never, { nato: 1, pact: 1 }, 0);
  const award = (side: SideId): SimEvent => ({ kind: 'award', side, category: 'artillery', points: 100, reason: 'Barrage kill' });

  it('shows the points and the reason for an own-Side award, nothing for the enemy or other events', () => {
    expect(awardLine(award('nato'), view)).toBe('+100 · Barrage kill');
    expect(awardLine({ kind: 'award', side: 'nato', category: 'supply', points: 15.52, reason: 'Supply Drop resupplied Alpha' }, view)).toBe('+16 · Supply Drop resupplied Alpha'); // #74: Supply points are fractional
    expect(awardLine(award('pact'), view)).toBeNull();
    expect(awardLine({ kind: 'impact', side: 'nato', x: 0, y: 0, asset: 'barrage' }, view)).toBeNull();
  });
});

describe('Order line and Squad tag', () => {
  const view = { points: [{ id: 'C', name: 'C' }] } as CommanderView;
  const squad = (extra: Partial<SquadView> = {}): SquadView => ({ id: 0, name: 'Bravo', size: 4, strength: 3, respawnIn: [7.2], redeployIn: null, ...extra });

  it('the Order line names the verb and the point; the Order state names what delays it', () => {
    expect(orderLine(squad(), view)).toBeNull();
    expect(orderLine(squad({ order: { point: 'C', state: 'pending' } }), view)).toBe('ORDER C');
    expect(orderLine(squad({ order: { point: null, state: 'pending' } }), view)).toBe('CLEAR SENT');
    expect(orderLine(squad({ order: { point: 'C', state: 'following' } }), view)).toBe('TAKE C');
    expect(orderLine(squad({ order: { point: 'C', state: 'holding' } }), view)).toBe('HOLD C');
    expect(orderLine(squad({ order: { point: 'C', state: 'delayed', reason: 'resupply' } }), view)).toBe('ORDER C');
    expect(orderState({ point: 'C', state: 'following' })).toBe('FOLLOWING');
    expect(orderState({ point: 'C', state: 'delayed', reason: 'resupply' })).toBe('RESUPPLYING');
    expect(orderState({ point: 'C', state: 'delayed', reason: 'retreat' })).toBe('RETREATING');
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
    expect(radioLine(say('lost', 'nato', null), view)).toMatchObject({ from: 'NET', bad: true }); // #85: a lost Point is the net's
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

describe('Draining Side', () => {
  it('is the Side holding fewer Capture Points, or null when they hold the same', () => {
    const base = ended('nato', null as never, { nato: 150, pact: 150 }, 0);
    const pt = (id: string, owner: SideId | null) => ({ id, name: id, x: 0, y: 0, radius: 25, owner, progress: 0 });
    expect(drainingSide({ ...base, points: [pt('A', 'nato'), pt('B', null), pt('E', 'pact')] })).toBeNull();
    expect(drainingSide({ ...base, points: [pt('A', 'nato'), pt('B', 'nato'), pt('E', 'pact')] })).toBe('pact');
    expect(drainingSide({ ...base, points: [pt('A', 'pact'), pt('B', null), pt('E', 'pact')] })).toBe('nato');
  });
});

describe('Cursor readout', () => {
  const grid: MapGrid = { cols: 13, rows: 13, squareM: 960 / 13, letters: 'ABCDEFGHIJKLM' };

  it('gives the grid, with bearing and range from the selected Squad if there is one, and nothing off the map', () => {
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
    expect(cursorReadout(null, view, grid, 1)).toBe('');
    expect(cursorReadout({ x: 0, y: 0 }, view, grid, 1)).toBe('G7 · 000° 100 m from Bravo');
    expect(cursorReadout({ x: 0, y: 0 }, view, grid, null)).toBe('G7');
  });
});

describe('Squad Leader lookup (#71)', () => {
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

  it('leaderOf finds the Squad Leader among the friendlies, Wounded or not, and nothing for a leaderless Squad', () => {
    expect(leaderOf(view, view.squads[0]!)).toBe(view.friendlies[0]);
    expect(leaderOf(view, view.squads[1]!)).toBeUndefined();
  });
});
