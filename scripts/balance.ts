// Headless AI-vs-AI balance runner: plays whole matches over many seeds and summarises them. Run with `pnpm balance`.
import { KALTENBACH } from './kaltenbach';
import { RIVER_FIELD } from '../src/maps/river-field';
import { TEST_FIELD } from '../src/maps/test-field';
import { commanderView, createMatch, step, SIDES, type MapData, type MatchResult, type SideId, type Tune } from '../src/sim';
import { DEFAULT_TUNE } from '../src/sim/tune';

export const MAPS: Record<string, MapData> = { kaltenbach: KALTENBACH, river: RIVER_FIELD, test: TEST_FIELD };

export interface MatchSummary {
  seed: number;
  seconds: number;
  winner: SideId | null;
  reason: MatchResult['reason'];
  tickets: Record<SideId, number>;
  picks: Record<string, number>; // times a Squad took up each crossing (a route change on a Squad counts as one pick)
  first: Record<SideId, string[]>; // #120: the Capture Point each Squad took first, by Side
}

export interface Balance {
  matches: MatchSummary[];
  wins: Record<SideId | 'draw', number>;
  meanSeconds: number;
  meanTickets: Record<SideId, number>;
  picks: Record<string, number>;
  firstPicks: Record<string, number>; // #120: Squads' first Capture Points, all matches
  opening: Record<SideId, number>; // #120: mean number of different points a Side's Squads opened on per match
}

export function balance(o: { seeds: number; squads: number; map: MapData; tune?: Partial<Tune>; firstSeed?: number }): Balance {
  const tune: Tune = { ...DEFAULT_TUNE, ...o.tune };
  const matches: MatchSummary[] = [];
  for (let i = 0; i < o.seeds; i++) {
    const seed = (o.firstSeed ?? 1) + i;
    const m = createMatch({ seed, map: o.map, tune, squadsPerSide: o.squads, commanderSide: 'nato' });
    const picks: Record<string, number> = {};
    const last = new Map<number, string | null>();
    const first = new Map<number, { side: SideId; point: string }>();
    while (!m.result) {
      step(m, []);
      for (const side of SIDES)
        for (const sq of commanderView(m, side).squads) {
          if (sq.route && sq.route !== (last.get(sq.id) ?? null)) picks[sq.route] = (picks[sq.route] ?? 0) + 1;
          last.set(sq.id, sq.route ?? null);
          if (sq.point && !first.has(sq.id)) first.set(sq.id, { side, point: sq.point });
        }
    }
    matches.push({ seed, seconds: m.tick / tune.hz, winner: m.result.winner, reason: m.result.reason, tickets: { ...m.tickets }, picks, first: { nato: [...first.values()].filter((f) => f.side === 'nato').map((f) => f.point), pact: [...first.values()].filter((f) => f.side === 'pact').map((f) => f.point) } });
  }
  const wins = { nato: 0, pact: 0, draw: 0 };
  const picks: Record<string, number> = {};
  const sum = { nato: 0, pact: 0 };
  const firstPicks: Record<string, number> = {};
  const opened = { nato: 0, pact: 0 };
  for (const r of matches) {
    wins[r.winner ?? 'draw']++;
    for (const side of SIDES) {
      sum[side] += r.tickets[side];
      opened[side] += new Set(r.first[side]).size;
      for (const k of r.first[side]) firstPicks[k] = (firstPicks[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(r.picks)) picks[k] = (picks[k] ?? 0) + v;
  }
  const n = matches.length || 1;
  return {
    matches,
    wins,
    meanSeconds: matches.reduce((a, r) => a + r.seconds, 0) / n,
    meanTickets: { nato: sum.nato / n, pact: sum.pact / n },
    picks,
    firstPicks,
    opening: { nato: opened.nato / n, pact: opened.pact / n },
  };
}

export function report(b: Balance): string {
  const lines = b.matches.map(
    (r) => `seed ${String(r.seed).padStart(3)}  ${String(Math.round(r.seconds)).padStart(5)} s  ${(r.winner ?? 'draw').padEnd(5)} (${r.reason})  tickets nato ${r.tickets.nato} pact ${r.tickets.pact}  crossings ${JSON.stringify(r.picks)}  first nato ${r.first.nato.join('')} pact ${r.first.pact.join('')}`,
  );
  lines.push(
    `--`,
    `matches ${b.matches.length}  mean length ${Math.round(b.meanSeconds)} s`,
    `wins nato ${b.wins.nato}  pact ${b.wins.pact}  draw ${b.wins.draw}`,
    `mean tickets left nato ${b.meanTickets.nato.toFixed(1)}  pact ${b.meanTickets.pact.toFixed(1)}`,
    `crossing picks ${JSON.stringify(b.picks)}`,
    `first points ${JSON.stringify(b.firstPicks)}`,
    `different opening points per match nato ${b.opening.nato.toFixed(2)}  pact ${b.opening.pact.toFixed(2)}`,
  );
  return lines.join('\n');
}
