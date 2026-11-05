// What a Commander sees: the CommanderView built from the Match.
import type { Match } from './index';
import { contactIds } from './memory';
import { lastDeath, membersOf, stageTicks, wiped, type Soldier, type Squad } from './state';
import type { CommanderView, SideId, SquadView } from './types';

const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

function squadView(m: Match, sq: Squad, i: number): SquadView {
  const t = m.tune;
  const members = membersOf(m, sq);
  // seconds until the step that acts at tick `due` has run; 0 once due and still waiting
  const secondsUntil = (due: number) => Math.max(0, due - m.tick + 1) / t.hz;
  const gone = wiped(members);
  return {
    id: sq.id,
    name: SQUAD_NAMES[i] ?? `Squad ${i + 1}`,
    size: members.length,
    strength: members.filter((s) => s.state === 'alive').length,
    respawnIn: gone ? [] : members.filter((s) => s.state === 'dead').map((s) => secondsUntil(s.deadAt + t.respawnSeconds * t.hz)),
    redeployIn: gone ? secondsUntil(lastDeath(members) + t.redeploySeconds * t.hz) : null,
  };
}

export function commanderView(m: Match, side: SideId): CommanderView {
  const stage = stageTicks(m.tune);
  const soldierView = (s: Soldier) => ({ id: s.id, x: s.x, y: s.y, fx: s.fx, fy: s.fy });
  return {
    side,
    tick: m.tick,
    seconds: m.tick / m.tune.hz,
    friendlies: m.soldiers
      .filter((s) => s.side === side && s.state !== 'dead')
      .map((s) => ({ ...soldierView(s), squad: s.squad, state: s.state as 'alive' | 'wounded', suppressed: s.suppression > m.tune.suppressedAt })),
    contacts: contactIds(m, side).map((id) => soldierView(m.soldiers[id]!)),
    squads: m.squads.filter((sq) => sq.side === side).map((sq, i) => squadView(m, sq, i)),
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    result: m.result,
  };
}
