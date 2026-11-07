// Requests (#41): a Squad asks the Commander for an Asset at a Grid Reference. One open Request per Squad; it lives
// `requestSeconds`, then expires, or closes when a matching Asset of the Side has landed near its grid. A Squad asks only
// from what it knows (what it sees, what it heard, its own ammo) and may ask for an Asset that is cooling down.
// The phase draws no random numbers, so replays stay the same.
import { landed } from './assets/crate';
import type { Match } from './index';
import { dist2 } from './geometry';
import { gridCentre, gridRef } from './grid-ref';
import { membersOf, wiped, type Mix, type Squad } from './state';
import type { RequestKind, SideId, SimEvent, SquadView, Vec2 } from './types';

/** An open Request: the Asset it asks for, the centre of the grid square it names, and the tick it expires. */
export interface Request {
  asset: RequestKind;
  at: Vec2;
  until: number;
}

const WORDS: Record<RequestKind, string> = { supply: 'supplies', barrage: 'fire support', scan: 'recon' };
const KINDS: RequestKind[] = ['scan', 'supply', 'barrage'];

/** A matching Asset of `side` has arrived near `at`: the crate has landed, a shell has, the UAV is on station. */
function answered(m: Match, side: SideId, asset: RequestKind, at: Vec2) {
  const r = m.tune.requestCloseM;
  return m.assets.effects.some((e) => e.side === side && e.asset === asset && dist2(e, at) <= r * r && (e.asset === 'supply' ? landed(m, e) : e.asset === 'barrage' ? e.shells!.some((s) => s.done) : true));
}

/** What `sq` needs and where, or null: Fire support when most are suppressed by enemies it sees, Recon when any is under fire it can't place, else Supplies. */
function need(m: Match, sq: Squad): { asset: RequestKind; at: Vec2 } | null {
  const t = m.tune;
  const alive = membersOf(m, sq).filter((s) => s.state === 'alive');
  const L = alive[0];
  if (!L) return null;
  const nearest = (list: { x: number; y: number }[]) => list.reduce((a, c) => (dist2(c, L) < dist2(a, L) ? c : a));
  const pinned = alive.filter((s) => s.suppression > t.suppressedAt).length;
  const seen = sq.memory.filter((c) => c.source === 'seen' && m.tick - c.tick < t.contactSeconds * t.hz);
  if (pinned * 2 > alive.length && seen.length) return { asset: 'barrage', at: nearest(seen) };
  if (pinned && !seen.length) {
    const heard = sq.memory.filter((c) => c.source === 'heard');
    return { asset: 'scan', at: heard.length ? heard.reduce((a, c) => (c.tick > a.tick ? c : a)) : L }; // where the fire came from, else where it lands
  }
  if (alive.filter((s) => s.ammo < t.ammoLow).length * 2 > alive.length) return { asset: 'supply', at: L };
  return null;
}

/** The Request phase: close what has expired or been answered, then let each Squad without one ask. Runs before the radio phase. */
export function requests(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const grid = m.map.grid;
  for (const sq of m.squads) {
    const r = sq.request;
    if (wiped(membersOf(m, sq))) sq.request = null;
    else if (r) {
      if (m.tick < r.until && !answered(m, sq.side, r.asset, r.at)) continue;
      sq.request = null;
      sq.requestNext = m.tick + Math.round(t.requestGapSeconds * t.hz);
    } else if (m.tick >= sq.requestNext) {
      const n = need(m, sq);
      if (!n) continue;
      const at = grid ? gridCentre(grid, gridRef(grid, n.at))! : { x: n.at.x, y: n.at.y };
      if (answered(m, sq.side, n.asset, at)) continue;
      sq.request = { asset: n.asset, at, until: m.tick + Math.round(t.requestSeconds * t.hz) };
      events.push({ kind: 'radio', side: sq.side, squad: sq.id, type: 'request', text: `requesting ${WORDS[n.asset]}`, ...(grid && { grid: gridRef(grid, at) }), priority: 0 });
    }
  }
}

export function requestView(m: Match, sq: Squad): SquadView['request'] {
  const r = sq.request;
  if (!r) return null;
  return { asset: r.asset, at: { ...r.at }, grid: m.map.grid ? gridRef(m.map.grid, r.at) : null, left: Math.max(0, r.until - m.tick) / m.tune.hz };
}

export function hashRequests(m: Match, mix: Mix) {
  for (const sq of m.squads) {
    const r = sq.request;
    mix(r ? KINDS.indexOf(r.asset) + 1 : 0);
    mix(r ? Math.round(r.at.x * 1000) : 0);
    mix(r ? Math.round(r.at.y * 1000) : 0);
    mix(r?.until ?? 0);
    mix(sq.requestNext);
  }
}
