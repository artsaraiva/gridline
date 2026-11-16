// #184: each Asset's Console facts, written once: its key on the pad, the ruler it sits under and its full name. Total over
// AssetKind, so a new kind fails the typecheck until it has an entry. DOM-free, and it imports types only: pad.ts lays the
// pad out from it. An Asset's icon is chrome/icons.ts's (`assetIcon`), which is total too.
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
}

export const ASSET_TABLE: Record<AssetKind, AssetEntry> = {
  scan: { key: 'A', category: 'Recon', name: 'Scan UAV' },
  supply: { key: 'Z', category: 'Support', name: 'Supply Drop' },
  barrage: { key: 'W', category: 'Strike', name: 'Artillery Barrage' },
  missile: { key: 'R', category: 'Strike', name: 'Cruise Missile' },
  gunship: { key: 'T', category: 'Strike', name: 'Gunship' },
  smoke: { key: 'D', category: 'Screen', name: 'Smoke Screen' },
  creep: { key: 'E', category: 'Strike', name: 'Creeping Barrage' },
  drone: { key: 'Q', category: 'Strike', name: 'Drone Strike' },
  recon: { key: 'S', category: 'Recon', name: 'Recon Plane' },
  beacon: { key: 'X', category: 'Support', name: 'Redeploy Beacon' },
  rapid: { key: 'C', category: 'Support', name: 'Rapid Deploy' },
  emp: { key: 'F', category: 'Denial', name: 'EMP Strike' },
  feint: { key: 'G', category: 'Denial', name: 'Feint' },
};
