// #110 the AA, at its module's interface: where its driver lays back (`goal`, a decision the view does not show: #154 two of them
// spread over both flanks, #150 never on a keystone point), and its gun and missile on a jet (what the view and the events show).
import { describe, expect, it } from 'vitest';
import { commanderView, step, type Match } from '../index';
import { DEFAULT_TUNE } from '../tune';
import { crew, scene, vehicle, viewOf } from '../test-scene';
import { aa } from './aa';
import { leave, type Vehicle } from './index';

const HZ = DEFAULT_TUNE.hz;

/** Where Soldier `id`'s Squad's AA `v` lays back, by its driver's think. */
const layBack = (m: Match, v: Vehicle & { kind: 'aa' }, id: number) => m.points[aa.goal!(m, m.squads[m.soldiers[id]!.squad]!, m.soldiers[id]!, v)]?.id;

describe('#154 two AAs', () => {
  it('lay back on the two flanks: the second AA leaves the better flank to the first', () => {
    // nato holds A on the north flank (the better lay-back: farther out) and B on the south; C in the middle. Soldier 0 drives
    // AA 8, Soldier 2 (the next Squad) AA 9; no seeded preference
    const m = scene({
      map: { points: [{ id: 'A', name: 'A', x: -300, y: 320, owner: 'nato' }, { id: 'B', name: 'B', x: -300, y: -280, owner: 'nato' }, { id: 'C', name: 'C', x: 0, y: 0 }] },
      tune: { aasPerSide: 2, tankGoalBias: 0, visionM: 0 },
      squads: 2,
    });
    const aas = [0, 1].map((k) => crew(m, vehicle(m, 'aa', 'nato', k), [2 * k]));
    for (let i = 0; i < 3 * HZ; i++) step(m, []);
    expect(aas.map((v, k) => layBack(m, v, 2 * k)).sort()).toEqual(['A', 'B']);
  });

  it('#150: never lay back on a keystone point the map names, however good its flank', () => {
    // as above, but the map names A and C its keystone: the one AA leaves the better flank and takes B
    const m = scene({
      map: { points: [{ id: 'A', name: 'A', x: -300, y: 320, owner: 'nato' }, { id: 'B', name: 'B', x: -300, y: -280, owner: 'nato' }, { id: 'C', name: 'C', x: 0, y: 0 }], keystone: ['A', 'C'] },
      tune: { aasPerSide: 1, tankGoalBias: 0, visionM: 0 },
    });
    const v = crew(m, vehicle(m, 'aa'), [0]);
    expect(layBack(m, v, 0)).toBe('B');
  });
});

describe('#110 the AA on a jet', () => {
  it('parked on A, it shoots the jet down on its second pass: the pilot dies, one Ticket, a Wreck where it fell', () => {
    // nato's jet (4) takes off with its pilot, Soldier 1, at match start; pact's AA (7) stands on A crewed by Soldier 2. Pact's own
    // jet stays at the base: its pilot gets out at once, and pact's other Soldier stands away from the HQ (nobody dies to come back into it)
    const m = scene({ map: { points: [{ id: 'A', name: 'A', x: 0, y: 0 }] }, tune: { visionM: 0, jetsPerSide: 1, aasPerSide: 1 } });
    const home = vehicle(m, 'jet', 'pact');
    leave(m, m.soldiers[home.seats[0]!]!);
    Object.assign(home, { airborne: false });
    home.sortie.stage = 'idle';
    Object.assign(m.soldiers[3]!, { x: 300, y: 300 });
    const jet = vehicle(m, 'jet');
    crew(m, vehicle(m, 'aa', 'pact'), [2], { x: 0, y: 0 });
    const tickets = m.tickets.nato;
    let afterFirst = -1;
    let passes = 0;
    for (let i = 0; i < 120 * HZ && viewOf(m, jet.id); i++) {
      step(m, []);
      if (afterFirst < 0 && jet.sortie.stage === 'turning') afterFirst = viewOf(m, jet.id)!.hp! * DEFAULT_TUNE.jetHp;
      passes = jet.sortie.passes;
    }
    expect(afterFirst).toBeGreaterThan(20);
    expect(afterFirst).toBeLessThan(80); // about half a pass
    expect(viewOf(m, jet.id)).toBeUndefined();
    expect(passes).toBeGreaterThanOrEqual(2); // during the second pass
    expect(m.soldiers[1]!.state).toBe('dead');
    expect(m.tickets.nato).toBe(tickets - 1);
    expect(commanderView(m, 'nato').vehicles).toContainEqual(expect.objectContaining({ side: 'nato', kind: 'jet', wreck: true }));
  });
});
