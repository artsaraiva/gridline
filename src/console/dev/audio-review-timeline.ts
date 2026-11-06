// DEV-only audition timelines (#84): three hand-written, deterministic scripts of CommanderViews and Events on
// Kaltenbach coordinates, one per listening scenario, so the sound engine is judged by ear without a Simulation.
// `viewAt` and `eventsBetween` are pure.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, EffectView, FriendlyView, PointView, SimEvent, SoldierView, SquadView } from '../../sim/types';

export type ScenarioId = 'quiet' | 'uav' | 'artillery';
export const SCENARIOS: { id: ScenarioId; title: string; length: number }[] = [
  { id: 'quiet', title: 'Quiet observation', length: 40 },
  { id: 'uav', title: 'UAV confirmation during gunfire', length: 45 },
  { id: 'artillery', title: 'Urgent warning during artillery', length: 50 },
];

const HZ = DEFAULT_TUNE.hz;
const SIDE = 'nato';
const NET = { kind: 'radio', side: SIDE, squad: null, priority: 1 } as const;

// Alpha (0..3) and Bravo (4..7) hold the ground west of the centre bridge, Charlie (8..11) far south-west; the three
// Contacts (20..22) sit 50 m east of Alpha and Bravo. Nothing moves: the audition listens, it does not watch.
type Man = SoldierView & { squad: number };
const east = { fx: 1, fy: 0 };
const MEN: Man[] = [
  { id: 0, squad: 0, x: -78, y: 22, ...east },
  { id: 1, squad: 0, x: -66, y: 26, ...east },
  { id: 2, squad: 0, x: -58, y: 14, ...east },
  { id: 3, squad: 0, x: -70, y: 10, ...east },
  { id: 4, squad: 1, x: -72, y: -2, ...east },
  { id: 5, squad: 1, x: -62, y: 0, ...east },
  { id: 6, squad: 1, x: -54, y: 4, ...east },
  { id: 7, squad: 1, x: -64, y: -12, ...east },
  { id: 8, squad: 2, x: -150, y: -118, fx: 0.7, fy: 0.7 },
  { id: 9, squad: 2, x: -142, y: -126, fx: 0.7, fy: 0.7 },
  { id: 10, squad: 2, x: -158, y: -128, fx: 0.7, fy: 0.7 },
  { id: 11, squad: 2, x: -146, y: -136, fx: 0.7, fy: 0.7 },
];
const CONTACTS: SoldierView[] = [
  { id: 20, x: -14, y: 30, fx: -1, fy: 0 },
  { id: 21, x: -10, y: 12, fx: -1, fy: 0 },
  { id: 22, x: -16, y: -4, fx: -1, fy: 0 },
];
const NAMES = ['Alpha', 'Bravo', 'Charlie'];
const POINTS: PointView[] = [
  { id: 'A', name: 'A', x: -262, y: -322, radius: 25, owner: SIDE, progress: 1 },
  { id: 'B', name: 'B', x: 0, y: 300, radius: 25, owner: null, progress: 0 },
  { id: 'C', name: 'C', x: 0, y: 0, radius: 25, owner: SIDE, progress: 1 },
  { id: 'D', name: 'D', x: 0, y: -300, radius: 25, owner: null, progress: 0 },
  { id: 'E', name: 'E', x: 262, y: 322, radius: 25, owner: 'pact', progress: -1 },
];

/** What a scenario changes over time, each as a pure function of the second. */
interface Script {
  contacts: (t: number) => boolean;
  takingFire: (t: number, squad: number) => boolean;
  wiped: (t: number, squad: number) => boolean;
  pointLost: (t: number) => boolean;
  effects: (t: number) => EffectView[];
  events: [number, SimEvent][];
}

// Quiet observation: Charlie fires a few distant shots at nothing in view; a Supply Drop comes down near Alpha.
const SUPPLY = { x: -120, y: 30, at: 3, fall: DEFAULT_TUNE.supplyFallSeconds, stay: DEFAULT_TUNE.supplyStaySeconds };
const quiet: Script = {
  contacts: () => false,
  takingFire: () => false,
  wiped: () => false,
  pointLost: () => false,
  effects: (t) => {
    if (t < SUPPLY.at) return [];
    const landsIn = Math.max(0, SUPPLY.at + SUPPLY.fall - t);
    return [{ asset: 'supply', x: SUPPLY.x, y: SUPPLY.y, radius: DEFAULT_TUNE.supplyRadiusM, left: SUPPLY.at + SUPPLY.fall + SUPPLY.stay - t, total: SUPPLY.fall + SUPPLY.stay, landsIn, fall: SUPPLY.fall }];
  },
  events: [
    [SUPPLY.at, { ...NET, type: 'asset', text: 'Supply Drop inbound', grid: 'C6' }],
    [SUPPLY.at + SUPPLY.fall, { ...NET, type: 'asset', text: 'Supply Drop landed', grid: 'C6' }],
    ...[6, 6.3, 14, 27, 33].map((t, i): [number, SimEvent] => [t, { kind: 'shot', side: SIDE, from: 8 + (i % 4), to: 22, hit: false }]),
  ],
};

