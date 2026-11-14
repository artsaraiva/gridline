// The Asset keypad (#181): the Asset rail as a pad of 48 px cells in three bands that mirror the keyboard's letter rows,
// Strikes on Q to T, Recon · Screen · Denial on A to G, Support · Standing on Z to B, each band under a ruler that names its
// categories. A cell's key is its place on the pad, and the slot of an Asset or standing action that has not shipped is held
// empty, so no key moves when it lands. DOM-free: chrome/assets.ts draws the pad, chrome/mark.ts runs the Mark cell.
import { DEFAULT_TUNE } from '../sim/tune';
import type { AssetKind, CommanderView, PointView, SquadView } from '../sim/types';
import { clock } from './summary';

/** The names the rulers show (GLOSSARY.md), each over the cells it spans. */
export type Category = 'Strike' | 'Recon' | 'Screen' | 'Denial' | 'Support' | 'Standing';

export interface PadCell {
  /** The band, 0 at the top, and the key: the cell's place on the keyboard. */
  band: number;
  key: string;
  category: Category;
  name: string;
  /** What it calls: an Asset, the Mark (a standing action), or nothing yet: its slot is held until `name` ships. */
  calls: AssetKind | 'mark' | null;
}

/** The cells band by band, in key order. Strikes run light to heavy, so the point-gated Cruise Missile and Gunship keep R and T. */
export const PAD: PadCell[] = [
  { band: 0, key: 'Q', category: 'Strike', name: 'Drone Strike', calls: 'drone' },
  { band: 0, key: 'W', category: 'Strike', name: 'Artillery Barrage', calls: 'barrage' },
  { band: 0, key: 'E', category: 'Strike', name: 'Creeping Barrage', calls: 'creep' },
  { band: 0, key: 'R', category: 'Strike', name: 'Cruise Missile', calls: 'missile' },
  { band: 0, key: 'T', category: 'Strike', name: 'Gunship', calls: 'gunship' },
  { band: 1, key: 'A', category: 'Recon', name: 'Scan UAV', calls: 'scan' },
  { band: 1, key: 'S', category: 'Recon', name: 'Recon Plane', calls: 'recon' },
  { band: 1, key: 'D', category: 'Screen', name: 'Smoke Screen', calls: 'smoke' },
  { band: 1, key: 'F', category: 'Denial', name: 'EMP Strike', calls: null }, // #143
  { band: 1, key: 'G', category: 'Denial', name: 'Feint', calls: null }, // #143
  { band: 2, key: 'Z', category: 'Support', name: 'Supply Drop', calls: 'supply' },
  { band: 2, key: 'X', category: 'Support', name: 'Redeploy Beacon', calls: 'beacon' },
  { band: 2, key: 'C', category: 'Support', name: 'Rapid Deploy', calls: 'rapid' },
  { band: 2, key: 'V', category: 'Standing', name: 'Mark', calls: 'mark' },
  { band: 2, key: 'B', category: 'Standing', name: 'Vehicle tasking', calls: null }, // #146
];

/** Pad geometry in px (console.css sizes the same boxes): a cell, the gap between cells and under a ruler, a ruler, and between bands. */
export const PAD_PX = { cell: 48, gap: 4, ruler: 12, band: 10 };
const BANDS = 1 + Math.max(...PAD.map((c) => c.band));
/** The width of `n` cells side by side. */
export const spanPx = (n: number) => n * PAD_PX.cell + (n - 1) * PAD_PX.gap;
/** The whole pad in px: 256 × 212. */
export const PAD_SIZE = { w: spanPx(PAD.length / BANDS), h: BANDS * (PAD_PX.ruler + PAD_PX.gap + PAD_PX.cell) + (BANDS - 1) * PAD_PX.band };

/** Band `band`'s ruler: its categories in key order, each with the number of cells it spans. */
export function ruler(band: number): { category: Category; span: number }[] {
  const out: { category: Category; span: number }[] = [];
  for (const c of PAD.filter((c) => c.band === band)) {
    const last = out.at(-1);
    if (last?.category === c.category) last.span++;
    else out.push({ category: c.category, span: 1 });
  }
  return out;
}

/** #101: whether `asset` can be armed in `view`: ready, or at work and taking a new spot (the Gunship's focus) on its cooldown. */
export function callable(asset: AssetKind, view: CommanderView): boolean {
  const a = view.assets?.find((x) => x.asset === asset);
  return !view.result && !!a && (a.readyIn === 0 || !!a.retask) && !a.off;
}

