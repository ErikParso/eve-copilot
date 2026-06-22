// Global hauling preferences (jotai), persisted to localStorage. These describe
// *how you haul* — ship capacity, wallet, route + opportunity preferences — and
// are shared by every page (Hauling search, Copilot plan & suggestions). Set
// them once in the Preferences drawer. Attractivity weights are a preference too
// but keep their own atom (attractivityWeightsAtom) + modal; the drawer surfaces
// that control alongside these.
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { ContractType, RouteType } from '@/features/courierContracts/types';

export interface Preferences {
  /** Usable cargo capacity in m³ (null = unconstrained). */
  cargoM3: number | null;
  routeType: RouteType;
  /** Opportunity kinds to consider; empty = all. */
  contractTypes: ContractType[];
  /**
   * Sales tax applied to arbitrage sell revenue, as a percentage (e.g. 4.5).
   * Defaults to the server's baked-in rate; lower it to match your Accounting
   * skill. Read defensively (`?? DEFAULT_SALES_TAX_PCT`) since older persisted
   * preferences predate this field.
   */
  salesTaxPct?: number;
}

/** Mid-Accounting sales tax the server bakes into profit; the FE default too. */
export const DEFAULT_SALES_TAX_PCT = 4.5;

// Note: available ISK is no longer a preference — it comes from the live wallet
// balance (esi-wallet scope), see characterWalletAtom / effectiveStartIskAtom.
export const DEFAULT_PREFERENCES: Preferences = {
  cargoM3: null,
  routeType: 'safest',
  contractTypes: [],
  salesTaxPct: DEFAULT_SALES_TAX_PCT,
};

export const preferencesAtom = atomWithStorage<Preferences>(
  'eve-multitool.preferences.v1',
  DEFAULT_PREFERENCES,
  undefined,
  { getOnInit: true },
);

/** Whether the Preferences drawer is open (so any page can open it). */
export const preferencesOpenAtom = atom(false);
