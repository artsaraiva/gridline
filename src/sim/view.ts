// What a Commander sees: the CommanderView built from the Match.
import { assetContacts, assetViews, effectViews } from './assets/core';
import { isDummy } from './assets/crate';
import { drainEvery, ticketsStart } from './capture';
import type { Match } from './index';
import { orderView } from './orders';
import { requestView } from './requests';
import { redeployBeacon, redeployPoint, redeployTicks, respawnTicks } from './respawn';
import { scoreView } from './score';
import { markViews } from './marks';
import { contactIds, justSeen, lastKnown } from './memory';
import { elite, lastDeath, membersOf, squadName, stageTicks, vehicleOf, wiped, type Soldier, type Squad } from './state';
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
    respawnIn: gone ? [] : members.filter((s) => s.state === 'dead').map((s) => secondsUntil(s.deadAt + respawnTicks(m, sq.side))),
    takingFire: !gone && m.tick - sq.lastHit <= t.takingFireSeconds * t.hz,
    ...(gone && { redeployAt: redeployPoint(m, sq)?.id ?? null, ...(redeployBeacon(m, sq) && { atBeacon: true as const }) }),
    redeployIn: gone ? secondsUntil(lastDeath(members) + redeployTicks(m, sq.side)) : null,
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
  const soldierView = (s: Soldier) => ({ id: s.id, x: s.x, y: s.y, fx: s.fx, fy: s.fy, ...(s.chute && { chute: (m.tick - s.chute.t0) / (s.chute.t1 - s.chute.t0) }) });
  const seen = contactIds(m, side);
  const elites = elite(m);
  return {
    side,
    tick: m.tick,
    seconds: m.tick / m.tune.hz,
    friendlies: m.soldiers
      .filter((s) => s.side === side && s.state !== 'dead')
      .map((s) => ({ ...soldierView(s), squad: s.squad, state: s.state as 'alive' | 'wounded', suppressed: s.suppression > m.tune.suppressedAt, ammo: s.ammo / m.tune.ammo, ...(s.vehicle >= 0 && { vehicle: s.vehicle }) })),
    contacts: [...new Set([...seen.filter((id) => m.soldiers[id]), ...assetContacts(m, side).map((s) => s.id)])].map((id) => soldierView(m.soldiers[id]!)),
    lastKnown: lastKnown(m, side),
    squads: m.squads.filter((sq) => sq.side === side && elites[sq.id]).map((sq) => squadView(m, sq)), // #153: the rest are only `friendlies`
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    ticketsStart: ticketsStart(m),
    drainEvery: drainEvery(m),
    result: m.result,
    assets: assetViews(m, side),
    effects: effectViews(m, side),
    score: scoreView(m, side),
    vehicles: vehicleViews(m, side, new Set(seen)),
    marks: markViews(m, side),
  };
}

/**
 * The tick's events a Side's Console may show: all of its own, and an enemy's shot, suppressive fire or Wounding only
 * when that enemy Soldier was in sight (#107: or the vehicle it fires from, as for a main gun impact; #101 the Gunship's always). Enemy deaths (of the
 * unseen Wounded), Squad Respawns and Redeploys never pass. Call after `step`.
 */
export function commanderEvents(m: Match, side: SideId, events: SimEvent[]): SimEvent[] {
  return events.filter((e) => {
    if (e.kind === 'shot' && isDummy(m, e.from)) return false; // #143: a Feint's fake fire is for enemy ears only; its own Console pulses the dummy from the view
    if (e.side === side) return true;
    if (e.kind === 'shot' || e.kind === 'suppressive') {
      const v = vehicleOf(m, m.soldiers[e.from]!.vehicle);
      return v?.kind === 'gunship' || justSeen(m, side, v?.id ?? e.from); // #101: the Gunship's gun fires from the sky
    }
    if (e.kind === 'impact' && e.from !== undefined) return justSeen(m, side, e.from);
    return e.kind === 'wounded' && justSeen(m, side, e.id);
  });
}
