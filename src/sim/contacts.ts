// #183: the Contacts each Side's Assets show (assets/core.ts `assetContacts`), for the rules that aim at them without importing the
// Assets (#110: a jet's pass and its cannon, vehicles/jet.ts). The Asset core provides its reader as it loads; the Match never runs
// without it (index.ts imports it), so a rule asking before then is a wiring fault and throws.
import type { Match } from './index';
import type { Soldier } from './state';
import type { SideId } from './types';

type Reader = (m: Match, side: SideId) => Soldier[];
let reader: Reader | undefined;

/** assets/core.ts: the Assets' Contacts reader. */
export const provideContacts = (f: Reader) => void (reader = f);

/** The enemies of `side` its Assets show as Contacts right now. */
export function contactsOf(m: Match, side: SideId): Soldier[] {
  if (!reader) throw new Error('contactsOf: the Asset core has not loaded (assets/core.ts provides the reader)');
  return reader(m, side);
}
