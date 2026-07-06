import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { CompanionMessage } from './types';

// The companion's output feed is in-memory only — it starts empty on every reload
// (no persistence), capped on write (see useCompanion) so it never grows unbounded.
export const companionMessagesAtom = atom<CompanionMessage[]>([]);

/** Flip to true (in the console or via `localStorage`) to log every assembled
 * context + token estimate and expose live state on `window.__companion`. */
export const companionDebugAtom = atomWithStorage<boolean>('companion.debug', false);

/** Whether text-to-speech is muted (persisted across sessions). */
export const companionMutedAtom = atomWithStorage<boolean>('companion.muted', false);

/** Max stored panel messages. */
export const MSG_CAP = 50;
