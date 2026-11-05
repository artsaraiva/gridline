import { describe, expect, it } from 'vitest';
import { endSummary, orderLine, squadTag } from './summary';
import type { CommanderView, MatchResult, SideId, SquadView } from '../sim/types';

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
  });
});
