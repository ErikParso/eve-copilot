// Copilot state (jotai). The plan (the current run's chosen stops) and the ship
// inventory are persisted to localStorage so a run survives reloads. Cargo/route
// come from the global preferences; the plan's start ISK comes from the live
// wallet (frozen once a run begins). Buy and sell runs are mutually exclusive and
// share the inventory — switching modes clears the plan but keeps the cargo.
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { characterWalletAtom } from '@/features/auth/atoms';
import { addHolding, removeHolding, type Holding, type RunMode, type RunStop } from './types';

/** Which run is active. Buy and sell runs are mutually exclusive; both share `inventoryAtom`. */
export const runModeAtom = atomWithStorage<RunMode>('eve-multitool.copilot.runMode.v1', 'buy');

/** The current run's chosen stops (buy or sell), deduped by `key`. Cleared on mode switch. */
export const planAtom = atomWithStorage<RunStop[]>('eve-multitool.copilot.plan.v1', []);

/**
 * The ship's current cargo, maintained by the Copilot (ESI can't read it). Starts
 * empty, persists across reloads and mode switches, and is mutated by completing
 * buy/sell steps or by hand-editing the inventory panel.
 */
export const inventoryAtom = atomWithStorage<Holding[]>('eve-multitool.copilot.inventory.v1', []);

/** Total cargo volume currently held (m³). */
export const inventoryVolumeAtom = atom<number>((get) =>
  get(inventoryAtom).reduce((sum, h) => sum + h.qty * h.unitVolumeM3, 0),
);

/** Record a completed buy: merge the lot into inventory with a weighted-average cost basis. */
export const recordBuyAtom = atom(null, (_get, set, lot: Holding) => {
  set(inventoryAtom, (prev) => addHolding(prev, lot));
});

/** Record a completed sell: shrink the held stack by `qty`. */
export const recordSellAtom = atom(null, (_get, set, p: { typeId: number; qty: number }) => {
  set(inventoryAtom, (prev) => removeHolding(prev, p.typeId, p.qty));
});

/**
 * The ISK the plan simulates from: the live wallet balance (null = no wallet /
 * unconstrained). No freeze is needed — completing a buy step removes it from the
 * plan and lands the stock in inventory, so a spent buy is never double-counted.
 */
export const effectiveStartIskAtom = atom<number | null>(
  (get) => get(characterWalletAtom)?.balance ?? null,
);

/**
 * Complete a step: drop it from the plan and mutate the inventory (a buy lands its
 * lot in the hold; a sell shrinks the held stack). The planner then re-optimises
 * the remaining stops from the live wallet/cargo.
 */
export const completeStopAtom = atom(null, (_get, set, stop: RunStop) => {
  set(planAtom, (prev) => prev.filter((s) => s.key !== stop.key));
  if (stop.mode === 'buy') {
    set(inventoryAtom, (prev) =>
      addHolding(prev, {
        typeId: stop.typeId,
        itemName: stop.itemName,
        qty: stop.quantity,
        unitVolumeM3: stop.quantity > 0 ? stop.cargoM3 / stop.quantity : 0,
        unitCostBasis: stop.quantity > 0 ? stop.capitalIsk / stop.quantity : 0,
      }),
    );
  } else {
    set(inventoryAtom, (prev) => removeHolding(prev, stop.typeId, stop.quantity));
  }
});
