// Hand-drawn SVG line icons (1.6 px stroke) for the 3 Assets and the APP-6 friendly infantry frame for the Squad card.
import type { AssetKind } from '../../sim/types';

const PATHS: Record<AssetKind, string> = {
  scan: '<path d="M12 2.5v18.5M2.5 11l9.5-1.8 9.5 1.8M8.3 19.8h7.4"/><circle cx="12" cy="9.4" r="1.1" fill="currentColor"/>',
  supply: '<path d="M3.5 10a8.5 6.5 0 0 1 17 0Zm0 0 6.3 5.6m10.7-5.6-6.3 5.6M12 10v5.6"/><path d="M8.6 15.6h6.8v5.4H8.6z"/><path d="M8.6 18.3h6.8"/>',
  barrage: '<path d="M5.5 3.5l1.6 3v8H3.9v-8z M12 6.5l1.6 3v8h-3.2v-8z M18.5 3.5l1.6 3v8h-3.2v-8z"/><path d="M3.5 18.5h17M5 21h14"/>',
};

export const assetIcon = (asset: AssetKind, strokeWidth = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${PATHS[asset]}</svg>`;

export const FRAME_SVG =
  '<svg viewBox="0 0 30 22"><circle cx="15" cy="-3" r="1.6" fill="currentColor"/><rect x="1" y="2" width="28" height="18" fill="rgba(111,208,255,.15)" stroke="currentColor" stroke-width="1.8"/><path d="M1 2l28 18M29 2L1 20" stroke="currentColor" stroke-width="1.4"/></svg>';
