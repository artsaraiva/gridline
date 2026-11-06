import { gridRef } from '../sim/grid-ref';
import { DEFAULT_TUNE } from '../sim/tune';
import { enemyOf, type CommanderView, type MapGrid, type SideId, type SimEvent, type SquadView, type Vec2 } from '../sim/types';
import type { Box } from './targeting';

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

const REQUEST_WORDS = { supply: 'SUPPLIES', barrage: 'FIRE SUPPORT', scan: 'RECON' };

/** The open Request on a Squad card: "FIRE SUPPORT · E5 · 0:24". */
export const requestLine = (r: NonNullable<SquadView['request']>) => [REQUEST_WORDS[r.asset], r.grid, clock(Math.ceil(r.left))].filter(Boolean).join(' · ');

/** A Squad's alert: SUPPRESSED (some member is) outranks TAKING FIRE. */
export const squadAlert = (q: SquadView, suppressed: boolean) => (suppressed ? 'SUPPRESSED' : q.takingFire ? 'TAKING FIRE' : null);

/** "ALPHA 3/4 +7 · MOVE · FOLLOWING · SUPPRESSED" */
export function squadTag(q: SquadView, suppressed: boolean): string {
  const parts = [`${q.name.toUpperCase()} ${q.strength}/${q.size}${q.respawnIn.map((s) => (s > 0 ? ` +${Math.ceil(s)}` : ' +--')).join('')}`];
  if (q.task) parts.push(q.task.toUpperCase());
  if (q.order) parts.push(q.order.state.toUpperCase());
  const alert = squadAlert(q, suppressed);
  if (alert) parts.push(alert);
  return parts.join(' · ');
}

const BAD_NEWS = new Set(['mandown', 'wiped', 'lost', 'fire']);

/** One line of the radio log: who says it, what, where (a Grid Reference) and whether it is bad news. Null for events that are not for the log. */
export function radioLine(e: SimEvent, view: CommanderView): { from: string; text: string; grid: string | null; squad: number | null; bad: boolean; request: boolean; onAir: boolean } | null {
  if (e.side !== view.side) return null;
  if (e.kind === 'rejected') return { from: 'HQ', text: `${e.command.kind} rejected, ${e.reason}`, grid: null, squad: null, bad: true, request: false, onAir: false };
  if (e.kind !== 'radio') return null;
  // a wiped Squad can't speak: the net reports it
  const from = e.squad === null || e.type === 'wiped' ? 'NET' : (view.squads.find((q) => q.id === e.squad)?.name ?? '').toUpperCase();
  return { from, text: e.text, grid: e.grid ?? null, squad: e.squad, bad: BAD_NEWS.has(e.type), request: e.type === 'request', onAir: true };
}

/** Score block drain line: "Points 1–1 · even drain" or "Points 2–1 · Warsaw Pact −1 / 8 s". */
export function drainLine(view: CommanderView): string {
  const us = view.side;
  const them = enemyOf(us);
  const ourPts = view.points.filter((p) => p.owner === us).length;
  const theirPts = view.points.filter((p) => p.owner === them).length;
  const lead = ourPts - theirPts;
  if (lead === 0) return `Points ${ourPts}–${theirPts} · even drain`;
  const sec = DEFAULT_TUNE.drainSeconds[Math.min(Math.abs(lead), DEFAULT_TUNE.drainSeconds.length) - 1]!;
  return `Points ${ourPts}–${theirPts} · ${lead > 0 ? FACTION[them] : FACTION[us]} −1 / ${sec} s`;
}

export const GEO = { E0: 567200, N0: 5618950, lat0: 50.7185, lon0: 9.952, mLat: 111244, mLon: 70539, conv: 0.74, decl: 4.5 };

const pad4 = (v: number) => String(Math.round(v) % 10000).padStart(4, '0');

export const mgrs = (p: Vec2) =>
  `32U NB ${pad4(((((GEO.E0 + p.x) % 100000) + 100000) % 100000) / 10)} ${pad4(((((GEO.N0 + p.y) % 100000) + 100000) % 100000) / 10)}`;

function dms(v: number, pos: string, neg: string, degW: number) {
  const h = v >= 0 ? pos : neg;
  let sec = Math.round(Math.abs(v) * 3600);
  const d = Math.floor(sec / 3600);
  sec %= 3600;
  const m = Math.floor(sec / 60);
  return `${String(d).padStart(degW, '0')}°${String(m).padStart(2, '0')}'${String(sec % 60).padStart(2, '0')}"${h}`;
}

