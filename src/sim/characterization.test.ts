/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { bake, KALTENBACH } from '../../scripts/bakes';
import { TEST_FIELD } from '../maps/test-field';
import { commanderView, createMatch, stateHash, step } from './index';
import { DEFAULT_TUNE } from './tune';
import { SIDES, type Command, type MapData, type Tune } from './types';

// #183: a characterization net for refactors that must not change behaviour. Each run records, every `EVERY` ticks for `TICKS`
// ticks, the `stateHash` and running digests of the events and of both Sides' `commanderView`. `test:replay` proves
// determinism across engines; this proves a refactor kept the Match the same. Re-baseline only in a commit that means to move it
// (#183's step 8 moves `state` alone; `events` and `views` stay).

const TICKS = 2400;
const EVERY = 100;

/** FNV-1a over a string's UTF-16 code units, folded into `h`. */
const fnv = (h: number, s: string) => {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const hex = (h: number) => h.toString(16).padStart(8, '0');

interface Run {
  map: MapData;
  seed: number;
  squadsPerSide: number;
  tune?: Partial<Tune>;
  log?: Command[];
}

/** The field with every Vehicle kind on: the test field's tank, jeeps, helicopter, jet and AA a Side, and each Side's lent aircraft called early (cooldowns cut so they fly within the run), an EMP over the middle and a Strike on each Side's vehicles; the heavy Assets ungated (no keystone needed). */
const FIELD_TUNE: Partial<Tune> = { missileGated: false, gunshipCooldownSeconds: 20, droneCooldownSeconds: 15, reconCooldownSeconds: 10, empCooldownSeconds: 30, barrageCooldownSeconds: 40, missileCooldownSeconds: 50 };
const FIELD_LOG: Command[] = [
  { tick: 10, side: 'nato', kind: 'order', squad: 0, point: 'B' },
  { tick: 220, side: 'nato', kind: 'asset', asset: 'recon', at: { x: 60, y: -100 }, to: { x: 60, y: 100 } },
  { tick: 260, side: 'pact', kind: 'asset', asset: 'recon', at: { x: -60, y: 100 }, to: { x: -60, y: -100 } },
  { tick: 320, side: 'nato', kind: 'asset', asset: 'drone', at: { x: 90, y: 0 } },
  { tick: 450, side: 'nato', kind: 'asset', asset: 'gunship', at: { x: 40, y: 0 } },
  { tick: 520, side: 'pact', kind: 'asset', asset: 'gunship', at: { x: -40, y: 0 } },
  { tick: 640, side: 'pact', kind: 'asset', asset: 'drone', at: { x: -90, y: 0 } },
  { tick: 700, side: 'nato', kind: 'asset', asset: 'emp', at: { x: 20, y: 0 } },
  { tick: 900, side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 120, y: 0 } },
  { tick: 1100, side: 'pact', kind: 'asset', asset: 'missile', at: { x: -150, y: 0 } },
  { tick: 1300, side: 'pact', kind: 'asset', asset: 'emp', at: { x: -20, y: 0 } },
  { tick: 1500, side: 'nato', kind: 'asset', asset: 'gunship', at: { x: 0, y: 150 } },
  { tick: 1700, side: 'pact', kind: 'asset', asset: 'recon', at: { x: -40, y: -150 }, to: { x: 40, y: -150 } },
  { tick: 1800, side: 'nato', kind: 'asset', asset: 'drone', at: { x: 60, y: -120 } },
];

const RUNS: Record<string, Run> = {
  'field seed 1': { map: TEST_FIELD, seed: 1, squadsPerSide: 4, tune: FIELD_TUNE, log: FIELD_LOG },
  'field seed 7': { map: TEST_FIELD, seed: 7, squadsPerSide: 4, tune: FIELD_TUNE, log: FIELD_LOG },
  'kaltenbach seed 3': { map: KALTENBACH, seed: 3, squadsPerSide: 4 },
  'auental seed 42': { map: bake('auental'), seed: 42, squadsPerSide: 8 },
};

/** Steps `run` for `TICKS` ticks; every `EVERY` ticks, the state hash and the event and view digests so far, and the Commands the Simulation refused. */
function record(run: Run) {
  const m = createMatch({ seed: run.seed, map: run.map, tune: { ...DEFAULT_TUNE, ...run.tune }, squadsPerSide: run.squadsPerSide, commanderSide: 'nato' });
  const out = { kinds: [...new Set(m.vehicles.map((v) => v.kind))].sort(), state: [] as string[], events: [] as string[], views: [] as string[], rejected: [] as string[] };
  let events = 2166136261;
  let views = 2166136261;
  for (let i = 0; i < TICKS; i++) {
    const tick = m.tick;
    const ev = step(m, (run.log ?? []).filter((c) => c.tick === tick));
    events = fnv(events, `${tick}${JSON.stringify(ev)}`);
    for (const side of SIDES) views = fnv(views, JSON.stringify(commanderView(m, side)));
    for (const e of ev) if (e.kind === 'rejected') out.rejected.push(`${tick} ${e.side} ${e.command.kind === 'asset' ? e.command.asset : e.command.kind}: ${e.reason}`);
    if (m.tick % EVERY === 0) {
      out.state.push(`${m.tick} ${stateHash(m)}`);
      out.events.push(`${m.tick} ${hex(events)}`);
      out.views.push(`${m.tick} ${hex(views)}`);
    }
  }
  return out;
}

describe('#183 characterization: the Match a refactor must keep', () => {
  for (const [name, run] of Object.entries(RUNS))
    it(name, { timeout: 120_000 }, () => {
      const r = record(run);
      if (run.log) {
        expect(r.kinds, 'every Vehicle kind is on the field').toEqual(['aa', 'drone', 'gunship', 'helicopter', 'jeep', 'jet', 'recon', 'tank']);
        expect(r.rejected, 'every call is carried out').toEqual([]);
      }
      expect({ state: r.state, events: r.events, views: r.views }).toMatchSnapshot();
    });
});
