import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { ArbitrageItem, ArbitrageRung } from './types';
import type { CourierRow, RouteSystem } from '@/features/courierContracts/types';

export interface PinnedRoute {
  route: RouteSystem[] | null;
  jumps: number | null;
}

export const pinnedRoutesAtom = atom<Record<string, PinnedRoute>>({});

export interface PinnedHaul extends ArbitrageItem {
  // Lifecycle status
  status: 'planning' | 'transit' | 'executed';
  
  // Original values when pinned
  originalProfit?: number;
  originalQuantity?: number;
  
  // User-confirmed buy details (used during transit)
  boughtQuantity?: number;
  boughtPrice?: number;
  
  // Live values returned from endpoint check
  liveQuantity?: number;
  liveBuyPrice?: number;
  liveSellPrice?: number;
  liveProfit?: number;
  liveMarginPct?: number;
  liveLadder?: ArbitrageRung[];
  buyerGone?: boolean;
  shortfall?: boolean;
}

export interface PinnedCourier extends CourierRow {
  status: 'planned' | 'secured' | 'executed';
  unavailable?: boolean;
}

export const pinnedHaulsAtom = atomWithStorage<PinnedHaul[]>('eve-multitool.pinnedHauls.v1', []);
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
  };
  set(pinnedHaulsAtom, [...current, pinned]);
});

/**
 * Remove an arbitrage item from pinned list.
 */
export const unpinHaulAtom = atom(null, (_get, set, id: string) => {
  set(pinnedHaulsAtom, (prev) => prev.filter((h) => h.id !== id));
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
            profit: h.profit * (p.qty / h.quantity), // fallback estimation until next sync
          }
        : h
    )
  );
});

export const executeHaulAtom = atom(null, (_get, set, id: string) => {
  set(pinnedHaulsAtom, (prev) =>
    prev.map((h) => (h.id === id ? { ...h, status: 'executed' } : h))
  );
});

/**
 * Update live check results on pinned items.
 */
export const updatePinnedStatusesAtom = atom(null, (_get, set, statuses: Array<{
  id: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  marginPct: number;
  shortfall: boolean;
  buyerGone: boolean;
  ladder: ArbitrageRung[];
}>) => {
  const map = new Map(statuses.map((s) => [s.id, s]));
  set(pinnedHaulsAtom, (prev) =>
    prev.map((h) => {
      const live = map.get(h.id);
      if (!live) return h;
      if (h.status === 'planning') {
        return {
          ...h,
          quantity: live.quantity,
          buyPrice: live.buyPrice,
          sellPrice: live.sellPrice,
          profit: live.profit,
          marginPct: live.marginPct,
          ladder: live.ladder,
          liveQuantity: live.quantity,
          liveBuyPrice: live.buyPrice,
          liveSellPrice: live.sellPrice,
          liveProfit: live.profit,
          liveMarginPct: live.marginPct,
          liveLadder: live.ladder,
          shortfall: live.shortfall,
          buyerGone: live.buyerGone,
        };
      }
      return {
        ...h,
        liveQuantity: live.quantity,
        liveBuyPrice: live.buyPrice,
        liveSellPrice: live.sellPrice,
        liveProfit: live.profit,
        liveMarginPct: live.marginPct,
        liveLadder: live.ladder,
        shortfall: live.shortfall,
        buyerGone: live.buyerGone,
      };
    })
  );
});
