// Hand-drawn SVG line icons (1.6 px stroke) for the Assets.
import type { AssetKind, VehicleKind } from '../../sim/types';
import { DRONE_OUTLINE } from '../sprites/drone';
import { FEINT_CANOPY, FEINT_FIGURE, FEINT_HEAD, FEINT_LINES } from '../sprites/feint';
import { GUNSHIP_OUTLINE } from '../sprites/gunship';
import { MISSILE_OUTLINE } from '../sprites/missile';
import { RECON_OUTLINE } from '../sprites/recon';

/** A map icon's outline (symbol units, nose +y), filled, nose up-right, for the Asset row. */
const filled = (outline: [number, number][], size: number) => `<path fill="currentColor" stroke-width="0.6" transform="rotate(45 12 12)" d="M${outline.map(([x, y]) => `${(12 + x * size).toFixed(2)} ${(12 - y * size).toFixed(2)}`).join('L')}Z"/>`;
/** The same missile, filled, nose up-right, for the Asset row. */
export const MISSILE_ICON = filled(MISSILE_OUTLINE, 14);
/** #101: the same Gunship. */
export const GUNSHIP_ICON = filled(GUNSHIP_OUTLINE, 13);
/** #139: the same drone and Recon Plane. */
export const DRONE_ICON = filled(DRONE_OUTLINE, 14);
export const RECON_ICON = filled(RECON_OUTLINE, 14);

/** #138: the Smoke Screen: a filled cloud over the ground line. */
export const SMOKE_ICON = '<path fill="currentColor" stroke-width="0.6" d="M6.5 16.5a3.6 3.6 0 0 1-.6-7.1 4.6 4.6 0 0 1 8.7-1.6 3.9 3.9 0 0 1 3.6 8.7z"/><path d="M3.5 20.5h17"/>';
/** #138: the Creeping Barrage: three filled shells stepping along the arrow under them. */
export const CREEP_ICON = '<path fill="currentColor" stroke-width="0.6" d="M4.6 5.5l1.5 2.6v6H3.1v-6z M11 3.5l1.5 2.6v8H9.5v-8z M17.4 5.5l1.5 2.6v6h-3v-6z"/><path d="M3 19.5h16.5M17.5 17l3 2.5-3 2.5"/>';

/** #142: the Redeploy Beacon: a case, its mast and the filled light on top, signal arcs either side. */
export const BEACON_ICON = '<path d="M8.5 16.5h7v4.5h-7z"/><path d="M12 16.5V7.2"/><circle cx="12" cy="5.8" r="1.5" fill="currentColor"/><path d="M8.6 3.4a4.6 4.6 0 0 0 0 4.8M15.4 3.4a4.6 4.6 0 0 1 0 4.8M6 2a8 8 0 0 0 0 7.6M18 2a8 8 0 0 1 0 7.6"/>';
/** #142: Rapid Deploy: a stopwatch with two chevrons running through it. */
export const RAPID_ICON = '<circle cx="12" cy="13.5" r="7.8"/><path d="M12 3v2.2M9.8 3h4.4"/><path d="M8.4 10.5l3 3-3 3M12.6 10.5l3 3-3 3"/>';

/** #143: the EMP Strike: a filled bolt between two arcs of its pulse. */
export const EMP_ICON = '<path fill="currentColor" stroke-width="0.6" d="M13.6 2.5 6.6 13.2h5l-1.6 8.3 7.6-11h-5.1z"/><path d="M4.2 6.5a9.6 9.6 0 0 0 0 11M19.8 6.5a9.6 9.6 0 0 1 0 11"/>';
/** A symbol outline (symbol units, y up) laid flat on the 24 px icon box, `size` px a unit. */
const flat = (pts: [number, number][], size: number) => `M${pts.map(([x, y]) => `${(12 + x * size).toFixed(2)} ${(12 - y * size).toFixed(2)}`).join('L')}Z`;
/** #143: the Feint: the map's icon, the dummy under its canopy, filled. */
export const FEINT_ICON = `<path fill="currentColor" stroke-width="0.6" d="${flat(FEINT_CANOPY, 15)}${flat(FEINT_FIGURE, 15)}"/><circle cx="${12 + FEINT_HEAD.x * 15}" cy="${12 - FEINT_HEAD.y * 15}" r="${FEINT_HEAD.r * 15}" fill="currentColor" stroke-width="0.6"/><path d="${FEINT_LINES.map(([x0, y0, x1, y1]) => `M${12 + x0 * 15} ${12 - y0 * 15}L${12 + x1 * 15} ${12 - y1 * 15}`).join('')}"/>`;

