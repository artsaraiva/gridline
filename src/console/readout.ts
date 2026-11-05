// The bare text readout: Tickets, clock, Squads and seed. #44's rails replace it.
import type { CommanderView, SquadView } from '../sim/types';
import { session } from './session';
import { clock, FACTION } from './summary';

const readout = document.getElementById('readout')!;

/** "ALPHA ■■■□ +7 +--": living members, then each dead member's respawn timer (-- = waiting for quiet); or the redeploy countdown. */
function squadLine(q: SquadView): string {
  const name = q.name.padEnd(8);
  if (q.redeployIn !== null) return `${name}WIPED · REDEPLOY ${Math.ceil(q.redeployIn)}`;
  const pips = '■'.repeat(q.strength) + '□'.repeat(q.size - q.strength);
  return `${name}${pips} ${q.respawnIn.map((s) => (s > 0 ? `+${Math.ceil(s)}` : '+--')).join(' ')}`.trimEnd();
}

/** Shows the readout for `view`, or hides it between matches. */
export function drawReadout(view: CommanderView | null) {
  readout.hidden = !view;
  if (!view) return;
  const { commanderSide: us, enemySide: them } = session;
  readout.textContent =
    `${FACTION[us]} ${view.tickets[us]}   ${FACTION[them]} ${view.tickets[them]}   ${clock(view.seconds)}` +
    `\n\n${view.squads.map(squadLine).join('\n')}` +
    `\n\nseed ${session.seed}`;
}
