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

export const assetIcon = (asset: AssetKind, strokeWidth = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${PATHS[asset]}</svg>`;

