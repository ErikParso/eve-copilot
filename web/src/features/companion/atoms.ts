import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/** True while a reaction request is in flight (LLM + TTS) — drives the orb's
 * "thinking" state. In-memory. */
export const companionBusyAtom = atom(false);

/** Flip to true (in the console or via `localStorage`) to log each reaction request
 * and expose live state on `window.__companion`. */
export const companionDebugAtom = atomWithStorage<boolean>('companion.debug', false);

/** Whether the companion voice is muted (persisted; no UI toggle — set via
 * `localStorage['companion.muted']`). */
export const companionMutedAtom = atomWithStorage<boolean>('companion.muted', false);
