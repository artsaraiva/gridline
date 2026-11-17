import { describe, expect, it } from 'vitest';
import { gunOf, reach2 } from './guns';
import { hashes, NO_VEHICLES, play, scene, type Logged } from './test-scene';
import { DEFAULT_TUNE } from './tune';
import type { GunKind, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;
const T = DEFAULT_TUNE;
/** Nobody walks, sees past the cone's edge or is hurt: the guns alone. */
const STILL: Partial<Tune> = { ...NO_VEHICLES, squadSize: 4, walkSpeed: 0, damage: [0, 0], suppressAccuracyLoss: 0, rockets: 0, ammo: 1e6 };
const shots = (events: Logged[], from: number) => events.filter((e) => e.kind === 'shot' && e.from === from) as (Logged & { gun?: GunKind })[];

describe('guns: a fixed roster, each firing its own way', () => {
  it('the roster by place in the Squad: rifle, SMG, LMG, then a sniper rifle in an Elite Squad and a DMR in any other', () => {
    const m = scene({ squads: 2, tune: { squadSize: 4, eliteSquads: 1 } });
    expect(m.squads[0]!.members.map((id) => gunOf(m, m.soldiers[id]!))).toEqual(['rifle', 'smg', 'lmg', 'sniper']);
    expect(m.squads[1]!.members.map((id) => gunOf(m, m.soldiers[id]!))).toEqual(['rifle', 'smg', 'lmg', 'dmr']);
    const pact = m.squads.filter((sq) => sq.side === 'pact');
    expect(pact.map((sq) => gunOf(m, m.soldiers[sq.members[3]!]!))).toEqual(['sniper', 'dmr']); // each Side's first Squads are its Elite
  });

  it('each fires in bursts of its own length and gap, then pauses; the events name the gun', () => {
    // nato's first Squad 60 m from a pact Soldier nobody can hurt
    const place = { 0: { x: 0, y: 0, fx: 1 }, 1: { x: 0, y: 4, fx: 1 }, 2: { x: 0, y: 8, fx: 1 }, 3: { x: 0, y: 12, fx: 1 }, 4: { x: 60, y: 6, fx: 1 } };
    const { events } = play(scene({ place, tune: STILL }), 30 * HZ);
    const bursts = (from: number, g: Tune['guns'][GunKind]) => {
      const ticks = shots(events, from).map((e) => e.tick);
      const gap = Math.max(1, Math.round(g.gapSeconds * HZ));
      const runs: number[] = [1];
      for (let i = 1; i < ticks.length; i++) ticks[i]! - ticks[i - 1]! <= gap ? runs[runs.length - 1]!++ : runs.push(1);
      return runs.slice(0, -1); // the last may be cut short by the end
    };
    for (const [id, gun] of [[0, 'rifle'], [1, 'smg'], [2, 'lmg'], [3, 'sniper']] as const) {
      const g = T.guns[gun];
      const runs = bursts(id, g);
      expect(new Set(shots(events, id).map((e) => e.gun)), gun).toEqual(new Set([gun]));
      expect(runs.length, gun).toBeGreaterThan(2);
      expect(Math.min(...runs), gun).toBeGreaterThanOrEqual(g.burst[0]);
      expect(Math.max(...runs), gun).toBeLessThanOrEqual(g.burst[1]);
    }
    const lmg = shots(events, 2).length;
    const sniper = shots(events, 3).length;
    expect(lmg).toBeGreaterThan(sniper * 10);
  });

  it('each reaches its own distance: at 100 m the SMG holds its fire, at 190 m only the scoped guns can reach', () => {
    const squad = (x: number) => ({ 0: { x: 0, y: 0, fx: 1 }, 1: { x: 0, y: 4, fx: 1 }, 2: { x: 0, y: 8, fx: 1 }, 3: { x: 0, y: 12, fx: 1 }, 4: { x, y: 6, fx: 1 } });
    const firing = (x: number, tune: Partial<Tune> = {}) => {
      const { events } = play(scene({ place: squad(x), tune: { ...STILL, ...tune } }), 8 * HZ);
      return [0, 1, 2, 3].filter((id) => shots(events, id).length > 0);
    };
    expect(firing(100)).toEqual([0, 2, 3]);
    expect(firing(190, { visionM: 400 })).toEqual([3]); // past the rifle's 140 m and the LMG's 168 m
    expect(firing(190, { visionM: 400, eliteSquads: 0 })).toEqual([3]); // the DMR's 220 m
    expect(firing(260, { visionM: 400, eliteSquads: 0 })).toEqual([]);
    expect(reach2(scene(), T.guns.sniper)).toBe((T.fireRangeM * 2.3) ** 2);
  });

  it('a scoped gun takes on an enemy beyond its own sight that another friendly sees, and gives its Commander no new Contact', () => {
    // pact 4 stands 250 m from nato's Squad; nato 1 has walked up to 100 m from it and sees it. Only the sniper rifle reaches.
    const place = { 0: { x: 0, y: 0, fx: 1 }, 1: { x: 150, y: 0, fx: 1 }, 2: { x: 0, y: 8, fx: 1 }, 3: { x: 0, y: 12, fx: 1 }, 4: { x: 250, y: 0, fx: 1 } };
    const seen = play(scene({ place, tune: STILL }), 8 * HZ);
    expect(shots(seen.events, 3).length).toBeGreaterThan(0);
    expect(shots(seen.events, 0)).toEqual([]);
    expect(seen.views.at(-1)!.contacts.map((c) => c.id)).toEqual([4]);
    // with nobody near enough to see it, the sniper has nothing to fire at
    const unseen = play(scene({ place: { ...place, 1: { x: 0, y: 4, fx: 1 } }, tune: STILL }), 8 * HZ);
    expect(shots(unseen.events, 3)).toEqual([]);
    expect(unseen.views.at(-1)!.contacts).toEqual([]);
  });

  it('a burst spends its share of the load as it starts, and the rounds left in it are Match state', () => {
    const place = { 0: { x: 0, y: 0, fx: 1 }, 4: { x: 60, y: 0, fx: 1 } };
    const m = scene({ place, tune: { ...STILL, ammo: 100 } });
    play(m, 1);
    expect(m.soldiers[0]!.ammo).toBe(100 - T.guns.rifle.ammo);
    expect(m.soldiers[0]!.burst).toBeGreaterThanOrEqual(T.guns.rifle.burst[0] - 1);
    hashes(m, { burst: () => m.soldiers[0]!.burst++ });
  });
});
