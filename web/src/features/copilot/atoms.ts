// Copilot state (jotai). The basket and the manual inputs are persisted to
// localStorage so a plan survives reloads; the computed Plan itself is transient
// (recomputed by usePlan from these + the live character location).
import { atomWithStorage } from 'jotai/utils';
import type { RouteType } from '@/features/courierContracts/types';
import type { BasketItem } from './types';

/** Contracts/hauls the user has collected to run, deduped by `key`. */
export const basketAtom = atomWithStorage<BasketItem[]>('eve-multitool.copilot.basket.v1', []);

export interface CopilotInputs {
  /** Usable cargo capacity in m³ (null = unconstrained). */
  cargoM3: number | null;
  /** Starting wallet in millions of ISK (null = unconstrained). */
  startIskMillions: number | null;
  routeType: RouteType;
}

export const DEFAULT_COPILOT_INPUTS: CopilotInputs = {
  cargoM3: null,
  startIskMillions: null,
  routeType: 'safest',
};

export const copilotInputsAtom = atomWithStorage<CopilotInputs>(
  'eve-multitool.copilot.inputs.v1',
  DEFAULT_COPILOT_INPUTS,
  undefined,
  { getOnInit: true },
);
