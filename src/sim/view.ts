// What a Commander sees: the CommanderView built from the Match.
import { assetContacts, assetViews, effectViews } from './assets/core';
import type { Match } from './index';
import { orderView } from './orders';
import { requestView } from './requests';
import { redeployPoint } from './respawn';
import { scoreView } from './score';
import { contactIds, justSeen, lastKnown } from './memory';
import { lastDeath, membersOf, squadName, stageTicks, vehicleOf, wiped, type Soldier, type Squad } from './state';
import { vehicleViews } from './vehicles';
import type { CommanderView, SideId, SimEvent, SquadView } from './types';

function squadView(m: Match, sq: Squad): SquadView {
  const t = m.tune;
  const members = membersOf(m, sq);
  // seconds until the step that acts at tick `due` has run; 0 once due and still waiting
  const secondsUntil = (due: number) => Math.max(0, due - m.tick + 1) / t.hz;
  const gone = wiped(members);
  return {
    id: sq.id,
    name: squadName(m, sq),
    size: members.length,
    strength: members.filter((s) => s.state === 'alive').length,
    respawnIn: gone ? [] : members.filter((s) => s.state === 'dead').map((s) => secondsUntil(s.deadAt + t.respawnSeconds * t.hz)),
    takingFire: !gone && m.tick - sq.lastHit <= t.takingFireSeconds * t.hz,
    ...(gone && { redeployAt: redeployPoint(m, sq)?.id ?? null }),
    redeployIn: gone ? secondsUntil(lastDeath(members) + t.redeploySeconds * t.hz) : null,
    task: sq.task === 'none' ? null : sq.task === 'point' ? (sq.mode === 'hold' ? 'hold' : 'move') : sq.task,
    point: sq.task === 'none' ? null : (m.points[sq.goal]?.id ?? null),
    route: m.map.crossings?.[sq.route]?.id ?? null,
    order: orderView(m, sq),
    request: requestView(m, sq),
    leader: members[0]!.state === 'dead' ? null : members[0]!.id, // #68/#54: the first roster member, for the whole Match
  };
}

export function commanderView(m: Match, side: SideId): CommanderView {
  const stage = stageTicks(m.tune);
  const soldierView = (s: Soldier) => ({ id: s.id, x: s.x, y: s.y, fx: s.fx, fy: s.fy });
  const seen = contactIds(m, side);
  return {
    side,
    tick: m.tick,
    seconds: m.tick / m.tune.hz,
    friendlies: m.soldiers
      .filter((s) => s.side === side && s.state !== 'dead')
      .map((s) => ({ ...soldierView(s), squad: s.squad, state: s.state as 'alive' | 'wounded', suppressed: s.suppression > m.tune.suppressedAt, ammo: s.ammo / m.tune.ammo, ...(s.vehicle >= 0 && { vehicle: s.vehicle }) })),
    contacts: [...new Set([...seen.filter((id) => m.soldiers[id]), ...assetContacts(m, side).map((s) => s.id)])].map((id) => soldierView(m.soldiers[id]!)),
    lastKnown: lastKnown(m, side),
    squads: m.squads.filter((sq) => sq.side === side).map((sq) => squadView(m, sq)),
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    result: m.result,
    assets: assetViews(m, side),
    effects: effectViews(m, side),
    score: scoreView(m, side),
    vehicles: vehicleViews(m, side, new Set(seen)),
  };
}

/**
 * The tick's events a Side's Console may show: all of its own, and an enemy's shot, suppressive fire or Wounding only
 * when that enemy Soldier was in sight (#107: or the vehicle it fires from, as for a main gun impact). Enemy deaths (of the
 * unseen Wounded), Squad Respawns and Redeploys never pass. Call after `step`.
 */
export function commanderEvents(m: Match, side: SideId, events: SimEvent[]): SimEvent[] {
  return events.filter((e) => {
    if (e.side === side) return true;
    if (e.kind === 'shot' || e.kind === 'suppressive') return justSeen(m, side, vehicleOf(m, m.soldiers[e.from]!.vehicle)?.id ?? e.from);
    if (e.kind === 'impact' && e.from !== undefined) return justSeen(m, side, e.from);
    return e.kind === 'wounded' && justSeen(m, side, e.id);
  });
}
