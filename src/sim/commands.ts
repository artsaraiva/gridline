// Command handling: each kind is checked, then applied; a Command that fails its check becomes a `rejected` SimEvent.
// Orders are #36's, Assets #37's: each fills in its own kind's check and apply.
import type { Match } from './index';
import type { Command, SimEvent } from './types';

type Of<K extends Command['kind']> = Extract<Command, { kind: K }>;

interface Handler<C extends Command> {
  /** Why the Command can't be carried out, or null when it can. */
  check(m: Match, c: C): string | null;
  apply(m: Match, c: C, events: SimEvent[]): void;
}

const order: Handler<Of<'order'>> = {
  check: (m, c) =>
    m.squads[c.squad]?.side !== c.side ? 'unknown squad'
    : c.point !== null && !m.points.some((p) => p.id === c.point) ? 'unknown point'
    : null,
  apply: () => {}, // not acted on yet (#36)
};

const asset: Handler<Of<'asset'>> = {
  check: () => null,
  apply: () => {}, // not acted on yet (#37)
};

const handlers: { [K in Command['kind']]: Handler<Of<K>> } = { order, asset };

export function applyCommands(m: Match, commands: Command[], events: SimEvent[]) {
  for (const c of commands) {
    const h = handlers[c.kind] as Handler<Command>;
    const reason = h.check(m, c);
    if (reason) events.push({ kind: 'rejected', side: c.side, command: c, reason });
    else h.apply(m, c, events);
  }
}
