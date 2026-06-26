import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { ArbitrageItem, ArbitrageRung } from './types';
import type { ContractEndpoint, CourierRow, RouteSystem } from '@/features/courierContracts/types';

export interface PinnedRoute {
  route: RouteSystem[] | null;
  jumps: number | null;
}

export const pinnedRoutesAtom = atom<Record<string, PinnedRoute>>({});

export interface PinnedHaul extends ArbitrageItem {
  // Lifecycle status
  status: 'planning' | 'transit' | 'executed';
  
  // Original values captured at the moment of pinning — the fixed baseline every
  // later revalidation is compared against (income up/down/zero vs this). Also the
  // defaults for the Confirm-Buy dialog, since the live values may have collapsed
  // (e.g. you bought the stock yourself, emptying the sell orders).
  originalProfit?: number;
  originalQuantity?: number;
  originalBuyPrice?: number;
  
  // User-confirmed buy details (used during transit)
  boughtQuantity?: number;
  boughtPrice?: number;
  
  buyerGone?: boolean;
  /** No asks left at the source (supply gone; planning hauls only). */
  supplyGone?: boolean;
  shortfall?: boolean;
  /** The specific orders backing this haul changed since the last check. */
  stale?: boolean;
  /** Live order IDs backing the haul — echoed back so the server can flag `stale`. */
  sourceOrderIds?: number[];
  destOrderIds?: number[];

  // Visual status and style compared to baseline (pre-computed on server)
  statusKind?: 'up' | 'down' | 'zero' | null;
  statusMessage?: string;
  borderColor?: string;
}

export interface PinnedCourier extends CourierRow {
  status: 'planned' | 'secured' | 'executed';
  unavailable?: boolean;
}

export const pinnedHaulsAtom = atomWithStorage<PinnedHaul[]>('eve-multitool.pinnedHauls.v1', []);
export const haulingRefreshTriggerAtom = atom(0);
export const pinnedCouriersAtom = atomWithStorage<PinnedCourier[]>('eve-multitool.pinnedCouriers.v1', []);

export const pinCourierAtom = atom(null, (get, set, item: CourierRow) => {
  const current = get(pinnedCouriersAtom);
  if (current.some((c) => c.id === item.id)) return;
  const pinned: PinnedCourier = {
    ...item,
    status: 'planned',
  };
  set(pinnedCouriersAtom, [...current, pinned]);
});

export const secureCourierAtom = atom(null, (_get, set, id: number) => {
  set(pinnedCouriersAtom, (prev) =>
    prev.map((c) => (c.id === id ? { ...c, status: 'secured' } : c))
  );
});

export const executeCourierAtom = atom(null, (_get, set, id: number) => {
  set(pinnedCouriersAtom, (prev) =>
    prev.map((c) => (c.id === id ? { ...c, status: 'executed' } : c))
  );
});

export const unpinCourierAtom = atom(null, (_get, set, id: number) => {
  set(pinnedCouriersAtom, (prev) => prev.filter((c) => c.id !== id));
});

export const isCourierPinnedAtom = atom((get) => (id: number) => {
  return get(pinnedCouriersAtom).some((c) => c.id === id);
});

/**
 * Calculates total volume of cargo currently in transit (transit arbitrage + secured courier contracts).
 */
export const cargoHoldVolumeAtom = atom<number>((get) => {
  const pinnedHauls = get(pinnedHaulsAtom);
  const pinnedCouriers = get(pinnedCouriersAtom);

  const arbitrageVol = pinnedHauls.reduce((sum, h) => {
    if (h.status === 'transit') {
      const qty = h.boughtQuantity ?? h.quantity;
      return sum + qty * h.unitVolume;
    }
    return sum;
  }, 0);

  const courierVol = pinnedCouriers.reduce((sum, c) => {
    if (c.status === 'secured') {
      return sum + c.volume;
    }
    return sum;
  }, 0);

  return arbitrageVol + courierVol;
});

/**
 * Helper atom to check if an opportunity is pinned.
 */
export const isPinnedAtom = atom((get) => (id: string) => {
  return get(pinnedHaulsAtom).some((h) => h.id === id);
});

/**
 * Add an arbitrage item to pinned list.
 */
export const pinHaulAtom = atom(null, (get, set, item: ArbitrageItem) => {
  const current = get(pinnedHaulsAtom);
  if (current.some((h) => h.id === item.id)) return;
  
  const pinned: PinnedHaul = {
    ...item,
    status: 'planning',
    originalProfit: item.profit,
    originalQuantity: item.quantity,
    originalBuyPrice: item.buyPrice,
  };
  set(pinnedHaulsAtom, [...current, pinned]);
  set(haulingRefreshTriggerAtom, (prev) => prev + 1);
});

