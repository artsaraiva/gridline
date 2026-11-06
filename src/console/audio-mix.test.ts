import { afterEach, describe, expect, it } from 'vitest';
import { createMatch, step } from '../sim/index';
import { callName } from '../sim/state';
import { DEFAULT_TUNE } from '../sim/tune';
import type { AssetKind, CommanderView, EffectView, MapData, SimEvent, Tune, Vec2 } from '../sim/types';
import { admit, admitImpact, admitShot, busGain, chatterGap, drawnLoops, inCombat, newGate, release, sourceDrawn, spatialise, TUNING, type VoiceId, voiceFor } from './audio-mix';

const HQ = { x: -415, y: 0 };
const view = (over: Partial<CommanderView> = {}): CommanderView => ({
  side: 'nato',
  tick: 0,
  seconds: 0,
  friendlies: [{ id: 1, squad: 0, x: -60, y: 10, fx: 1, fy: 0, state: 'alive', suppressed: false, ammo: 1 }],
  contacts: [{ id: 20, x: -10, y: 10, fx: -1, fy: 0 }],
  lastKnown: [],
  squads: [{ id: 0, name: 'Alpha', size: 4, strength: 4, respawnIn: [], redeployIn: null, task: null, point: null, route: null, order: null, request: null, leader: 1 }],
  points: [],
  tickets: { nato: 100, pact: 100 },
  result: null,
  effects: [],
  ...over,
});
const effect = (over: Partial<EffectView>): EffectView => ({ asset: 'scan', x: 0, y: 0, radius: 60, left: 10, total: 15, ...over });

// Cases set TUNING knobs; each gets the defaults back so the order of the cases does not matter.
const DEFAULTS = structuredClone(TUNING);
afterEach(() => Object.assign(TUNING, structuredClone(DEFAULTS)));

describe('bus and ducking gains (#84)', () => {
  it('a bus at its level plays at that level; the master mute silences it', () => {
    expect(busGain(0.8, { ducked: false, muted: false })).toBeCloseTo(0.8);
    expect(busGain(0.8, { ducked: false, muted: true })).toBe(0);
  });

  it('a ducked bus drops by TUNING.duckDb: 6 dB is half the amplitude', () => {
    TUNING.duckDb = 6;
    expect(busGain(0.8, { ducked: true, muted: false })).toBeCloseTo(0.4, 2);
  });
});

describe('Chatter gap selection (#84)', () => {
  it('idle: 8 s at the bottom of the draw, 25 s at the top', () => {
    expect(chatterGap(false, () => 0)).toBe(8);
    expect(chatterGap(false, () => 0.999999)).toBeCloseTo(25, 3);
  });

  it('in combat: 3 to 8 s', () => {
    expect(chatterGap(true, () => 0)).toBe(3);
    expect(chatterGap(true, () => 0.5)).toBe(5.5);
  });

  it('a max slid below the min (the audition sliders allow it) gives the min, never a shorter or negative gap', () => {
    TUNING.chatterIdle = [20, 10];
    expect(chatterGap(false, () => 0.5)).toBe(20);
    expect(chatterGap(false, () => 0.999)).toBe(20);
  });
});