/**
 * #150: the keystone Capture Points a point-gated Asset still needs, in the order its `off` names them ("needs E, H", from
 * sim/assets/missile.ts `heavyGate`); none when it is off for another reason, or not off.
 */
export function keystonesMissing(off: string | undefined, points: PointView[]): PointView[] {
  const names = off?.startsWith('needs ') ? off.slice('needs '.length).split(', ') : [];
  return names.flatMap((n) => points.filter((p) => p.name === n));
}

/**
 * The time `asset` has left at work: its own effect's that works longest (#99 never the enemy's missile; #101 nor a Gunship
 * off station; #139 nor an aircraft shot down, whose fall the effect only stays on to show), or #142 an untargeted one's.
 */
export function atWork(asset: AssetKind, view: CommanderView): { left: number; total: number } | undefined {
  const up = view.assets?.find((a) => a.asset === asset)?.up;
  return up ?? view.effects?.filter((e) => e.asset === asset && (e.side ?? view.side) === view.side && !e.lost && (e.asset !== 'gunship' || e.left > 0)).sort((p, q) => q.left - p.left)[0];
}

export type CellState = 'ready' | 'cooling' | 'active' | 'off' | 'armed';

export interface CellLook {
  state: CellState;
  /** Under the icon: the timer, or while armed the Grid Reference; '' for nothing. A gated cell shows `needs` there instead. */
  slot: string;
  /** Gated: the keystone Capture Points still missing, each drawn in its holder's frame. */
  needs: PointView[];
  /** The icon sits high, clear of the slot. */
  lift: boolean;
  /** The bar along the bottom edge, 0..1: the time left at work, or the cooldown left (an off cell's keeps draining). */
  bar: number;
  /** The Squad whose open Request asks for this Asset, the soonest to expire: the cell carries the amber corner. */
  request: SquadView | undefined;
  /** The readout's state: READY, the timer, UP and the time left, NEEDS (the frames follow), why it is off, or the Request's Squad and Grid Reference (in amber); '' while armed, when the readout names it alone. */
  readout: string;
}

/**
 * How `asset`'s cell reads in `view`. `armed`: it is armed, and `at` is the Grid Reference under the pointer or of the pinned
 * spot. Gated (off for keystones it still needs) outranks at work, as the old rail's off did; an Asset off for another
 * reason (a drone already in the air) reads at work while its effect is on the map.
 */
export function assetLook(asset: AssetKind, view: CommanderView, armed: boolean, at: string): CellLook {
  const a = view.assets?.find((x) => x.asset === asset);
  const fx = atWork(asset, view);
  const needs = keystonesMissing(a?.off, view.points);
  const request = view.squads.filter((q) => q.request?.asset === asset).sort((p, q) => p.request!.left - q.request!.left)[0];
  const state: CellState = !a ? 'off' : armed ? 'armed' : needs.length ? 'off' : fx ? 'active' : a.off ? 'off' : a.readyIn > 0 ? 'cooling' : 'ready';
  const slot = state === 'armed' ? (a!.untargeted ? '' : at) : state === 'active' ? clock(Math.ceil(fx!.left)) : state === 'cooling' ? clock(Math.ceil(a!.readyIn)) : '';
  const bar = state === 'active' ? fx!.left / fx!.total : (state === 'cooling' || state === 'off') && a ? a.readyIn / a.cooldown : 0;
  const readout =
    state === 'armed' ? '' : request ? requestTag(request) : needs.length ? 'NEEDS' : state === 'active' ? `UP ${slot}` : state === 'off' ? (a?.off ?? '—').toUpperCase() : state === 'cooling' ? slot : 'READY';
  return { state, slot, needs, lift: state === 'armed' ? !a!.untargeted : slot !== '' || needs.length > 0, bar, request, readout };
}

/** An open Request as the readout names it: "CHARLIE · J4". */
const requestTag = (q: SquadView) => [q.name.toUpperCase(), q.request?.grid].filter(Boolean).join(' · ');

/** #136: the Mark cell's count: the live Marks of the most there may be ("1/3"). */
export const markCount = (view: CommanderView) => `${view.marks?.length ?? 0}/${DEFAULT_TUNE.markMax}`;
