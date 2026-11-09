// Headless AI-vs-AI balance runner: plays whole matches over many seeds and summarises them. Run with `pnpm balance`.
import { KALTENBACH } from './kaltenbach';
import { RIVER_FIELD } from '../src/maps/river-field';
import { TEST_FIELD } from '../src/maps/test-field';
import { commanderView, createMatch, step, SIDES, type MapData, type MatchResult, type SideId, type Tune } from '../src/sim';
import { DEFAULT_TUNE } from '../src/sim/tune';
import { JOBS, type Job } from '../src/sim/heli-jobs';
import { live, PILOT_SEAT } from '../src/sim/vehicles';

export const MAPS: Record<string, MapData> = { kaltenbach: KALTENBACH, river: RIVER_FIELD, test: TEST_FIELD };

export interface MatchSummary {
  seed: number;
  seconds: number;
  winner: SideId | null;
  reason: MatchResult['reason'];
  tickets: Record<SideId, number>;
  picks: Record<string, number>; // times a Squad took up each crossing (a route change on a Squad counts as one pick)
  first: Record<SideId, string[]>; // #120: the Capture Point each Squad took first, by Side
  heliSquads: Record<SideId, number[]>; // #122: the Squad whose Soldier first got aboard each of the Side's helicopters
  zones: Zone[]; // #124: every Landing Zone a helicopter drew, in order
  jobSeconds: Record<SideId, Record<Job, number>>; // #131: seconds each Side's helicopter spent on each job (live, any pilot or none)
  carried: Record<SideId, boolean>; // #131: the Side's helicopter carried a passenger (not crew) at some time
  unpiloted: Record<SideId, number>; // seconds of its `wait` job with no pilot aboard (the rest of `wait` is piloted but idle)
}

const noJobs = (): Record<Job, number> => Object.fromEntries(JOBS.map((j) => [j, 0])) as Record<Job, number>;

/** #124: a helicopter's Landing Zone and the Capture Point it was drawn for. */
export interface Zone {
  side: SideId;
  goal: string;
  x: number;
  y: number;
}

/** #124: Landing Zones this far apart or less count as the same spot. */
export const ZONE_APART_M = 15;

export interface Balance {
  matches: MatchSummary[];
  wins: Record<SideId | 'draw', number>;
  meanSeconds: number;
  meanTickets: Record<SideId, number>;
  picks: Record<string, number>;
  firstPicks: Record<string, number>; // #120: Squads' first Capture Points, all matches
  opening: Record<SideId, number>; // #120: mean number of different points a Side's Squads opened on per match
  heliSquads: Record<SideId, number>; // #122: different Squads a Side's helicopter took its first riders from, across all matches
  zoneSpread: Record<string, { zones: number; apart: number }>; // #124: per goal, the Landing Zones drawn across all matches, and the share of their pairs more than ZONE_APART_M apart
  jobSeconds: Record<SideId, Record<Job, number>>; // #131: mean seconds a match each Side's helicopter spent on each job
  jobMatches: Record<SideId, Record<Job, number>>; // #131: matches in which it spent any time on the job
  carried: Record<SideId, number>; // #131: matches in which it carried a passenger
  unpiloted: Record<SideId, number>; // mean seconds a match of `wait` with no pilot aboard; `jobSeconds.wait` minus this is piloted but idle
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
    const heliSquads: Record<SideId, number[]> = { nato: [], pact: [] };
    const boarded = new Set<number>();
    const zones: Zone[] = [];
    const lastZone = new Map<number, unknown>();
    const jobSeconds = { nato: noJobs(), pact: noJobs() };
    const carried = { nato: false, pact: false };
    const unpiloted = { nato: 0, pact: 0 };
    while (!m.result) {
      step(m, []);
      for (const v of m.vehicles) {
        if (v.kind === 'helicopter' && v.goal >= 0 && v.lz && v.lz !== lastZone.get(v.id)) zones.push({ side: v.side, goal: m.points[v.goal]!.id, x: v.lz.x, y: v.lz.y });
        if (v.kind === 'helicopter') lastZone.set(v.id, v.lz);
        if (v.kind === 'helicopter' && live(v)) {
          jobSeconds[v.side][v.job] += 1 / tune.hz;
          if (v.job === 'wait' && v.seats[PILOT_SEAT]! < 0) unpiloted[v.side] += 1 / tune.hz;
          if (v.seats.some((id) => id >= 0 && !m.soldiers[id]!.crew)) carried[v.side] = true;
        }
        const rider = v.kind === 'helicopter' && !boarded.has(v.id) ? v.seats.find((id) => id >= 0) : undefined;
        if (rider === undefined) continue;
        boarded.add(v.id);
        heliSquads[v.side].push(m.soldiers[rider]!.squad);
      }
      for (const side of SIDES)
        for (const sq of commanderView(m, side).squads) {
          if (sq.route && sq.route !== (last.get(sq.id) ?? null)) picks[sq.route] = (picks[sq.route] ?? 0) + 1;
          last.set(sq.id, sq.route ?? null);
          if (sq.point && !first.has(sq.id)) first.set(sq.id, { side, point: sq.point });
        }
    }
    matches.push({ seed, seconds: m.tick / tune.hz, winner: m.result.winner, reason: m.result.reason, tickets: { ...m.tickets }, picks, first: { nato: [...first.values()].filter((f) => f.side === 'nato').map((f) => f.point), pact: [...first.values()].filter((f) => f.side === 'pact').map((f) => f.point) }, heliSquads, zones, jobSeconds, carried, unpiloted });
  }
  const wins = { nato: 0, pact: 0, draw: 0 };
  const picks: Record<string, number> = {};
  const sum = { nato: 0, pact: 0 };
  const firstPicks: Record<string, number> = {};
  const opened = { nato: 0, pact: 0 };
  const byGoal: Record<string, Zone[]> = {};
  const heli = { nato: new Set<number>(), pact: new Set<number>() };
  for (const r of matches) {
    wins[r.winner ?? 'draw']++;
    for (const side of SIDES) {
      sum[side] += r.tickets[side];
      opened[side] += new Set(r.first[side]).size;
      for (const q of r.heliSquads[side]) heli[side].add(q);
      for (const k of r.first[side]) firstPicks[k] = (firstPicks[k] ?? 0) + 1;
    }
    for (const z of r.zones) (byGoal[z.goal] ??= []).push(z);
    for (const [k, v] of Object.entries(r.picks)) picks[k] = (picks[k] ?? 0) + v;
  }
  const zoneSpread = Object.fromEntries(
    Object.entries(byGoal).map(([goal, zs]) => {
      const pairs = zs.flatMap((a, i) => zs.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
      return [goal, { zones: zs.length, apart: pairs.length ? pairs.filter((d) => d > ZONE_APART_M).length / pairs.length : 1 }];
    }),
  );
  const jobSeconds = { nato: noJobs(), pact: noJobs() };
  const jobMatches = { nato: noJobs(), pact: noJobs() };
  const carried = { nato: 0, pact: 0 };
  const unpiloted = { nato: 0, pact: 0 };
  for (const r of matches)
    for (const side of SIDES) {
      unpiloted[side] += r.unpiloted[side];
      carried[side] += +r.carried[side];
      for (const j of JOBS) [jobSeconds[side][j], jobMatches[side][j]] = [jobSeconds[side][j] + r.jobSeconds[side][j], jobMatches[side][j] + +(r.jobSeconds[side][j] > 0)];
    }
  const n = matches.length || 1;
  for (const side of SIDES) {
    unpiloted[side] /= n;
    for (const j of JOBS) jobSeconds[side][j] /= n;
  }
  return {
    matches,
    wins,
    meanSeconds: matches.reduce((a, r) => a + r.seconds, 0) / n,
    meanTickets: { nato: sum.nato / n, pact: sum.pact / n },
    picks,
    firstPicks,
    opening: { nato: opened.nato / n, pact: opened.pact / n },
    heliSquads: { nato: heli.nato.size, pact: heli.pact.size },
    zoneSpread,
    jobSeconds,
    jobMatches,
    carried,
    unpiloted,
  };
}

