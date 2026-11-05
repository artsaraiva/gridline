import { describe, expect, it } from 'vitest';
import { endSummary } from './summary';
import type { CommanderView, MatchResult, SideId } from '../sim/types';

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