// UAV confirmation during gunfire: Alpha and Bravo trade fire with the Contacts from 2 s; the Scan UAV is called at 3 s,
// arrives at 9 s and leaves after `scanSeconds`.
const SCAN = { x: -20, y: 15, at: 9, seconds: DEFAULT_TUNE.scanSeconds };
const FIGHT = { from: 2, to: 40 };
function firefight(from: number, to: number): [number, SimEvent][] {
  const events: [number, SimEvent][] = [];
  const men = MEN.filter((m) => m.squad < 2);
  for (let t = from, i = 0; t < to; t += 0.6, i++) events.push([t, { kind: 'shot', side: SIDE, from: men[i % men.length]!.id, to: CONTACTS[i % CONTACTS.length]!.id, hit: i % 3 === 0 }]);
  for (let t = from + 0.3, i = 0; t < to; t += 0.9, i++) events.push([t, { kind: 'shot', side: 'pact', from: CONTACTS[i % CONTACTS.length]!.id, to: men[(i * 5) % men.length]!.id, hit: i % 4 === 1 }]);
  for (let t = from + 0.5, i = 0; t < to; t += 1.5, i++) {
    const near = men[(i * 3) % men.length]!;
    events.push([t, { kind: 'suppressive', side: 'pact', from: CONTACTS[2]!.id, x: near.x + ((i % 5) - 2) * 2, y: near.y + ((i % 3) - 1) * 2, hit: false }]);
  }
  return events;
}
const uav: Script = {
  contacts: () => true,
  takingFire: (t, squad) => squad < 2 && t >= FIGHT.from && t < FIGHT.to,
  wiped: () => false,
  pointLost: () => false,
  effects: (t) => (t >= SCAN.at && t < SCAN.at + SCAN.seconds ? [{ asset: 'scan', x: SCAN.x, y: SCAN.y, radius: DEFAULT_TUNE.scanRadiusM, left: SCAN.at + SCAN.seconds - t, total: SCAN.seconds }] : []),
  events: [
    [3, { ...NET, type: 'asset', text: 'Scan UAV inbound', grid: 'E5' }],
    [5, { kind: 'radio', side: SIDE, squad: 0, type: 'contact', text: 'Contact', grid: 'E5', priority: 3 }],
    [SCAN.at, { ...NET, type: 'asset', text: 'UAV on station', grid: 'E5' }],
    [SCAN.at + 4, { ...NET, type: 'asset', text: 'UAV eyes on 3 hostiles', grid: 'E5' }],
    [18, { kind: 'radio', side: SIDE, squad: 1, type: 'fire', text: 'Taking fire', grid: 'D5', priority: 2 }],
    [SCAN.at + SCAN.seconds, { ...NET, type: 'asset', text: 'UAV off station, no contacts', grid: 'E5' }],
    ...firefight(FIGHT.from, FIGHT.to),
  ],
};

