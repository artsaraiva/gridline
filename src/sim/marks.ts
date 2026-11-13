// Mark (#136): a spot the Commander flags as a suspected enemy position, a standing action with no cooldown. Up to `markMax` a Side; each is a spot the
// Side treats as a known enemy position (memory.ts `sideKnown`) and a suppressed Squad's fire goes to (combat.ts), never a Contact.
import { dist2, insidePolygon } from './geometry';
import { los } from './grid';
import { gridRef } from './grid-ref';
import type { Match } from './index';
import { elite, ticksOf, type Mix } from './state';
import { SIDES, type Command, type MarkView, type SideId, type SimEvent } from './types';

export interface Mark {
  id: number; // from 1 within its Side, never reused in a Match
  x: number;
  y: number;
  until: number; // tick it fades out
  checked: number; // ticks in a row a friendly Soldier has stood by it with no enemy in sight there
}

export interface Marks {
  next: Record<SideId, number>; // each Side's next Mark id: its own count, so the ids a Console sees say nothing of the enemy's Marks
  of: Record<SideId, Mark[]>; // oldest first
}

export const newMarks = (): Marks => ({ next: { nato: 1, pact: 1 }, of: { nato: [], pact: [] } });

type MarkCommand = Extract<Command, { kind: 'mark' }>;

/** Why the Mark Command can't be carried out, or null. */
export function checkMark(m: Match, c: MarkCommand): string | null {
  if (c.id !== undefined) return m.marks.of[c.side].some((k) => k.id === c.id) ? null : 'unknown mark';
  if (!c.at) return 'unknown mark';
  return insidePolygon(m.map.playArea, c.at.x, c.at.y) ? null : 'outside the Play Area';
}

/** No `id`: places a Mark at `at`, over the oldest when the Side has `markMax`. With `id`: renews that Mark, or clears it when `at` is null. */
export function applyMark(m: Match, c: MarkCommand) {
  const live = m.marks.of[c.side];
  const until = m.tick + ticksOf(m.tune, m.tune.markSeconds);
  if (c.id === undefined) {
    live.push({ id: m.marks.next[c.side]++, x: c.at!.x, y: c.at!.y, until, checked: 0 });
    if (live.length > m.tune.markMax) live.shift();
  } else if (c.at) live.find((k) => k.id === c.id)!.until = until;
  else m.marks.of[c.side] = live.filter((k) => k.id !== c.id);
}

/**
 * The Marks phase, after perception: a Mark past its time is gone, and so is one a friendly Soldier on foot has stood within
 * `markClearM` of, in line of sight, for `markClearSeconds` with no enemy seen within that radius. Its Squad calls the grid clear;
 * a Squad that is not Elite has no voice (#153), so the Side net calls it for one (the spec has the Callout only).
 */
export function marks(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const r2 = t.markClearM * t.markClearM;
  const elites = elite(m);
  for (const side of SIDES)
    m.marks.of[side] = m.marks.of[side].filter((k) => {
      if (k.until <= m.tick) return false;
      const by = m.soldiers.find((s) => s.side === side && s.state === 'alive' && s.vehicle < 0 && !s.chute && dist2(s, k) <= r2 && los(m, s, k));
      const held = m.sightings[side].some((e) => e.tick === m.tick && dist2(e, k) <= r2);
      k.checked = by && !held ? k.checked + 1 : 0;
      if (!by || k.checked < ticksOf(t, t.markClearSeconds)) return true;
      events.push({ kind: 'radio', side, squad: elites[by.squad] ? by.squad : null, type: 'clear', text: 'clear', ...(m.map.grid && { grid: gridRef(m.map.grid, k) }), priority: 1 });
      return false;
    });
}

/** A Side's own Marks; `fade` runs from 1 (just placed or renewed) to 0. */
export const markViews = (m: Match, side: SideId): MarkView[] =>
  m.marks.of[side].map((k) => ({ id: k.id, x: k.x, y: k.y, fade: (k.until - m.tick) / ticksOf(m.tune, m.tune.markSeconds) }));

export function hashMarks(m: Match, mix: Mix) {
  for (const side of SIDES) {
    mix(m.marks.next[side]);
    mix(m.marks.of[side].length);
    for (const k of m.marks.of[side]) {
      mix(k.id);
      mix(Math.round(k.x * 1000));
      mix(Math.round(k.y * 1000));
      mix(k.until);
      mix(k.checked);
    }
  }
}