/**
 * Remove an arbitrage item from pinned list.
 */
export const unpinHaulAtom = atom(null, (_get, set, id: string) => {
  set(pinnedHaulsAtom, (prev) => prev.filter((h) => h.id !== id));
  set(haulingRefreshTriggerAtom, (prev) => prev + 1);
});

/**
 * Transition a haul to transit state by confirming buy.
 */
export const confirmBuyHaulAtom = atom(null, (_get, set, p: { id: string; qty: number; price: number }) => {
  set(pinnedHaulsAtom, (prev) =>
    prev.map((h) =>
      h.id === p.id
        ? {
            ...h,
            status: 'transit',
            boughtQuantity: p.qty,
            boughtPrice: p.price,
            quantity: p.qty,
            buyPrice: p.price,
            buyCost: p.qty * p.price,
            profit: h.profit * (p.qty / h.quantity), // fallback estimation until next sync
          }
        : h
    )
  );
  set(haulingRefreshTriggerAtom, (prev) => prev + 1);
});

export const executeHaulAtom = atom(null, (_get, set, id: string) => {
  set(pinnedHaulsAtom, (prev) =>
    prev.map((h) => (h.id === id ? { ...h, status: 'executed' } : h))
  );
  set(haulingRefreshTriggerAtom, (prev) => prev + 1);
});

export const redirectHaulAtom = atom(
  null,
  (_get, set, p: { id: string; newDest: ContractEndpoint; newSellPrice: number; newProfit: number }) => {
    set(pinnedHaulsAtom, (prev) =>
      prev.map((h) => {
        if (h.id !== p.id) return h;
        const newId = `${h.typeId}:${h.source.locationId}:${p.newDest.locationId}`;
        return {
          ...h,
          id: newId,
          dest: p.newDest,
          sellPrice: p.newSellPrice,
          profit: p.newProfit,
          originalProfit: p.newProfit,
          buyerGone: undefined,
          supplyGone: undefined,
          shortfall: undefined,
          stale: undefined,
        };
      })
    );
    set(haulingRefreshTriggerAtom, (prev) => prev + 1);
  }
);

/**
 * Update live check results on pinned items.
 */
export interface PinnedHaulStatus {
  id: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  marginPct: number;
  shortfall: boolean;
  buyerGone: boolean;
  supplyGone: boolean;
  stale: boolean;
  ladder: ArbitrageRung[];
  sourceOrderIds: number[];
  destOrderIds: number[];

  // Dynamic route & metrics resolved on back-end
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[] | null;
  jumpsFromCurrent: number | null;
  jumpsToDest: number | null;
  totalJumps: number | null;
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
  
  // Visual comparisons against original baseline
  statusKind: 'up' | 'down' | 'zero' | null;
  statusMessage: string;
  borderColor: string;
}

export const updatePinnedStatusesAtom = atom(null, (_get, set, statuses: PinnedHaulStatus[]) => {
  const map = new Map(statuses.map((s) => [s.id, s]));
  set(pinnedHaulsAtom, (prev) =>
    prev.map((h) => {
      const live = map.get(h.id);
      if (!live) return h;
      
      return {
        ...h,
        // Sync live flags
        shortfall: live.shortfall,
        buyerGone: live.buyerGone,
        supplyGone: live.supplyGone,
        stale: live.stale,
        sourceOrderIds: live.sourceOrderIds,
        destOrderIds: live.destOrderIds,
        
        // Sync economics (calculated correctly by server for both planning and transit)
        quantity: live.quantity,
        buyPrice: live.buyPrice,
        sellPrice: live.sellPrice,
        profit: live.profit,
        marginPct: live.marginPct,
        ladder: live.ladder,
        buyCost: live.quantity * live.buyPrice,
        
        // Sync routes & metrics (recalculated dynamically by server)
        approachRoute: live.approachRoute,
        deliveryRoute: live.deliveryRoute,
        jumpsFromCurrent: live.jumpsFromCurrent,
        jumpsToDest: live.jumpsToDest,
        totalJumps: live.totalJumps,
        profitPerJump: live.profitPerJump,
        danger: live.danger,
        dangerSteps: live.dangerSteps,
        
        // Sync comparisons & visual styles
        statusKind: live.statusKind,
        statusMessage: live.statusMessage,
        borderColor: live.borderColor,
      };
    })
  );
});