export const latlon = (p: Vec2) => `${dms(GEO.lat0 + p.y / GEO.mLat, 'N', 'S', 2)} ${dms(GEO.lon0 + p.x / GEO.mLon, 'E', 'W', 3)}`;

export function dtg(ms = 0) {
  const d = new Date(Date.UTC(2034, 10, 4, 10, 32, 0) + ms);
  const p2 = (v: number) => String(v).padStart(2, '0');
  return `UAV-2 // FEED 04 · NORTH-UP · ${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z NOV 34`;
}

/** Centroid of living (else wounded) members of `squadId`, or null when wiped. */
export function squadCentroid(view: CommanderView, squadId: number): Vec2 | null {
  const alive = view.friendlies.filter((f) => f.squad === squadId && f.state === 'alive');
  const men = alive.length ? alive : view.friendlies.filter((f) => f.squad === squadId);
  if (!men.length) return null;
  let x = 0;
  let y = 0;
  for (const m of men) {
    x += m.x;
    y += m.y;
  }
  return { x: x / men.length, y: y / men.length };
}

/**
 * #71: which Soldiers carry the selection marker (every present member of the selected Squad, Wounded or not) and which
 * one the Squad Leader marker (null while the Squad has no leader, or nothing is selected).
 */
export function selectionMarks(view: CommanderView, selectedId: number | null): { members: number[]; leader: number | null } {
  const q = view.squads.find((s) => s.id === selectedId);
  if (!q) return { members: [], leader: null };
  return { members: view.friendlies.filter((f) => f.squad === q.id).map((f) => f.id), leader: q.leader ?? null };
}

/** Bottom-centre cursor readout: grid · MGRS · bearing and range from the selected Squad. */
export function cursorReadout(pointer: Vec2 | null, view: CommanderView, grid: MapGrid | undefined, selectedId: number | null): string {
  if (!pointer) return 'Cursor off map';
  const g = grid ? gridRef(grid, pointer) : '—';
  const sel = view.squads.find((s) => s.id === selectedId) ?? view.squads[0];
  const from = sel ? squadCentroid(view, sel.id) : null;
  if (!sel || !from) return `${g} · ${mgrs(pointer)}`;
  const brg = Math.round(((Math.atan2(pointer.x - from.x, pointer.y - from.y) * 180) / Math.PI + 360) % 360) % 360;
  const rng = Math.round(Math.hypot(pointer.x - from.x, pointer.y - from.y));
  return `${g} · ${mgrs(pointer)} · ${String(brg).padStart(3, '0')}° ${rng} m from ${sel.name}`;
}

/** Walks inward from a screen edge past any chrome touching it at `at`; null when the free edge is deeper than `limit`. */
export function hugEdge(rects: Box[], side: 'top' | 'left' | 'bottom' | 'right', at: number, limit: number, screen: { w: number; h: number }): number | null {
  const edge = side === 'top' || side === 'left' ? 0 : side === 'bottom' ? screen.h : screen.w;
  let p = edge;
  let moved = true;
  while (moved) {
    moved = false;
    for (const r of rects) {
      const across = side === 'top' || side === 'bottom' ? r.left - 6 <= at && at <= r.right + 6 : r.top - 6 <= at && at <= r.bottom + 6;
      if (!across) continue;
      if (side === 'top' && r.top <= p + 24 && r.bottom > p) { p = r.bottom; moved = true; }
      if (side === 'left' && r.left <= p + 24 && r.right > p) { p = r.right; moved = true; }
      if (side === 'bottom' && r.bottom >= p - 24 && r.top < p) { p = r.top; moved = true; }
      if (side === 'right' && r.right >= p - 24 && r.left < p) { p = r.left; moved = true; }
    }
  }
  return Math.abs(p - edge) > limit ? null : p;
}

/** Straight line along the first clear edge across `samples`, dropping positions blocked deeper than `limit`. */
export function edgeLine(rects: Box[], side: 'top' | 'left' | 'bottom' | 'right', limit: number, samples: number[], screen: { w: number; h: number }): (at: number) => number | null {
  const deeper = side === 'top' || side === 'left' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  const ps = samples.map((a) => hugEdge(rects, side, a, limit, screen)).filter((p): p is number => p !== null);
  const line = ps.length ? ps.reduce((a, b) => (deeper(a, b) ? a : b)) : null;
  return (at: number) => (hugEdge(rects, side, at, limit, screen) === null ? null : line);
}