describe('repetition control (#84)', () => {
  it('shots from one Squad coalesce into one burst per window; another Squad gets its own', () => {
    TUNING.coalesceSeconds = 0.5;
    const g = newGate();
    expect(admitShot(g, 'alpha', 10)).toBe(true);
    expect(admitShot(g, 'alpha', 10.2)).toBe(false);
    expect(admitShot(g, 'bravo', 10.2)).toBe(true);
    expect(admitShot(g, 'alpha', 10.5)).toBe(true);
  });

  it('impacts land no closer than the spacing', () => {
    TUNING.impactGapSeconds = 0.2;
    const g = newGate();
    expect(admitImpact(g, 5)).toBe(true);
    expect(admitImpact(g, 5.1)).toBe(false);
    expect(admitImpact(g, 5.2)).toBe(true);
  });

  it('at most maxConcurrent combat sounds at once: the newest wins and the oldest is evicted', () => {
    TUNING.maxConcurrent = 2;
    const g = newGate();
    expect(admit(g, 'a', 0, 1)).toEqual([]);
    expect(admit(g, 'b', 0.1, 1)).toEqual([]);
    expect(admit(g, 'c', 0.2, 1)).toEqual(['a']);
    expect(admit(g, 'd', 0.3, 1)).toEqual(['b']);
  });

  it('a sound that has ended frees its slot', () => {
    TUNING.maxConcurrent = 1;
    const g = newGate();
    admit(g, 'a', 0, 0.5);
    expect(admit(g, 'b', 1, 2)).toEqual([]);
  });

  it('a released loop leaves the gate; a new gate forgets every booking', () => {
    const g = newGate();
    admit(g, 'uav', 0, Infinity);
    admit(g, 'shot:1', 0, 1);
    release(g, 'uav');
    expect(g.live.map((s) => s.id)).toEqual(['shot:1']);
    admitShot(g, 'alpha', 0);
    const fresh = newGate();
    expect(fresh.live).toEqual([]);
    expect(admitShot(fresh, 'alpha', 0)).toBe(true);
  });

  it('loops sit outside the cap: they never fill it and a one-shot never evicts one', () => {
    TUNING.maxConcurrent = 1;
    const g = newGate();
    expect(admit(g, 'uav', 0, Infinity)).toEqual([]);
    expect(admit(g, 'shell', 0, Infinity)).toEqual([]);
    expect(admit(g, 'shot:1', 1, 2)).toEqual([]);
    expect(admit(g, 'shot:2', 1.1, 2)).toEqual(['shot:1']);
  });
});

describe('observability rule: a combat sound plays only when its source is drawn (#84)', () => {
  it('a shot sounds for a friendly or a drawn Contact, and is silent for an unseen shooter', () => {
    const v = view();
    const shot = (from: number): SimEvent => ({ kind: 'shot', side: 'nato', from, to: 20, hit: false });
    expect(sourceDrawn(v, shot(1))).toBe(true);
    expect(sourceDrawn(v, shot(20))).toBe(true);
    expect(sourceDrawn(v, shot(99))).toBe(false);
    expect(sourceDrawn(v, { kind: 'suppressive', side: 'pact', from: 99, x: 0, y: 0, hit: false })).toBe(false);
  });

  it('an impact the Console receives is drawn by the impacts layer, so it always sounds', () => {
    expect(sourceDrawn(view(), { kind: 'impact', side: 'pact', x: 0, y: 0 })).toBe(true);
  });

  it('a Scan UAV on station hums at its orbit; nothing loops on an empty map', () => {
    expect(drawnLoops(view(), HQ, 0)).toEqual([]);
    const loops = drawnLoops(view({ effects: [effect({ asset: 'scan', x: 100, y: 50, radius: 60 })] }), HQ, 0);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ kind: 'uav', key: 'uav:100:50', x: 160, y: 50 });
  });

  it('a Supply Drop crate flutters while it falls and goes quiet once landed', () => {
    const falling = effect({ asset: 'supply', x: 10, y: 20, landsIn: 3, fall: 5 });
    expect(drawnLoops(view({ effects: [falling] }), HQ, 0)).toMatchObject([{ kind: 'crate', key: 'crate:10:20' }]);
    expect(drawnLoops(view({ effects: [{ ...falling, landsIn: 0 }] }), HQ, 0)).toEqual([]);
  });

  it('each Barrage shell in flight whistles along its arc from the HQ, keyed by where it lands', () => {
    const barrage = effect({ asset: 'barrage', x: 0, y: 0, radius: 25, shells: [{ x: 5, y: 5, flight: 0.5 }, { x: -5, y: 5, flight: 0.1 }] });
    const loops = drawnLoops(view({ effects: [barrage] }), HQ, 0);
    expect(loops.map((l) => l.key)).toEqual(['shell:5:5', 'shell:-5:5']);
    expect(loops[0]!.kind).toBe('shell');
    expect(loops[0]!.x).toBeGreaterThan(HQ.x); // half way along, so well east of the HQ
    expect(loops[1]!.x).toBeLessThan(loops[0]!.x); // just launched: still near the HQ
  });

  it('inCombat: a friendly Squad taking fire, from the view alone; it counts Squads, not Soldiers (#85)', () => {
    expect(inCombat(view())).toBe(false);
    const v = view();
    v.friendlies[0]!.suppressed = true;
    expect(inCombat(v)).toBe(false);
    v.squads[0]!.takingFire = true;
    expect(inCombat(v)).toBe(true);
  });
});

