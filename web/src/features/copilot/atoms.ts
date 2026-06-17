// Copilot state (jotai). The basket is persisted to localStorage so a plan
// survives reloads. Cargo/route/contract-type come from the global preferences;
// the plan's start ISK comes from the live wallet (frozen once a run begins).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { characterWalletAtom } from '@/features/auth/atoms';
import type { BasketItem } from './types';

/** Contracts/hauls the user has collected to run, deduped by `key`. */
export const basketAtom = atomWithStorage<BasketItem[]>('eve-multitool.copilot.basket.v1', []);

/**
 * Live progress through the roadmap. `index` is the current step (steps before it
 * are done); `signature` ties it to a specific plan step sequence so progress
 * resets when the plan changes. `startIsk` freezes the wallet balance at the
 * moment the run started, so the forward simulation doesn't double-count buys you
 * make mid-run (null while still at step 0). Persisted so a run survives reload.
 */
export interface RunProgress {
  signature: string;
  index: number;
  startIsk: number | null;
}

export const runProgressAtom = atomWithStorage<RunProgress>('eve-multitool.copilot.progress.v1', {
  signature: '',
  index: 0,
  startIsk: null,
});

/**
 * The ISK the plan simulates from: the frozen balance once a run is underway,
 * otherwise the live wallet balance (null = no wallet / unconstrained).
 */
export const effectiveStartIskAtom = atom<number | null>((get) => {
  const p = get(runProgressAtom);
  if (p.index > 0 && p.startIsk !== null) return p.startIsk;
  return get(characterWalletAtom)?.balance ?? null;
});
