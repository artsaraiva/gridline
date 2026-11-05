// The running match as the Console sees it; match-flow writes it, the layers and chrome read it.
import type { SimHost } from '../host/host';
import type { CommanderView, SideId } from '../sim/types';

export const session = {
  host: null as SimHost | null,
  commanderSide: 'nato' as SideId,
  enemySide: 'pact' as SideId,
  /** The latest sampled view; main.ts writes it every frame, targeting and chrome read it. */
  view: null as CommanderView | null,
  seed: 0,
  ended: false,
};