// Urgent warning during artillery: a friendly Barrage on the Contacts (shells drawn in flight, then impacts), then enemy
// shells on Alpha and Bravo (not drawn: only their impacts), Capture Point C lost, Bravo wiped.
const BARRAGE = { x: -14, y: 14, at: 2, warning: DEFAULT_TUNE.barrageWarningSeconds, flight: DEFAULT_TUNE.barrageFlightSeconds, span: DEFAULT_TUNE.barrageSpanSeconds };
// Each shell: where it lands and when it leaves; the first two leave 0.1 s apart so two impacts crowd the spacing gate.
const SHELLS = [
  [8, 6, 0],
  [-12, 20, 0.1],
  [-20, -6, 1.6],
  [16, 22, 3.2],
  [-4, 4, 4.8],
  [10, -10, 6.4],
  [-16, 28, 8],
].map(([dx, dy, lead]) => ({ x: BARRAGE.x + dx!, y: BARRAGE.y + dy!, launch: BARRAGE.at + BARRAGE.warning + lead!, land: BARRAGE.at + BARRAGE.warning + lead! + BARRAGE.flight }));
const BARRAGE_END = SHELLS[SHELLS.length - 1]!.land + DEFAULT_TUNE.barrageContactSeconds;
const INCOMING = { at: 24, impacts: [27, 27.4, 28.1, 28.6, 29.5] };
const LOST_AT = 32;
const WIPED_AT = 38;
const artillery: Script = {
  contacts: () => true,
  takingFire: (t, squad) => squad < 2 && t >= INCOMING.impacts[0]! && t < WIPED_AT + 5,
  wiped: (t, squad) => squad === 1 && t >= WIPED_AT,
  pointLost: (t) => t >= LOST_AT,
  effects: (t) => {
    if (t < BARRAGE.at || t >= BARRAGE_END) return [];
    const shells = SHELLS.filter((s) => s.launch <= t && t < s.land).map((s) => ({ x: s.x, y: s.y, flight: (t - s.launch) / BARRAGE.flight }));
    const impactIn = SHELLS.some((s) => s.land <= t) ? 0 : SHELLS[0]!.land - t;
    return [{ asset: 'barrage', x: BARRAGE.x, y: BARRAGE.y, radius: DEFAULT_TUNE.barrageSpreadM, left: BARRAGE_END - t, total: BARRAGE_END - BARRAGE.at, shells, impactIn }];
  },
  events: [
    [BARRAGE.at, { ...NET, type: 'asset', text: 'Barrage inbound', grid: 'E5' }],
    [SHELLS[0]!.land, { ...NET, type: 'asset', text: 'Splash', grid: 'E5' }],
    ...SHELLS.map((s): [number, SimEvent] => [s.land, { kind: 'impact', side: SIDE, x: s.x, y: s.y }]),
    [INCOMING.at, { ...NET, type: 'warning', text: 'Artillery incoming', grid: 'D5' }],
    ...INCOMING.impacts.map((t, i): [number, SimEvent] => [t, { kind: 'impact', side: 'pact', x: -66 + (i % 3) * 8, y: 10 - (i % 2) * 14 }]),
    [LOST_AT, { kind: 'radio', side: SIDE, squad: 0, type: 'lost', text: 'Charlie lost', grid: 'E5', priority: 1 }],
    ...MEN.filter((m) => m.squad === 1).map((m): [number, SimEvent] => [WIPED_AT, { kind: 'death', side: SIDE, id: m.id, x: m.x, y: m.y }]),
    [WIPED_AT, { kind: 'radio', side: SIDE, squad: 1, type: 'wiped', text: 'Bravo wiped', grid: 'D5', priority: 5 }],
    ...firefight(INCOMING.impacts[0]!, WIPED_AT),
  ],
};

const SCRIPTS: Record<ScenarioId, Script> = { quiet, uav, artillery };
for (const s of Object.values(SCRIPTS)) s.events.sort((a, b) => a[0] - b[0]);

function squadView(s: Script, id: number, t: number): SquadView {
  const gone = s.wiped(t, id);
  return {
    id,
    name: NAMES[id]!,
    size: 4,
    strength: gone ? 0 : 4,
    respawnIn: [],
    takingFire: !gone && s.takingFire(t, id),
    ...(gone && { redeployAt: null }),
    redeployIn: gone ? WIPED_AT + 20 - t : null,
    task: gone ? null : 'hold',
    point: gone ? null : 'C',
    route: null,
    order: null,
    request: null,
    leader: gone ? null : id * 4,
  };
}

/** The Commander's view `t` seconds into scenario `id`. */
export function viewAt(id: ScenarioId, t: number): CommanderView {
  const s = SCRIPTS[id];
  const friendlies: FriendlyView[] = MEN.filter((m) => !s.wiped(t, m.squad)).map((m) => ({ ...m, state: 'alive', suppressed: false, ammo: 0.8 }));
  return {
    side: SIDE,
    tick: Math.round(t * HZ),
    seconds: t,
    friendlies,
    contacts: s.contacts(t) ? CONTACTS : [],
    lastKnown: [],
    squads: [0, 1, 2].map((q) => squadView(s, q, t)),
    points: POINTS.map((p) => (p.id === 'C' && s.pointLost(t) ? { ...p, owner: 'pact', progress: -1 } : p)),
    tickets: { nato: 150, pact: 150 },
    result: null,
    assets: [],
    effects: s.effects(t),
  };
}

/** Events of scenario `id` with `t0 < time <= t1`, in time order: what crossed since the last frame while playing. */
export function eventsBetween(id: ScenarioId, t0: number, t1: number): SimEvent[] {
  return SCRIPTS[id].events.filter(([t]) => t > t0 && t <= t1).map(([, e]) => e);
}
