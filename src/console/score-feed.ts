// The score feed (#72), as Battlefield 4 runs it: awards that land close together add into one running total, a repeated
// reason folds into one line with a count, and after a quiet moment the total lifts away and the next award starts from
// zero. Pure maths, DOM-free so it is testable; chrome/rail.ts draws it.

/** An award still adds to the open total if it lands within this long of the one before. */
export const FEED_WINDOW_MS = 2500;
/** Once the window has run out the total takes this long to lift and fade. */
export const FEED_OUT_MS = 600;
/** The total counts up to each new sum over this long, and pops for a moment as it starts. */
const COUNT_MS = 300;
const POP_MS = 200;
const POP = 0.16;
const LIFT_PX = 24;

export interface FeedAward {
  at: number;
  points: number;
  reason: string;
}

export interface FeedLook {
  /** The total as shown now: counting up from the sum before the newest award. */
  total: number;
  /** The reasons in the open total, the newest first; `times` is how often each landed, `points` their sum. */
  lines: { reason: string; times: number; points: number }[];
  opacity: number;
  /** Px the feed has lifted as it fades. */
  lift: number;
  /** The total's scale: a touch over 1 as an award lands. */
  scale: number;
}

/** Adds an award to `list` (own-Side awards, oldest first), dropping the groups that have closed. Returns `list`. */
export function addAward(list: FeedAward[], award: FeedAward): FeedAward[] {
  const last = list.at(-1);
  if (last && award.at - last.at > FEED_WINDOW_MS) list.length = 0;
  list.push(award);
  return list;
}

/** What the feed shows at `now` ms for the open group `list`; null when there is nothing to show. Whole points (#74: Supply earns fractions). */
export function feedLook(list: FeedAward[], now: number): FeedLook | null {
  const last = list.at(-1);
  if (!last) return null;
  const since = now - last.at;
  if (since < 0 || since >= FEED_WINDOW_MS + FEED_OUT_MS) return null;
  const lines: FeedLook['lines'] = [];
  for (const a of list) {
    const found = lines.findIndex((l) => l.reason === a.reason);
    const line = found < 0 ? { reason: a.reason, times: 0, points: 0 } : lines.splice(found, 1)[0]!;
    lines.unshift({ ...line, times: line.times + 1, points: line.points + a.points });
  }
  const sum = list.reduce((s, a) => s + a.points, 0);
  const before = sum - last.points;
  const out = Math.max(0, (since - FEED_WINDOW_MS) / FEED_OUT_MS);
  return {
    total: Math.round(before + (sum - before) * Math.min(1, since / COUNT_MS)),
    lines: lines.map((l) => ({ ...l, points: Math.round(l.points) })),
    opacity: 1 - out,
    lift: LIFT_PX * out,
    scale: 1 + POP * Math.max(0, 1 - since / POP_MS),
  };
}
