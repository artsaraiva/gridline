import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommanderView, EffectView } from '../sim/types';
import { admit, admitImpact, admitShot, busGain, chatterGap, drawnLoops, inCombat, newGate, shooterDrawn, spatialise, TUNING, VOICE_IDS, voiceFor } from './audio-mix';

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
});

describe('observability rule: a combat sound plays only when its source is drawn (#84)', () => {
  it('a shot sounds for a friendly or a drawn Contact, and is silent for an unseen shooter', () => {
    const v = view();
    expect(shooterDrawn(v, 1)).toBe(true);
    expect(shooterDrawn(v, 20)).toBe(true);
    expect(shooterDrawn(v, 99)).toBe(false);
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

  it('inCombat: a friendly Squad taking fire, from the view alone', () => {
    expect(inCombat(view())).toBe(false);
    const v = view();
    v.squads[0]!.takingFire = true;
    expect(inCombat(v)).toBe(true);
  });
});

describe('Voice Lines: which file speaks a radio log line (#84)', () => {
  it.each([
    ['Scan UAV inbound', 'uav-inbound'],
    ['UAV on station', 'uav-on-station'],
    ['UAV eyes on 3 hostiles', 'uav-has-contacts'],
    ['UAV eyes on 1 hostile', 'uav-has-contacts'],
    ['UAV off station, no contacts', 'uav-off-station'],
    ['Supply Drop inbound', 'supplies-inbound'],
    ['Supply Drop landed', 'supplies-on-the-ground'],
    ['Barrage inbound', 'fire-mission-shot'],
    ['Splash', 'splash'],
    ['Artillery incoming', 'artillery-incoming'],
    ['Alpha lost', 'point-lost-alpha'],
    ['Hotel lost', 'point-lost-hotel'],
    ['Bravo wiped', 'squad-wiped'],
  ])('"%s" is spoken by %s', (text, id) => expect(voiceFor(text)).toBe(id));

  it('Squad Callouts and captures stay buzz plus text', () => {
    expect(voiceFor('Contact')).toBeNull();
    expect(voiceFor('Alpha captured')).toBeNull();
    expect(voiceFor('Taking fire')).toBeNull();
  });

  it('the engine knows exactly the Voice Lines the voice pipeline (#83) generates', () => {
    const lines = JSON.parse(readFileSync(new URL('../../assets/voice/lines.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect([...VOICE_IDS].sort()).toEqual(Object.keys(lines).sort());
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
