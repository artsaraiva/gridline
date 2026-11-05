// The running match as the Console sees it; match-flow writes it, the layers and chrome read it.
import type { SimHost } from '../host/host';
import type { SideId } from '../sim/types';

export const session = {
  host: null as SimHost | null,
  commanderSide: 'nato' as SideId,
  enemySide: 'pact' as SideId,
  seed: 0,
  ended: false,
};
