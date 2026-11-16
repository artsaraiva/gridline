/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { KALTENBACH } from '../../scripts/bakes';
import { devTune } from '../host/dev-tune';
import { TEST_FIELD } from '../maps/test-field';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { ASSET_KINDS, SIDES, type AssetKind, type Command, type MapData, type RequestKind, type SideId } from './types';

// #182, temporary: the characterization net for the Asset effects refactor (steps 3 to 6 must reproduce the fixture exactly;
// step 7 deletes this test and its fixture). Every Asset kind is called by both Sides in three rounds, with the cooldowns at
// zero and the heavy Assets' gate open, as the DEV review tune has them (host/dev-tune.ts). Each run records, every `EVERY`
// ticks for two minutes, the `stateHash` and running digests of the events and of both Sides' `commanderView` (the views are
// what step 6 must keep), and how many Requests of each kind an Asset answered (what step 5 must keep).

const TICKS = 2400; // two minutes at 20 Hz
const EVERY = 20;

/** FNV-1a over a string's UTF-16 code units, folded into `h`. */
const fnv = (h: number, s: string) => {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const hex = (h: number) => h.toString(16).padStart(8, '0');

/**
 * Three rounds of calls: each Side calls every kind in ASSET_KINDS order, a kind every 25 ticks, NATO 12 ticks ahead of the
 * Warsaw Pact. The spot is a Capture Point (each Side starting on a different one), a line's second tap the next point along.
 * The later rounds find some still at work: a second Gunship call retasks it, a second beacon replaces the first, and a drone or
 * Recon Plane still out is refused ("in the air"), which the events record.
 */
function callLog(map: MapData): Command[] {
  const pts = map.points;
  const log: Command[] = [];
  for (const [round, base] of [40, 900, 1700].entries())
    for (const [s, side] of SIDES.entries())
      ASSET_KINDS.forEach((asset, i) => {
        const tick = base + i * 25 + (side === 'nato' ? 0 : 12);
        const at = pts[(i + s + round) % pts.length]!;
        const to = pts[(i + s + round + 1) % pts.length]!;
        if (asset === 'rapid') log.push({ tick, side, kind: 'asset', asset });
        else log.push({ tick, side, kind: 'asset', asset, at: { x: at.x, y: at.y }, ...(['smoke', 'creep', 'recon'].includes(asset) && { to: { x: to.x, y: to.y } }) });
      });
  return log.sort((a, b) => a.tick - b.tick);
}

/** Requests of `m` that closed this tick before their time ran out, with the Squad still standing: an Asset answered them. */
function answeredNow(m: Match, before: ({ asset: RequestKind; until: number } | null)[], into: Record<RequestKind, number>) {
  m.squads.forEach((sq, i) => {
    const r = before[i];
    if (r && !sq.request && m.tick - 1 < r.until && m.soldiers.some((s) => s.squad === sq.id && s.state !== 'dead')) into[r.asset]++;
  });
}

/**
 * Each Side's Commander answers a Request the tick after it is made, at its grid: a Supply Drop for supplies, and in turn a
 * Barrage or a Drone Strike for fire support and a Scan UAV or a Recon Plane (across, northwards) for recon, so every kind that
 * answers a Request gets to.
 */
function answers(m: Match, done: Set<string>, turn: Record<SideId, number>): Command[] {
  const out: Command[] = [];
  for (const sq of m.squads) {
    const r = sq.request;
    if (!r || done.has(`${sq.id}:${r.until}`)) continue;
    done.add(`${sq.id}:${r.until}`);
    const n = turn[sq.side]++;
    const asset: AssetKind = r.asset === 'supply' ? 'supply' : r.asset === 'barrage' ? (n % 2 ? 'drone' : 'barrage') : n % 2 ? 'recon' : 'scan';
    out.push({ tick: m.tick, side: sq.side, kind: 'asset', asset, at: { ...r.at }, ...(asset === 'recon' && { to: { x: r.at.x, y: r.at.y - 50 } }) });
  }
  return out;
}

function record(map: MapData, seed: number) {
  // ammo 35 rather than 210, so Squads run low and Request supplies within the two minutes
  const m = createMatch({ seed, map, tune: { ...devTune(true), ammo: 35 }, squadsPerSide: 6, commanderSide: 'nato' });
  const log = callLog(map);
  const out = { state: [] as string[], events: [] as string[], views: [] as string[], answered: { scan: 0, supply: 0, barrage: 0 } as Record<RequestKind, number>, called: {} as Partial<Record<AssetKind, number>>, rejected: [] as string[] };
  let events = 2166136261;
  let views = 2166136261;
  const done = new Set<string>();
  const turn: Record<SideId, number> = { nato: 0, pact: 0 };
  for (let i = 0; i < TICKS; i++) {
    const tick = m.tick;
    const before = m.squads.map((sq) => sq.request && { asset: sq.request.asset, until: sq.request.until });
    const calls = [...log.filter((c) => c.tick === tick), ...answers(m, done, turn)];
    log.push(...calls.filter((c) => c.tick === tick && !log.includes(c)));
    const ev = step(m, calls);
    answeredNow(m, before, out.answered);
    events = fnv(events, `${tick}${JSON.stringify(ev)}`);
    for (const side of SIDES) views = fnv(views, JSON.stringify(commanderView(m, side as SideId)));
    for (const e of ev) if (e.kind === 'rejected' && e.command.kind === 'asset') out.rejected.push(`${tick} ${e.side} ${e.command.asset}: ${e.reason}`);
    for (const c of log) if (c.tick === tick && c.kind === 'asset' && !ev.some((e) => e.kind === 'rejected' && e.command === c)) out.called[c.asset] = (out.called[c.asset] ?? 0) + 1;
    if (m.tick % EVERY === 0) {
      out.state.push(`${m.tick} ${stateHash(m)}`);
      out.events.push(`${m.tick} ${hex(events)}`);
      out.views.push(`${m.tick} ${hex(views)}`);
    }
  }
  return out;
}

const RUNS: [string, MapData, number][] = [
  ['field seed 1', TEST_FIELD, 1],
  ['field seed 2', TEST_FIELD, 2],
  ['field seed 3', TEST_FIELD, 3],
  ['kaltenbach seed 1', KALTENBACH, 1],
  ['kaltenbach seed 2', KALTENBACH, 2],
  ['kaltenbach seed 3', KALTENBACH, 3],
];

describe('#182 characterization net (temporary): every Asset kind at work, the Match steps 3 to 6 must keep', () => {
  it('reproduces the fixture', { timeout: 300_000 }, async () => {
    const all = Object.fromEntries(RUNS.map(([name, map, seed]) => [name, record(map, seed)]));
    for (const [name, r] of Object.entries(all)) expect(Object.keys(r.called).sort(), `${name}: every kind is carried out`).toEqual([...ASSET_KINDS].sort());
    await expect(`${JSON.stringify(all, null, 1)}\n`).toMatchFileSnapshot('./effects-net.json');
  });
});
