// Copilot state (jotai). The basket is persisted to localStorage so a plan
// survives reloads. The plan's constraints — cargo capacity, available ISK,
// route preference and current location — are NOT duplicated here: they're the
// shared Hauling filters (draftFiltersAtom), edited once and read by both pages.
import { atomWithStorage } from 'jotai/utils';
import type { BasketItem } from './types';

/** Contracts/hauls the user has collected to run, deduped by `key`. */
export const basketAtom = atomWithStorage<BasketItem[]>('eve-multitool.copilot.basket.v1', []);
