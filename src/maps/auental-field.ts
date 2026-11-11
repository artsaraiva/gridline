import type { MapData, Rect } from '../sim/types';

/**
 * #151: a hand-written stand-in for the Auental bake (#150) at full size, for flow-field budgets until the greybox exists:
 * the Play Area, HQs, 12 Capture Points and 7 crossings from #150's tables on open ground. The river is 20 m of water stepped
 * along each crossing's x (joined at each step, so it has no gap) and runs from the north edge to the reservoir, which fills
 * the south edge below the dam.
 */
const CROSSINGS: NonNullable<MapData['crossings']> = [
  { id: 'OLD', kind: 'bridge', x: -60, y: 1020, halfWidth: 4 },
  { id: 'NF', kind: 'ford', x: -190, y: 720, halfWidth: 6.5 },
  { id: 'RAIL', kind: 'footbridge', x: -165, y: 430, halfWidth: 1.5 },
  { id: 'MAIN', kind: 'bridge', x: 0, y: 0, halfWidth: 5 },
  { id: 'WEIR', kind: 'footbridge', x: 165, y: -430, halfWidth: 1.5 },
  { id: 'SF', kind: 'ford', x: 190, y: -720, halfWidth: 6.5 },
  { id: 'DAM', kind: 'bridge', x: 60, y: -1020, halfWidth: 4 },
];

const EDGE = 1250; // the whole 2.5 km bake, so the grid is as big as Auental's can be (its Play Area is 6.05 km² of it)
const HALF_RIVER = 10;
const DAM_Y = -1040; // the reservoir's north shore

function river(): Rect[] {
  const tops = [EDGE, ...CROSSINGS.slice(1).map((c, i) => (CROSSINGS[i]!.y + c.y) / 2), DAM_Y];
  const rects: Rect[] = CROSSINGS.map((c, i) => ({ x0: c.x - HALF_RIVER, y0: tops[i + 1]!, x1: c.x + HALF_RIVER, y1: tops[i]! }));
  for (let i = 1; i < CROSSINGS.length; i++) {
    const [a, b] = [CROSSINGS[i - 1]!.x, CROSSINGS[i]!.x];
    rects.push({ x0: Math.min(a, b) - HALF_RIVER, y0: tops[i]! - HALF_RIVER, x1: Math.max(a, b) + HALF_RIVER, y1: tops[i]! + HALF_RIVER });
  }
  rects.push({ x0: -300, y0: -EDGE, x1: 400, y1: DAM_Y }); // the reservoir
  return rects;
}

export const AUENTAL_FIELD: MapData = {
  name: 'Auental field',
  playArea: [
    { x: -EDGE, y: -EDGE },
    { x: EDGE, y: -EDGE },
    { x: EDGE, y: EDGE },
    { x: -EDGE, y: EDGE },
  ],
  hqs: { nato: { x: -1120, y: -40, radius: 60 }, pact: { x: 1120, y: 40, radius: 60 } },
  points: [
    { id: 'A', name: 'Kreuzhof', x: -900, y: 480, radius: 30, owner: 'nato' },
    { id: 'B', name: 'Lindenhof', x: -840, y: -640, radius: 30, owner: 'nato' },
    { id: 'C', name: 'Ziegelei', x: -520, y: 560, radius: 35 },
    { id: 'D', name: 'Obstgut', x: -430, y: -520, radius: 35 },
    { id: 'E', name: 'Unterau', x: -130, y: 40, radius: 45 },
    { id: 'F', name: 'Staudamm', x: -120, y: -1000, radius: 35 },
    { id: 'G', name: 'Hochwacht', x: 120, y: 1000, radius: 35 },
    { id: 'H', name: 'Oberau', x: 130, y: -40, radius: 45 },
    { id: 'I', name: 'Bahnhof', x: 430, y: 520, radius: 35 },
    { id: 'J', name: 'Kieswerk', x: 520, y: -560, radius: 35 },
    { id: 'K', name: 'Waldhof', x: 840, y: 640, radius: 30, owner: 'pact' },
    { id: 'L', name: 'Birkenhof', x: 900, y: -480, radius: 30, owner: 'pact' },
  ],
  water: river(),
  crossings: CROSSINGS,
};
