// Copilot state (jotai). The basket is persisted to localStorage so a plan
// survives reloads. The plan's constraints — cargo capacity, available ISK,
// route preference — are NOT duplicated here: they're the global preferences
// (features/preferences), with the origin from the character / haulingViewAtom.
import { atomWithStorage } from 'jotai/utils';
import type { BasketItem } from './types';

/** Contracts/hauls the user has collected to run, deduped by `key`. */
export const basketAtom = atomWithStorage<BasketItem[]>('eve-multitool.copilot.basket.v1', []);

/**
 * Live progress through the roadmap. `index` is the current step (steps before it
 * are done); `signature` ties it to a specific plan step sequence so progress
 * resets when the plan changes. Persisted so a run survives a reload.
 */
export interface RunProgress {
  signature: string;
  index: number;
}

export const runProgressAtom = atomWithStorage<RunProgress>('eve-multitool.copilot.progress.v1', {
  signature: '',
  index: 0,
});
