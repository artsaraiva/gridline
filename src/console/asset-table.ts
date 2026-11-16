// #184: each Asset's Console facts, written once: its key on the pad, the ruler it sits under, its full name and its map
// label. Total over AssetKind, so a new kind fails the typecheck until it has an entry. DOM-free, and it imports types only:
// pad.ts lays the pad out from it, layers/effects.ts writes the map labels and summary.ts the score rows from it. An Asset's
// icon is chrome/icons.ts's (`assetIcon`), which is total too.
import type { AssetKind } from '../sim/types';

/** The names the pad's rulers show (GLOSSARY.md), each over the cells it spans. */
export type Category = 'Strike' | 'Recon' | 'Screen' | 'Denial' | 'Support' | 'Standing';

export interface AssetEntry {
  /** Its key, which is its place on the pad (#181): its band is the keyboard row the key is on. */
  key: string;
  /** The ruler it sits under. */
  category: Exclude<Category, 'Standing'>;
  /** Its full name, as GLOSSARY.md writes it. */
  name: string;
  /** Its label on the map, upper-cased there: its name, but for the short ones the map has always shown (CODING_STANDARDS.md). */
  label: string;
}

export const ASSET_TABLE: Record<AssetKind, AssetEntry> = {
  scan: { key: 'A', category: 'Recon', name: 'Scan UAV', label: 'Scan UAV' },
  supply: { key: 'Z', category: 'Support', name: 'Supply Drop', label: 'Supply Drop' },
  barrage: { key: 'W', category: 'Strike', name: 'Artillery Barrage', label: 'Barrage' },
  missile: { key: 'R', category: 'Strike', name: 'Cruise Missile', label: 'Missile' },
  gunship: { key: 'T', category: 'Strike', name: 'Gunship', label: 'Gunship' },
  smoke: { key: 'D', category: 'Screen', name: 'Smoke Screen', label: 'Smoke Screen' },
  creep: { key: 'E', category: 'Strike', name: 'Creeping Barrage', label: 'Creeping Barrage' },
  drone: { key: 'Q', category: 'Strike', name: 'Drone Strike', label: 'Drone Strike' },
  recon: { key: 'S', category: 'Recon', name: 'Recon Plane', label: 'Recon Plane' },
  beacon: { key: 'X', category: 'Support', name: 'Redeploy Beacon', label: 'Beacon' },
  rapid: { key: 'C', category: 'Support', name: 'Rapid Deploy', label: 'Rapid Deploy' },
  emp: { key: 'F', category: 'Denial', name: 'EMP Strike', label: 'EMP Strike' },
  feint: { key: 'G', category: 'Denial', name: 'Feint', label: 'Feint' },
};
