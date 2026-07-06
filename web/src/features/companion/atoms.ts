import { atomWithStorage } from 'jotai/utils';
import type { CompanionMessage } from './types';

// The companion's output feed persists in the browser (no server disk), capped on
// write (see useCompanion) so localStorage never overflows.
export const companionMessagesAtom = atomWithStorage<CompanionMessage[]>('companion.messages', []);

/** Flip to true (in the console or via `localStorage`) to log every assembled
 * context + token estimate and expose live state on `window.__companion`. */
export const companionDebugAtom = atomWithStorage<boolean>('companion.debug', false);

/** Max stored panel messages. */
export const MSG_CAP = 50;
