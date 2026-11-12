import { gridRef } from '../sim/grid-ref';
import { enemyOf, type CommanderView, type FriendlyView, type MapGrid, type SideId, type SimEvent, type SquadView, type Vec2 } from '../sim/types';

export const FACTION: Record<SideId, string> = { nato: 'NATO', pact: 'Warsaw Pact' };

export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** #72: the Commander Score categories in end-screen order, labelled by Asset name (as the rail shows them) or Orders. */
const SCORE_ROWS = [
  ['uav', 'Scan UAV'],
  ['supply', 'Supply Drop'],
  ['artillery', 'Artillery Barrage'],
  ['orders', 'Orders'],
] as const;

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
    score: { total: Math.round(view.score?.total ?? 0), rows: SCORE_ROWS.map(([key, label]) => ({ label, points: Math.round(view.score?.[key] ?? 0) })) }, // #74: Supply earns fractions
  };
}

/** #72: the contribution message for an own-Side award: "+100 · Barrage kill". Null for anything else. Whole points (#74 Supply earns fractions). */
export const awardLine = (e: SimEvent, view: CommanderView) => (e.kind === 'award' && e.side === view.side ? `+${Math.round(e.points)} · ${e.reason}` : null);

/** A Squad's Order as its card button names it: "TAKE C", "HOLD C", "ORDER C" while it is sent or delayed, "CLEAR SENT"; null with no Order. */
export function orderLine(q: SquadView, view: CommanderView): string | null {
  const o = q.order;
  if (!o) return null;
  if (!o.point) return 'CLEAR SENT';
  const name = (view.points.find((p) => p.id === o.point)?.name ?? '').toUpperCase();
  return `${o.state === 'following' ? 'TAKE' : o.state === 'holding' ? 'HOLD' : 'ORDER'} ${name}`;
}

/** What a Squad's Order is doing, for the card's state line: its state, or what delays it. */
export const orderState = (o: NonNullable<SquadView['order']>) => (o.state === 'delayed' ? (o.reason === 'resupply' ? 'RESUPPLYING' : 'RETREATING') : o.state.toUpperCase());

const REQUEST_WORDS = { supply: 'SUPPLIES', barrage: 'FIRE SUPPORT', scan: 'RECON' };

/** The open Request on a Squad card: "FIRE SUPPORT · E5 · 0:24". */
export const requestLine = (r: NonNullable<SquadView['request']>) => [REQUEST_WORDS[r.asset], r.grid, clock(Math.ceil(r.left))].filter(Boolean).join(' · ');

/** A Squad's alert: SUPPRESSED (some member is) outranks TAKING FIRE. */
export const squadAlert = (q: SquadView, suppressed: boolean) => (suppressed ? 'SUPPRESSED' : q.takingFire ? 'TAKING FIRE' : null);

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

/** The Side losing Tickets to the other's Capture Points: the one holding fewer; null when they hold the same. */
export function drainingSide(view: CommanderView): SideId | null {
  const them = enemyOf(view.side);
  const lead = view.points.filter((p) => p.owner === view.side).length - view.points.filter((p) => p.owner === them).length;
  return lead === 0 ? null : lead > 0 ? them : view.side;
}

/** Centroid of living (else wounded) members of `squadId`, or null when wiped; #110 never a jet's pilot, off at its base or in the sky, #101 nor anyone aboard the Gunship. */
export function squadCentroid(view: CommanderView, squadId: number): Vec2 | null {
  const jets = new Set(view.vehicles?.filter((v) => v.kind === 'jet' || v.kind === 'gunship').map((v) => v.id));
  const mine = view.friendlies.filter((f) => f.squad === squadId && !jets.has(f.vehicle ?? -1));
  const alive = mine.filter((f) => f.state === 'alive');
  const men = alive.length ? alive : mine;
  if (!men.length) return null;
  let x = 0;
  let y = 0;
  for (const m of men) {
    x += m.x;
    y += m.y;
  }
  return { x: x / men.length, y: y / men.length };
}

/** #153: the Squad `id` as the view lists it; undefined for a Squad that is not Elite, which the Console never names or selects. */
export const eliteSquad = (view: CommanderView, id: number): SquadView | undefined => view.squads.find((q) => q.id === id);

/** The Squad Leader's FriendlyView (#68: Wounded or not), or undefined while the Squad has none. */
export const leaderOf = (view: CommanderView, q: SquadView): FriendlyView | undefined => view.friendlies.find((f) => f.id === q.leader);

/** Cursor readout: the pointer's Grid Reference, with bearing and range from the selected Squad if there is one; empty off the map. */
export function cursorReadout(pointer: Vec2 | null, view: CommanderView, grid: MapGrid | undefined, selectedId: number | null): string {
  if (!pointer) return '';
  const g = grid ? gridRef(grid, pointer) : '—';
  const sel = view.squads.find((s) => s.id === selectedId);
  const from = sel ? squadCentroid(view, sel.id) : null;
  if (!sel || !from) return g;
  const brg = Math.round(((Math.atan2(pointer.x - from.x, pointer.y - from.y) * 180) / Math.PI + 360) % 360) % 360;
  const rng = Math.round(Math.hypot(pointer.x - from.x, pointer.y - from.y));
  return `${g} · ${String(brg).padStart(3, '0')}° ${rng} m from ${sel.name}`;
}
