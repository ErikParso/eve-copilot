// Copilot state (jotai). The basket is persisted to localStorage so a plan
// survives reloads. Cargo/route/contract-type come from the global preferences;
// the plan's start ISK comes from the live wallet (frozen once a run begins).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { characterWalletAtom } from '@/features/auth/atoms';
import type { ArbitrageOpportunity, CommittedEconomics } from '@/features/arbitrage/types';
import type { BasketItem } from './types';

/** Contracts/hauls the user has collected to run, deduped by `key`. */
export const basketAtom = atomWithStorage<BasketItem[]>('eve-multitool.copilot.basket.v1', []);

/** One arbitrage reservation sent to the plan endpoint so it can subtract its depth. */
export interface ArbitrageCommitment {
  id: string;
  typeId: number;
  source: number;
  dest: number;
  quantity: number;
}

/**
 * The basket's arbitrage reservations, distilled for the plan endpoint. Courier
 * contracts are atomic (taken whole, deduped by key) so they don't consume shared
 * order depth and aren't sent. Referentially stable until the basket changes.
 */
export const commitmentsAtom = atom<ArbitrageCommitment[]>((get) => {
  const basket = get(basketAtom);
  const out: ArbitrageCommitment[] = [];
  for (const it of basket) {
    if (it.kind !== 'arbitrage') continue;
    const typeId = it.marketTypeId;
    const source = it.pickup.endpoint.locationId;
    const dest = it.dropoff.endpoint.locationId;
    const quantity = it.quantity;
    if (typeId == null || quantity == null || quantity <= 0) continue;
    out.push({ id: it.key, typeId, source, dest, quantity });
  }
  return out;
});

/** Plan-aware arbitrage from the server: opportunities net of the basket + each reservation's live worth. */
export interface CopilotPlanData {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Opportunities still available after the basket's reservations took their depth (route-free). */
  available: ArbitrageOpportunity[];
  /** Each reservation's economics re-derived over the live book, keyed by basket key. */
  committed: CommittedEconomics[];
  error: string | null;
}

export const copilotPlanDataAtom = atom<CopilotPlanData>({
  status: 'idle',
  available: [],
  committed: [],
  error: null,
});

/**
 * The basket with arbitrage economics refreshed from the live book (income /
 * cargo / capital re-derived by the plan endpoint), flagged `shortfall` when the
 * book can't fully supply a reservation and `stale` when it's dried up entirely.
 * Courier items pass through unchanged. The plan/suggestions consume this, not the
 * raw stored basket, so a market refresh keeps the plan honest.
 */
export const resolvedBasketAtom = atom<BasketItem[]>((get) => {
  const basket = get(basketAtom);
  const { committed } = get(copilotPlanDataAtom);
  const byId = new Map(committed.map((c) => [c.id, c]));
  return basket.map((it) => {
    if (it.kind !== 'arbitrage') return it;
    const c = byId.get(it.key);
    if (!c) return it; // no live data yet (loading) — keep last-known economics
    return {
      ...it,
      income: c.profit,
      cargoM3: c.totalVolume,
      capitalIsk: c.buyCost,
      quantity: c.quantity,
      shortfall: c.shortfall,
      stale: c.quantity <= 0,
    };
  });
});

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