describe('Voice Lines: which file speaks a radio line (#84, #85)', () => {
  // The Asset net lines as the Simulation says them: one Soldier a Side on open ground, an Asset called at (200, 0) on tick 0.
  const field: MapData = {
    name: 'field',
    playArea: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }],
    hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
    points: [],
    grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
  };
  const assetLines = (asset: AssetKind, seconds: number, enemyAt?: Vec2) => {
    const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, fireRangeM: 0, barrageCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: field, tune, squadsPerSide: 1, commanderSide: 'nato' });
    if (enemyAt) Object.assign(m.soldiers[1]!, enemyAt);
    const out: VoiceId[] = [];
    for (let i = 0; i < seconds * tune.hz; i++) {
      for (const e of step(m, i === 0 ? [{ tick: m.tick, side: 'nato', kind: 'asset', asset, at: { x: 200, y: 0 } }] : [])) {
        if (e.kind === 'radio' && e.type === 'asset') out.push(voiceFor(e) ?? (`buzz: ${e.text}` as VoiceId));
      }
    }
    return out;
  };

  it('every Asset net line the Simulation says is spoken by its Voice Line, in order', () => {
    expect(assetLines('scan', 16, { x: 200, y: 10 })).toEqual(['uav-inbound', 'uav-has-contacts', 'uav-off-station']);
    expect(assetLines('scan', 16)).toEqual(['uav-inbound', 'uav-off-station']);
    expect(assetLines('supply', 6)).toEqual(['supplies-inbound', 'supplies-on-the-ground']);
    expect(assetLines('barrage', 8)).toEqual(['fire-mission-shot', 'splash']);
    expect(voiceFor({ type: 'asset', text: 'UAV eyes on 3 hostiles' })).toBe('uav-has-contacts');
  });

  it('"<Point> lost" is spoken per NATO name as the Simulation says it (callName), "<Squad> wiped" as Squad wiped', () => {
    const names = { A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot', G: 'golf', H: 'hotel' };
    for (const [letter, name] of Object.entries(names)) expect(voiceFor({ type: 'lost', text: `${callName(letter)} lost` })).toBe(`point-lost-${name}`);
    expect(voiceFor({ type: 'wiped', text: 'Bravo wiped' })).toBe('squad-wiped');
  });

  it('"Artillery incoming" is a warning line; nothing in the Simulation says it until an enemy Commander exists', () => {
    expect(voiceFor({ type: 'warning', text: 'Artillery incoming' })).toBe('artillery-incoming');
  });

  it('Squad Callouts, captures and lines of another type stay buzz plus text', () => {
    expect(voiceFor({ type: 'contact', text: 'contact, infantry' })).toBeNull();
    expect(voiceFor({ type: 'captured', text: 'Alpha captured' })).toBeNull();
    expect(voiceFor({ type: 'lost', text: 'Zulu lost' })).toBeNull();
    expect(voiceFor({ type: 'fire', text: 'Splash' })).toBeNull(); // keyed on the type, not the text alone
  });
});

describe('spatial: pan by screen x, fade with distance from the viewport centre (#84)', () => {
  const W = 1000;
  const H = 600;
  it('pans left of centre to the left, right to the right, centre dead ahead', () => {
    expect(spatialise(100, 300, W, H, 1).pan).toBeLessThan(-0.5);
    expect(spatialise(900, 300, W, H, 1).pan).toBeGreaterThan(0.5);
    expect(spatialise(500, 300, W, H, 1).pan).toBe(0);
  });

  it('a source at the centre is louder than one at the edge, and both keep the full band', () => {
    const centre = spatialise(500, 300, W, H, 4);
    const edge = spatialise(950, 50, W, H, 4);
    expect(centre.gain).toBeGreaterThan(edge.gain);
    expect(centre.cutoff).toBe(edge.cutoff);
  });

  it('off-screen sources are quieter and low-passed', () => {
    const on = spatialise(990, 300, W, H, 4);
    const off = spatialise(1100, 300, W, H, 4);
    expect(off.gain).toBeLessThan(on.gain);
    expect(off.cutoff).toBeLessThan(on.cutoff);
  });

  it('zooming in brings the same spot closer', () => {
    expect(spatialise(500, 300, W, H, 8).gain).toBeGreaterThan(spatialise(500, 300, W, H, 1).gain);
  });
});
