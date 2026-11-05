// What a Commander sees: the CommanderView built from the Match.
import { assetContacts, assetViews, effectViews } from './assets/core';
import type { Match } from './index';
import { orderView } from './orders';
import { requestView } from './requests';
import { contactIds, justSeen, lastKnown } from './memory';
import { lastDeath, membersOf, stageTicks, wiped, type Soldier, type Squad } from './state';
import type { CommanderView, SideId, SimEvent, SquadView } from './types';

const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

/** The call sign of `sq`: Alpha, Bravo... in the order of its Side's Squads. */
export const squadName = (m: Match, sq: Squad) => {
  const i = m.squads.filter((o) => o.side === sq.side).indexOf(sq);
  return SQUAD_NAMES[i] ?? `Squad ${i + 1}`;
};

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
    task: sq.task === 'none' ? null : sq.task === 'point' ? (sq.mode === 'hold' ? 'hold' : 'move') : sq.task,
    point: sq.task === 'none' ? null : (m.points[sq.goal]?.id ?? null),
    route: m.map.crossings?.[sq.route]?.id ?? null,
    order: orderView(m, sq),
    request: requestView(m, sq),
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
      .map((s) => ({ ...soldierView(s), squad: s.squad, state: s.state as 'alive' | 'wounded', suppressed: s.suppression > m.tune.suppressedAt, ammo: s.ammo / m.tune.ammo })),
    contacts: [...new Set([...contactIds(m, side), ...assetContacts(m, side).map((s) => s.id)])].map((id) => soldierView(m.soldiers[id]!)),
    lastKnown: lastKnown(m, side),
    squads: m.squads.filter((sq) => sq.side === side).map((sq, i) => squadView(m, sq, i)),
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    result: m.result,
    assets: assetViews(m, side),
    effects: effectViews(m, side),
  };
}

/**
 * The tick's events a Side's Console may show: all of its own, and an enemy's shot or Wounding only when that enemy
 * Soldier was in sight. Enemy deaths (of the unseen Wounded), Squad Respawns and Redeploys never pass. Call after `step`.
 */
export function commanderEvents(m: Match, side: SideId, events: SimEvent[]): SimEvent[] {
  return events.filter((e) => {
    if (e.side === side) return true;
    if (e.kind === 'shot') return justSeen(m, side, e.from);
    return e.kind === 'wounded' && justSeen(m, side, e.id);
  });
}
