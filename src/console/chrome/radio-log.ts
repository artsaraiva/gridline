// A plain radio log (#36): the Commander's own Side's radio lines and rejected Commands, newest at the bottom, the last few
// shown, older ones fading. #38 replaces it with the typed, spam-controlled log.
import type { CommanderView, SimEvent } from '../../sim/types';
import { session } from '../session';

const SHOWN = 5;
const box = document.getElementById('radio')!;

export const resetRadioLog = () => box.replaceChildren();

/** Appends the line for `e` (if it has one) to the log. */
export function logRadio(e: SimEvent, view: CommanderView) {
  let text: string;
  if (e.kind === 'radio' && e.side === session.commanderSide) {
    const from = e.squad === null ? 'NET' : (view.squads.find((q) => q.id === e.squad)?.name ?? '').toUpperCase();
    text = `${from}: ${e.text}${e.grid ? `, grid ${e.grid}` : ''}`;
  } else if (e.kind === 'rejected' && e.side === session.commanderSide) text = `HQ: ${e.command.kind} rejected, ${e.reason}`;
  else return;
  const line = document.createElement('div');
  line.textContent = text;
  box.append(line);
  while (box.childElementCount > SHOWN) box.firstElementChild!.remove();
}

/** The log is shown while a match runs. */
export const showRadioLog = (on: boolean) => (box.hidden = !on);
