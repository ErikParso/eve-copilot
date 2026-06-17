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
  /** Wallet / max ISK to commit, in millions (null = unconstrained). */
  availableIskMillions: number | null;
  routeType: RouteType;
  /** Opportunity kinds to consider; empty = all. */
  contractTypes: ContractType[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  cargoM3: null,
  availableIskMillions: null,
  routeType: 'safest',
  contractTypes: [],
};

export const preferencesAtom = atomWithStorage<Preferences>(
  'eve-multitool.preferences.v1',
  DEFAULT_PREFERENCES,
  undefined,
  { getOnInit: true },
);

/** Whether the Preferences drawer is open (so any page can open it). */
export const preferencesOpenAtom = atom(false);
