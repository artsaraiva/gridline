// Hand-drawn SVG line icons (1.6 px stroke) for the Assets.
import type { AssetKind } from '../../sim/types';
import { MISSILE_OUTLINE } from '../sprites/missile';

/** The same missile, filled, nose up-right, for the Asset row. */
export const MISSILE_ICON = `<path fill="currentColor" stroke-width="0.6" transform="rotate(45 12 12)" d="M${MISSILE_OUTLINE.map(([x, y]) => `${(12 + x * 14).toFixed(2)} ${(12 - y * 14).toFixed(2)}`).join('L')}Z"/>`;

const PATHS: Record<AssetKind, string> = {
  scan: '<path d="M12 2.5v18.5M2.5 11l9.5-1.8 9.5 1.8M8.3 19.8h7.4"/><circle cx="12" cy="9.4" r="1.1" fill="currentColor"/>',
  supply: '<path d="M3.5 10a8.5 6.5 0 0 1 17 0Zm0 0 6.3 5.6m10.7-5.6-6.3 5.6M12 10v5.6"/><path d="M8.6 15.6h6.8v5.4H8.6z"/><path d="M8.6 18.3h6.8"/>',
  barrage: '<path d="M5.5 3.5l1.6 3v8H3.9v-8z M12 6.5l1.6 3v8h-3.2v-8z M18.5 3.5l1.6 3v8h-3.2v-8z"/><path d="M3.5 18.5h17M5 21h14"/>',
  missile: MISSILE_ICON,
};

/** #107: the Squad tile and card's badge for one member aboard a tank: a filled side-on hull, turret and gun. */
export const TANK_BADGE = '<svg class="tank" viewBox="0 0 24 14" fill="currentColor"><path d="M2 8h20l-2 5H4z"/><path d="M7 4h8l1 4H6z"/><path d="M15 5h8v1.4h-8z"/></svg>';
/** #108: the badge for one member aboard a jeep: a filled side-on body with its bonnet, windscreen and two wheels. */
/** #109: the badge for one member aboard a helicopter: a filled side-on cabin and glazed nose, tail boom and fin, skids, the rotor over it. */
export const HELI_BADGE = '<svg class="heli" viewBox="0 0 24 14" fill="currentColor"><path d="M1 2.2h22v1.2H1z"/><path d="M11.4 3.4h1.2v1.6h-1.2z"/><path d="M6 5h9.5l2.5 2.4v2.6H6z"/><path d="M16 6.4h3l-1-1.4z"/><path d="M1 6.2h5v1.6H1z"/><path d="M0.6 4.4h1.4l0.8 3.4H1.2z"/><path d="M5 12h14v1H5z"/><path d="M8 10h1v2H8zM15 10h1v2h-1z"/></svg>';
export const JEEP_BADGE = '<svg class="jeep" viewBox="0 0 24 14" fill="currentColor"><path d="M2 5h12l2 3h6v3H2z"/><path d="M12 1h1.6l1.4 4h-1.6z"/><circle cx="6" cy="11.5" r="2.5"/><circle cx="18" cy="11.5" r="2.5"/></svg>';

export const assetIcon = (asset: AssetKind, strokeWidth = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${PATHS[asset]}</svg>`;

