import { describe, expect, it } from 'vitest';
import type { AssetKind, AssetView, CommanderView, EffectView, PointView, SideId, SquadView } from '../sim/types';
import { assetLook, atWork, callable, keystonesMissing, markCount, PAD, PAD_SIZE, ruler } from './pad';

/** Every AssetKind: TypeScript fails this table when one is added or dropped, so a new Asset can't miss the pad. */
const KINDS: Record<AssetKind, true> = { scan: true, supply: true, barrage: true, missile: true, gunship: true, smoke: true, creep: true, drone: true, recon: true, beacon: true, rapid: true, emp: true, feint: true };

describe('the Asset keypad (#181)', () => {
  it('gives every AssetKind exactly one cell', () => {
    for (const k of Object.keys(KINDS)) expect(PAD.filter((c) => c.calls === k), k).toHaveLength(1);
    expect(PAD.filter((c) => c.calls && c.calls !== 'mark')).toHaveLength(Object.keys(KINDS).length);
  });

  it('is three bands of five on the keyboard rows, every key once', () => {
    expect([0, 1, 2].map((b) => PAD.filter((c) => c.band === b).map((c) => c.key).join(''))).toEqual(['QWERT', 'ASDFG', 'ZXCVB']);
    expect(new Set(PAD.map((c) => c.key)).size).toBe(PAD.length);
  });

  it('holds its categories in each band, each ruler naming them over the cells they span', () => {
    expect([0, 1, 2].map(ruler)).toEqual([
      [{ category: 'Strike', span: 5 }],
      [{ category: 'Recon', span: 2 }, { category: 'Screen', span: 1 }, { category: 'Denial', span: 2 }],
      [{ category: 'Support', span: 3 }, { category: 'Standing', span: 2 }],
    ]);
  });

  it('puts each Asset on its key, Strikes light to heavy, the Mark on V, and holds B until vehicle tasking ships', () => {
    expect(Object.fromEntries(PAD.map((c) => [c.key, c.calls]))).toEqual({
      Q: 'drone', W: 'barrage', E: 'creep', R: 'missile', T: 'gunship',
      A: 'scan', S: 'recon', D: 'smoke', F: 'emp', G: 'feint',
      Z: 'supply', X: 'beacon', C: 'rapid', V: 'mark', B: null,
    });
  });

  it('is 256 × 212 px', () => {
    expect(PAD_SIZE).toEqual({ w: 256, h: 212 });
  });
});

const row = (asset: AssetKind, o: Partial<AssetView> = {}): AssetView => ({ asset, readyIn: 0, cooldown: 120, radius: 30, ...o });
const point = (name: string, owner: SideId | null): PointView => ({ id: name, name, x: 0, y: 0, radius: 25, owner, progress: 0 });
const squad = (id: number, name: string, request: SquadView['request'] = null): SquadView => ({ id, name, size: 4, strength: 4, respawnIn: [], redeployIn: null, request });
const effect = (asset: AssetKind, left: number, total: number, o: Partial<EffectView> = {}): EffectView => ({ asset, x: 0, y: 0, radius: 10, left, total, ...o });
const view = (o: Partial<CommanderView>): CommanderView => ({
  side: 'nato', tick: 0, seconds: 0, friendlies: [], contacts: [], squads: [], points: [point('A', 'nato'), point('C', null), point('E', 'pact')], tickets: { nato: 100, pact: 100 }, result: null, ...o,
});

