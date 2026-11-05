import { enemyOf, type CommanderView, type SideId, type SquadView } from '../sim/types';

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

/** The Order line: "TAKE CHARLIE", "HOLD CHARLIE", "RETREATING · ORDER CHARLIE", "ORDER SENT · CHARLIE", "NO ORDER". */
export function orderLine(q: SquadView, view: CommanderView): string {
  const o = q.order;
  if (!o) return 'NO ORDER';
  const name = (view.points.find((p) => p.id === o.point)?.name ?? '').toUpperCase();
  if (o.state === 'pending') return o.point ? `ORDER SENT · ${name}` : 'CLEAR SENT';
  if (o.state === 'delayed') return `${o.reason === 'resupply' ? 'RESUPPLYING' : 'RETREATING'} · ORDER ${name}`;
  return `${o.state === 'following' ? 'TAKE' : 'HOLD'} ${name}`;
}

/** "ALPHA 3/4 +7 · MOVE · FOLLOWING · SUPPRESSED" */
export function squadTag(q: SquadView, suppressed: boolean): string {
  const parts = [`${q.name.toUpperCase()} ${q.strength}/${q.size}${q.respawnIn.map((s) => (s > 0 ? ` +${Math.ceil(s)}` : ' +--')).join('')}`];
  if (q.task) parts.push(q.task.toUpperCase());
  if (q.order) parts.push(q.order.state.toUpperCase());
  if (suppressed) parts.push('SUPPRESSED');
  return parts.join(' · ');
}