const PATHS: Record<AssetKind, string> = {
  scan: '<path d="M12 2.5v18.5M2.5 11l9.5-1.8 9.5 1.8M8.3 19.8h7.4"/><circle cx="12" cy="9.4" r="1.1" fill="currentColor"/>',
  supply: '<path d="M3.5 10a8.5 6.5 0 0 1 17 0Zm0 0 6.3 5.6m10.7-5.6-6.3 5.6M12 10v5.6"/><path d="M8.6 15.6h6.8v5.4H8.6z"/><path d="M8.6 18.3h6.8"/>',
  barrage: '<path d="M5.5 3.5l1.6 3v8H3.9v-8z M12 6.5l1.6 3v8h-3.2v-8z M18.5 3.5l1.6 3v8h-3.2v-8z"/><path d="M3.5 18.5h17M5 21h14"/>',
  missile: MISSILE_ICON,
  gunship: GUNSHIP_ICON,
  smoke: SMOKE_ICON,
  creep: CREEP_ICON,
  drone: DRONE_ICON,
  recon: RECON_ICON,
  beacon: BEACON_ICON,
  rapid: RAPID_ICON,
  emp: EMP_ICON,
  feint: FEINT_ICON,
};

/** #107: the Squad tile and card's badge for one member aboard a tank: a filled side-on hull, turret and gun. */
export const TANK_BADGE = '<svg class="tank" viewBox="0 0 24 14" fill="currentColor"><path d="M2 8h20l-2 5H4z"/><path d="M7 4h8l1 4H6z"/><path d="M15 5h8v1.4h-8z"/></svg>';
/** #108: the badge for one member aboard a jeep: a filled side-on body with its bonnet, windscreen and two wheels. */
export const JEEP_BADGE = '<svg class="jeep" viewBox="0 0 24 14" fill="currentColor"><path d="M2 5h12l2 3h6v3H2z"/><path d="M12 1h1.6l1.4 4h-1.6z"/><circle cx="6" cy="11.5" r="2.5"/><circle cx="18" cy="11.5" r="2.5"/></svg>';
/** #109: the badge for one member aboard a helicopter: a filled side-on cabin and glazed nose, tail boom and fin, skids, the rotor over it. */
export const HELI_BADGE = '<svg class="heli" viewBox="0 0 24 14" fill="currentColor"><path d="M1 2.2h22v1.2H1z"/><path d="M11.4 3.4h1.2v1.6h-1.2z"/><path d="M6 5h9.5l2.5 2.4v2.6H6z"/><path d="M16 6.4h3l-1-1.4z"/><path d="M1 6.2h5v1.6H1z"/><path d="M0.6 4.4h1.4l0.8 3.4H1.2z"/><path d="M5 12h14v1H5z"/><path d="M8 10h1v2H8zM15 10h1v2h-1z"/></svg>';
/** #110: the badge for a jet's pilot: a filled side-on fuselage and pointed nose, the swept wing under it and the tail fin. */
export const JET_BADGE = '<svg class="jet" viewBox="0 0 24 14" fill="currentColor"><path d="M1 7.2l3-1.4h13.5l5.5 1.6-5.5 1.4H4z"/><path d="M2.2 6l-1.2-5h2.2l4.4 5z"/><path d="M8.5 8.6h6l-5.4 4.6H7.2z"/></svg>';
/** #110: the badge for an AA's crewman: a filled side-on hull, a turret with its radar mast and two cannons raised high. */
export const AA_BADGE = '<svg class="aa" viewBox="0 0 24 14" fill="currentColor"><path d="M2 9h20l-2 4H4z"/><path d="M6 5.5h10v3.5H6z"/><path d="M14.2 6.4l7-5.4 0.9 1.1-7 5.4z"/><path d="M13.4 5.4l6.2-4.8 0.8 1-6.2 4.8z"/><path d="M8 2.5h1.2v3H8z"/><path d="M6 1.2h5.2v1.6H6z"/></svg>';
/** #101: the badge for a member aboard the Gunship: a filled side-on fuselage, high wing with two engines under it, the tall fin and a gun port. */
export const GUNSHIP_BADGE = '<svg class="gunship" viewBox="0 0 24 14" fill="currentColor"><path d="M1.5 7.2l2-1.8h15.5l3.5 2-3.5 2.2H3.5z"/><path d="M18 5.6l1.6-4.6h2.2l-1 4.6z"/><path d="M7 4.4h11v1H7z"/><path d="M8.6 5.4h2.2v1.6H8.6zM13.6 5.4h2.2v1.6h-2.2z"/><path d="M5 8.2h1.6v1.6H5z" fill-opacity="0.45"/></svg>';
/** The badge of each vehicle class, for the Squad tile and card. */
export const VEHICLE_BADGE: Record<VehicleKind, string> = { tank: TANK_BADGE, jeep: JEEP_BADGE, helicopter: HELI_BADGE, jet: JET_BADGE, aa: AA_BADGE, gunship: GUNSHIP_BADGE, drone: '', recon: '' }; // #139: nobody is ever aboard a drone or the Recon Plane

export const assetIcon = (asset: AssetKind, strokeWidth = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${PATHS[asset]}</svg>`;