describe('a cell reads its Asset (#181)', () => {
  it('ready: the icon alone, the readout says READY', () => {
    expect(assetLook('barrage', view({ assets: [row('barrage')] }), false, '')).toMatchObject({ state: 'ready', slot: '', needs: [], lift: false, bar: 0, readout: 'READY' });
  });

  it('cooling: the timer under the lifted icon and a draining bar', () => {
    expect(assetLook('barrage', view({ assets: [row('barrage', { readyIn: 29.2 })] }), false, '')).toMatchObject({ state: 'cooling', slot: '00:30', lift: true, readout: '00:30' });
    expect(assetLook('barrage', view({ assets: [row('barrage', { readyIn: 30 })] }), false, '').bar).toBe(0.25);
  });

  it('at work: the time left and its bar (friendly in the cell), the readout saying UP', () => {
    const v = view({ assets: [row('supply', { readyIn: 80 })], effects: [effect('supply', 10, 60)] });
    expect(assetLook('supply', v, false, '')).toMatchObject({ state: 'active', slot: '00:10', lift: true, bar: 10 / 60, readout: 'UP 00:10' });
  });

  it('at work: #142 an untargeted Asset by its row; #99 never the enemy\'s missile; #101 nor a Gunship off station; #139 nor a drone shot down', () => {
    expect(atWork('rapid', view({ assets: [row('rapid', { readyIn: 170, untargeted: true, up: { left: 50, total: 60 } })] }))).toEqual({ left: 50, total: 60 });
    expect(atWork('missile', view({ effects: [effect('missile', 8, 12, { side: 'pact' })] }))).toBeUndefined();
    expect(atWork('missile', view({ effects: [effect('missile', 8, 12, { side: 'nato' })] }))).toMatchObject({ left: 8 });
    expect(atWork('gunship', view({ effects: [effect('gunship', 0, 75, { side: 'nato' })] }))).toBeUndefined();
    expect(atWork('drone', view({ effects: [effect('drone', 2, 30, { side: 'nato', lost: true })] }))).toBeUndefined();
  });

  it('gated: exactly the keystones still missing, in the order the gate names them, over a faint cooldown that keeps draining', () => {
    const look = assetLook('missile', view({ assets: [row('missile', { readyIn: 60, cooldown: 240, off: 'needs E, C' })] }), false, '');
    expect(look).toMatchObject({ state: 'off', slot: '', lift: true, bar: 0.25, readout: 'NEEDS' });
    expect(look.needs.map((p) => [p.name, p.owner])).toEqual([['E', 'pact'], ['C', null]]);
  });

  it('gated outranks at work; with every keystone held the cell falls back to at work, cooling or ready', () => {
    const fx = [effect('missile', 8, 12, { side: 'nato' })];
    expect(assetLook('missile', view({ assets: [row('missile', { readyIn: 200, cooldown: 240, off: 'needs C' })], effects: fx }), false, '').state).toBe('off');
    expect(assetLook('missile', view({ assets: [row('missile', { readyIn: 200, cooldown: 240 })], effects: fx }), false, '').state).toBe('active');
    expect(assetLook('missile', view({ assets: [row('missile', { readyIn: 200, cooldown: 240 })] }), false, '').state).toBe('cooling');
  });

  it('off for another reason: a drone in the air reads at work while it flies, and says why once it is shot down', () => {
    const flying = view({ assets: [row('drone', { readyIn: 0, off: 'in the air' })], effects: [effect('drone', 12, 30, { side: 'nato' })] });
    expect(assetLook('drone', flying, false, '')).toMatchObject({ state: 'active', needs: [], readout: 'UP 00:12' });
    const down = view({ assets: [row('drone', { readyIn: 0, off: 'in the air' })], effects: [effect('drone', 2, 30, { side: 'nato', lost: true })] });
    expect(assetLook('drone', down, false, '')).toMatchObject({ state: 'off', needs: [], slot: '', lift: false, readout: 'IN THE AIR' });
    expect(assetLook('scan', view({ assets: [] }), false, '')).toMatchObject({ state: 'off', readout: '—' }); // not in the game
  });

  it('armed: the Grid Reference in the slot and the name alone in the readout; #142 an untargeted Asset shows none', () => {
    expect(assetLook('barrage', view({ assets: [row('barrage')] }), true, 'F6')).toMatchObject({ state: 'armed', slot: 'F6', lift: true, bar: 0, readout: '' });
    expect(assetLook('rapid', view({ assets: [row('rapid', { untargeted: true })] }), true, 'F6')).toMatchObject({ state: 'armed', slot: '', lift: false });
  });

  it('a Request: the corner on the Asset asked for, the readout naming the Squad soonest to expire and its Grid Reference', () => {
    const v = view({
      assets: [row('scan', { readyIn: 20 }), row('barrage')],
      squads: [squad(0, 'Alpha', { asset: 'scan', at: { x: 0, y: 0 }, grid: 'E5', left: 25 }), squad(2, 'Charlie', { asset: 'scan', at: { x: 0, y: 0 }, grid: 'J4', left: 9 })],
    });
    expect(assetLook('scan', v, false, '')).toMatchObject({ state: 'cooling', slot: '00:20', readout: 'CHARLIE · J4' });
    expect(assetLook('scan', v, false, '').request?.name).toBe('Charlie');
    expect(assetLook('barrage', v, false, '').request).toBeUndefined();
    expect(assetLook('scan', v, true, 'J4').readout).toBe(''); // armed: the name alone
  });

  it('arms ready, or #101 at work taking a new spot; never off, cooling, or once the match is over', () => {
    expect(callable('barrage', view({ assets: [row('barrage')] }))).toBe(true);
    expect(callable('barrage', view({ assets: [row('barrage', { readyIn: 3 })] }))).toBe(false);
    expect(callable('gunship', view({ assets: [row('gunship', { readyIn: 200, retask: true })] }))).toBe(true);
    expect(callable('missile', view({ assets: [row('missile', { off: 'needs C' })] }))).toBe(false);
    expect(callable('barrage', view({ assets: [row('barrage')], result: { winner: 'nato', reason: 'tickets' } }))).toBe(false);
    expect(callable('scan', view({ assets: [] }))).toBe(false);
  });

  it('reads keystones only off a keystone gate', () => {
    const points = [point('C', null), point('E', 'pact')];
    expect(keystonesMissing('needs C', points).map((p) => p.name)).toEqual(['C']);
    expect(keystonesMissing('in the air', points)).toEqual([]);
    expect(keystonesMissing('no Capture Point', points)).toEqual([]);
    expect(keystonesMissing(undefined, points)).toEqual([]);
  });

  it('the Mark counts its live Marks of the most there may be', () => {
    expect(markCount(view({}))).toBe('0/3');
    expect(markCount(view({ marks: [{ id: 1, x: 0, y: 0, fade: 1 }] }))).toBe('1/3');
  });
});
