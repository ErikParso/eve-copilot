import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';
import type { PackageItem, PackageLineResult } from './types';

/**
 * A pinned sell-contract (package) tracked through its lifecycle. Mirrors
 * PinnedHaul, minus the buy-side scaling: a package is bought whole at a fixed
 * price, so Confirm-Buy is a single click (no quantity/price dialog).
 */
export interface PinnedPackage extends PackageItem {
  status: 'planning' | 'transit' | 'executed';
  /** Profit captured at pin time — the baseline every revalidation compares to. */
  originalProfit?: number;
  /** Planning only: the contract dropped out of the live public set (bought/expired). */
  contractGone?: boolean;
  /** No buyers at the destination can absorb the bundle any more. */
  buyerGone?: boolean;
  statusKind?: 'up' | 'down' | 'zero' | null;
  statusMessage?: string;
  borderColor?: string;
}

export const pinnedPackagesAtom = atomWithStorage<PinnedPackage[]>('eve-multitool.pinnedPackages.v1', []);
export const packagesRefreshTriggerAtom = atom(0);

export const isPackagePinnedAtom = atom((get) => (id: string) => get(pinnedPackagesAtom).some((p) => p.id === id));

export const pinPackageAtom = atom(null, (get, set, item: PackageItem) => {
  const current = get(pinnedPackagesAtom);
  if (current.some((p) => p.id === item.id)) return;
  const pinned: PinnedPackage = { ...item, status: 'planning', originalProfit: item.profit };
  set(pinnedPackagesAtom, [...current, pinned]);
  set(packagesRefreshTriggerAtom, (n) => n + 1);
});

export const unpinPackageAtom = atom(null, (_get, set, id: string) => {
  set(pinnedPackagesAtom, (prev) => prev.filter((p) => p.id !== id));
  set(packagesRefreshTriggerAtom, (n) => n + 1);
});

/** Confirm the (whole, fixed-price) purchase: planning → transit. No dialog. */
export const confirmBuyPackageAtom = atom(null, (_get, set, id: string) => {
  set(pinnedPackagesAtom, (prev) => prev.map((p) => (p.id === id ? { ...p, status: 'transit' } : p)));
  set(packagesRefreshTriggerAtom, (n) => n + 1);
});

export const executePackageAtom = atom(null, (_get, set, id: string) => {
  set(pinnedPackagesAtom, (prev) => prev.map((p) => (p.id === id ? { ...p, status: 'executed' } : p)));
  set(packagesRefreshTriggerAtom, (n) => n + 1);
});

/** Reroute a transit package to a different destination (sell elsewhere). */
export const redirectPackageAtom = atom(
  null,
  (_get, set, p: { id: string; newDest: ContractEndpoint; newSellValue: number; newProfit: number; newContents: PackageLineResult[] }) => {
    set(pinnedPackagesAtom, (prev) =>
      prev.map((pkg) => {
        if (pkg.id !== p.id) return pkg;
        return {
          ...pkg,
          dest: p.newDest,
          sellValue: p.newSellValue,
          profit: p.newProfit,
          contents: p.newContents,
          originalProfit: p.newProfit,
          buyerGone: undefined,
        };
      }),
    );
    set(packagesRefreshTriggerAtom, (n) => n + 1);
  },
);

/** Live revalidation result for one pinned package (server-computed). */
export interface PinnedPackageStatus {
  id: string;
  sellValue: number;
  profit: number;
  marginPct: number;
  contents: PackageLineResult[];
  contractGone: boolean;
  buyerGone: boolean;
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[];
  jumpsFromCurrent: number | null;
  jumpsToDest: number | null;
  totalJumps: number | null;
  profitPerJump: number | null;
  danger: number;
  dangerSteps: string[];
  statusKind: 'up' | 'down' | 'zero' | null;
  statusMessage: string;
  borderColor: string;
}

export const updatePinnedPackageStatusesAtom = atom(null, (_get, set, statuses: PinnedPackageStatus[]) => {
  const map = new Map(statuses.map((s) => [s.id, s]));
  set(pinnedPackagesAtom, (prev) =>
    prev.map((p) => {
      const live = map.get(p.id);
      if (!live) return p;
      return {
        ...p,
        sellValue: live.sellValue,
        profit: live.profit,
        marginPct: live.marginPct,
        contents: live.contents,
        contractGone: live.contractGone,
        buyerGone: live.buyerGone,
        approachRoute: live.approachRoute,
        deliveryRoute: live.deliveryRoute,
        jumpsFromCurrent: live.jumpsFromCurrent,
        jumpsToDest: live.jumpsToDest,
        totalJumps: live.totalJumps,
        profitPerJump: live.profitPerJump,
        danger: live.danger,
        dangerSteps: live.dangerSteps,
        statusKind: live.statusKind,
        statusMessage: live.statusMessage,
        borderColor: live.borderColor,
      };
    }),
  );
});
