// The colour role of a vehicle's tactical icon (#107 tank, #108 jeep, #109 helicopter), shared by their layers.
import type { SideId, VehicleView } from '../../sim/types';

/**
 * A vehicle's tactical icon's colour role (#107 tank, #108 jeep): the Side's (friendly, hostile), grey-white while nobody is
 * aboard, amber while the selected Squad (Soldier ids `selected`) has anyone aboard, as its chevrons are; a Wreck has none.
 */
export function vehicleIcon(v: VehicleView, mySide: SideId, selected: number[] = []): 'friendly' | 'hostile' | 'empty' | 'selected' | null {
  if (v.wreck) return null;
  if (v.seats?.some((id) => id >= 0 && selected.includes(id))) return 'selected';
  return v.empty ? 'empty' : v.side === mySide ? 'friendly' : 'hostile';
}

/**
 * #143: the share of its colour a vehicle's tactical icon shows: dimmed toward black while an EMP Strike holds it (layers/emp.ts
 * sets a bolt beside it), else in full. A darker colour dims the glowing icons and the flat ones alike, where opacity does not.
 */
export const iconDim = (v: VehicleView) => (v.disabled ? HELD_DIM : 1);
const HELD_DIM = 0.35;