const jobs = (j: Record<Job, number>) => JOBS.filter((k) => j[k] >= 0.5).map((k) => `${k} ${j[k].toFixed(0)}`).join('/') || '-';

export function report(b: Balance): string {
  const lines = b.matches.map(
    (r) => `seed ${String(r.seed).padStart(3)}  ${String(Math.round(r.seconds)).padStart(5)} s  ${(r.winner ?? 'draw').padEnd(5)} (${r.reason})  tickets nato ${r.tickets.nato} pact ${r.tickets.pact}  crossings ${JSON.stringify(r.picks)}  first nato ${r.first.nato.join('')} pact ${r.first.pact.join('')}  helicopter riders from Squads nato ${r.heliSquads.nato.join(',') || '-'} pact ${r.heliSquads.pact.join(',') || '-'}  jobs nato ${jobs(r.jobSeconds.nato)} pact ${jobs(r.jobSeconds.pact)}  Landing Zones ${r.zones.map((z) => `${z.side} ${z.goal}(${z.x.toFixed(0)},${z.y.toFixed(0)})`).join(' ') || '-'}`,
  );
  lines.push(
    `--`,
    `matches ${b.matches.length}  mean length ${Math.round(b.meanSeconds)} s`,
    `wins nato ${b.wins.nato}  pact ${b.wins.pact}  draw ${b.wins.draw}`,
    `mean tickets left nato ${b.meanTickets.nato.toFixed(1)}  pact ${b.meanTickets.pact.toFixed(1)}`,
    `crossing picks ${JSON.stringify(b.picks)}`,
    `first points ${JSON.stringify(b.firstPicks)}`,
    `different opening points per match nato ${b.opening.nato.toFixed(2)}  pact ${b.opening.pact.toFixed(2)}`,
    `different Squads the helicopter took its first riders from, all matches: nato ${b.heliSquads.nato}  pact ${b.heliSquads.pact}`,
    ...SIDES.map((side) => `${side} helicopter, mean seconds a match by job (matches with any): ${JOBS.map((j) => `${j} ${b.jobSeconds[side][j].toFixed(0)} (${b.jobMatches[side][j]})`).join('  ')}`),
    ...SIDES.map((side) => `${side} helicopter wait, mean seconds a match: no pilot aboard ${b.unpiloted[side].toFixed(0)}, piloted but idle ${(b.jobSeconds[side].wait - b.unpiloted[side]).toFixed(0)}`),
    `matches in which the helicopter carried a passenger: nato ${b.carried.nato}  pact ${b.carried.pact}  of ${b.matches.length}`,
    ...Object.entries(b.zoneSpread).map(([goal, z]) => `Landing Zones for ${goal}: ${z.zones}, ${(z.apart * 100).toFixed(0)}% of pairs more than ${ZONE_APART_M} m apart`),
    ...b.matches.flatMap((r) => r.zones.map((z) => `Landing Zone seed ${r.seed}: ${z.side} ${z.goal} at ${z.x.toFixed(0)}, ${z.y.toFixed(0)}`)),
  );
  return lines.join('\n');
}
