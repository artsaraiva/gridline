import { enemyOf, type CommanderView, type SideId } from '../sim/types';

export const FACTION: Record<SideId, string> = { nato: 'NATO', pact: 'Warsaw Pact' };

export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** What the end screen shows, from the chosen Side's point of view. Call only once `view.result` is set. */
export function endSummary(view: CommanderView) {
  const { winner, reason } = view.result!;
  const enemy = enemyOf(view.side);
  const loser = winner && enemyOf(winner);
  return {
    result: winner === null ? 'DRAW' : winner === view.side ? 'VICTORY' : 'DEFEAT',
    reason: reason === 'time' ? 'Time ran out' : loser ? `${FACTION[loser]} Tickets ran out` : "Both Sides' Tickets ran out",
    friendly: { faction: FACTION[view.side], tickets: view.tickets[view.side] },
    enemy: { faction: FACTION[enemy], tickets: view.tickets[enemy] },
    time: clock(view.seconds),
  };
}
