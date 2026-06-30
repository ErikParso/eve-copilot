// Drives the global hauling fetch: runs once on load, refreshes in the
// background on the server's crawl cadence, and re-fetches when anything that
// changes the SERVER-side arbitrage result changes — route type, current system,
// cargo capacity, wallet balance, or sales tax. Attractivity WEIGHTS are NOT a
// re-fetch trigger: the server ranks/truncates by them but the FE re-scores the
// shipped set instantly in haulingRowsAtom, so dragging a weight slider costs no
// round-trip. Mount this exactly once (in the app shell). Results → haulingDataAtom.
import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { characterStatusAtom, characterWalletAtom } from '@/features/auth/atoms';
import { preferencesAtom, DEFAULT_SALES_TAX_PCT } from '@/features/preferences/atoms';
import { deriveJourney, perJump } from './journey';
import { haulingDataAtom, attractivityWeightsAtom, type CourierBase, type ScoredCourier, type ScoredArbitrage, type ScoredPackage } from './atoms';
import type { ContractEndpoint, RouteSystem } from './types';
import type { ScaledArbitrage, MarketMeta } from '@/features/arbitrage/types';
import type { PackageItem, PackageRow } from '@/features/packages/types';
import {
  pinnedHaulsAtom,
  pinnedCouriersAtom,
  pinnedRoutesAtom,
  updatePinnedStatusesAtom,
  haulingRefreshTriggerAtom,
  type PinnedHaulStatus,
} from '@/features/arbitrage/atoms';
import {
  pinnedPackagesAtom,
  updatePinnedPackageStatusesAtom,
  packagesRefreshTriggerAtom,
  type PinnedPackageStatus,
} from '@/features/packages/atoms';

// Background refresh aligns to the server crawl cadence (~10 min); retry sooner
// while the market crawl is still warming up on a cold server.
const REFRESH_MS = 1 * 60 * 1000;
const WARMING_RETRY_MS = 20 * 1000;

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ApiContract {
  id: number;
  pickup: ContractEndpoint;
  dropoff: ContractEndpoint;
  volume: number;
  reward: number;
  collateral: number;
  issuedAt: number;
  expiresAt: number;
  daysToComplete: number;
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[];
  // Danger (index + breakdown) computed and shipped by the server.
  danger: number;
  dangerSteps: string[];
}
type ApiArbitrageItem = Pick<
  ScaledArbitrage,
  | 'id'
  | 'typeId'
  | 'itemName'
  | 'quantity'
  | 'unitVolume'
  | 'totalVolume'
  | 'buyPrice'
  | 'sellPrice'
  | 'marketPrice'
  | 'buyCost'
  | 'profit'
  | 'marginPct'
  | 'ladder'
  | 'salesTax'
  | 'source'
  | 'dest'
  | 'approachRoute'
  // Server ships these already scaled to the requester's cargo/wallet.
  | 'fullQuantity'
  | 'fullTotalVolume'
  | 'limited'
  // Server-computed danger (index + breakdown).
  | 'danger'
  | 'dangerSteps'
> & { deliveryRoute: RouteSystem[] };
type ApiPackageItem = Pick<
  PackageItem,
  | 'id'
  | 'contractId'
  | 'source'
  | 'dest'
  | 'price'
  | 'totalVolume'
  | 'hauledVolume'
  | 'contents'
  | 'sellValue'
  | 'leftMarketValue'
  | 'limited'
  | 'profit'
  | 'marginPct'
  | 'salesTax'
  | 'issuedAt'
  | 'expiresAt'
  | 'approachRoute'
  | 'danger'
  | 'dangerSteps'
> & { deliveryRoute: RouteSystem[] };
type ApiHaulingItem =
  | ({ kind: 'courier'; attractivity: number } & ApiContract)
  | ({ kind: 'arbitrage'; attractivity: number } & ApiArbitrageItem)
  | ({ kind: 'package'; attractivity: number } & ApiPackageItem);
interface HaulingResponse {
  items: ApiHaulingItem[];
  meta: MarketMeta;
  contractsAsOf: number | null;
  total: number;
  // Revalidation of the pinned hauls posted with the request, resolved against
  // the same snapshot as `items`.
  pinnedStatuses: PinnedHaulStatus[];
  // Same-snapshot revalidation of the pinned packages posted with the request.
  pinnedPackageStatuses: PinnedPackageStatus[];
}

/** Add the route-derived fields (jumps, per-jump rate, danger) + listing times. */
function hydrateContract(c: ApiContract): CourierBase {
  const j = deriveJourney(c.approachRoute, c.deliveryRoute);
  const now = Date.now();
  return {
    ...c,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDropoff: j.jumpsToDest,
    totalJumps: j.totalJumps,
    incomePerJump: perJump(c.reward, j.totalJumps),
    activeDurationSeconds: (c.expiresAt - c.issuedAt) / 1000,
    ageSeconds: (now - c.issuedAt) / 1000,
    remainingSeconds: (c.expiresAt - now) / 1000,
    danger: c.danger,
    dangerSteps: c.dangerSteps,
  };
}

function hydrateArbitrage(a: ApiArbitrageItem): ScaledArbitrage {
  const j = deriveJourney(a.approachRoute, a.deliveryRoute);
  return {
    ...a,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDest: j.jumpsToDest,
    totalJumps: j.totalJumps,
    profitPerJump: perJump(a.profit, j.totalJumps),
    danger: a.danger,
    dangerSteps: a.dangerSteps,
  };
}

function hydratePackage(p: ApiPackageItem): PackageRow {
  const j = deriveJourney(p.approachRoute, p.deliveryRoute);
  return {
    ...p,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDest: j.jumpsToDest,
    totalJumps: j.totalJumps,
    profitPerJump: perJump(p.profit, j.totalJumps),
    danger: p.danger,
    dangerSteps: p.dangerSteps,
    // attractivity is attached in the split loop below.
    attractivity: 0,
    attractivitySteps: [],
  };
}

export function useHaulingSearchController(): void {
  const store = useStore();
  const setData = useSetAtom(haulingDataAtom);
  const updatePinnedStatuses = useSetAtom(updatePinnedStatusesAtom);
  const updatePinnedPackageStatuses = useSetAtom(updatePinnedPackageStatusesAtom);
  const refreshTrigger = useAtomValue(haulingRefreshTriggerAtom);
  const packagesRefreshTrigger = useAtomValue(packagesRefreshTriggerAtom);
  
  const setWallet = useSetAtom(characterWalletAtom);
  const setStatus = useSetAtom(characterStatusAtom);
  const setRefreshTrigger = useSetAtom(haulingRefreshTriggerAtom);
  const setPrefs = useSetAtom(preferencesAtom);

  useEffect(() => {
    (window as any).setTestWalletBalance = (balance: number | null) => {
      setWallet(balance === null ? null : { balance, fetchedAt: Date.now() });
    };
    (window as any).setTestLocation = (systemId: number | null, systemName = 'Test System') => {
      setStatus(systemId === null ? null : {
        systemId,
        systemName,
        security: 1.0,
        securityBand: 'high',
        shipTypeName: 'Test Ship',
        shipName: 'Test Ship',
        online: true,
        fetchedAt: Date.now()
      });
    };
    (window as any).setTestSalesTax = (salesTaxPct: number | null) => {
      setPrefs(prev => ({ ...prev, salesTaxPct: salesTaxPct ?? DEFAULT_SALES_TAX_PCT }));
    };
    (window as any).triggerHaulingRefresh = () => {
      setRefreshTrigger(prev => prev + 1);
    };
    return () => {
      delete (window as any).setTestWalletBalance;
      delete (window as any).setTestLocation;
      delete (window as any).setTestSalesTax;
      delete (window as any).triggerHaulingRefresh;
    };
  }, [setWallet, setStatus, setRefreshTrigger, setPrefs]);
  // Re-fetch triggers split into two classes:
  //  • USER actions (route type, cargo, tax, weights) → reload WITH skeletons.
  //  • AUTOMATIC changes (current system, wallet) + the scheduled refresh →
  //    reload SILENTLY (keep showing current cards, no skeletons).
  const prefs = useAtomValue(preferencesAtom);
  const routeType = prefs.routeType;
  const cargoM3 = prefs.cargoM3;
  const salesTaxPct = prefs.salesTaxPct;
  // Stable key so the user-action effect re-fetches (with skeletons) when the
  // opportunity-type filter changes, regardless of array identity/order.
  const contractTypesKey = [...prefs.contractTypes].sort().join(',');
  const origin = useAtomValue(characterStatusAtom)?.systemId ?? null;
  const balance = useAtomValue(characterWalletAtom)?.balance ?? null;
  // Weights ARE a re-fetch trigger now: the server scores/truncates by them, and
  // the FE no longer re-scores the list.
  const weights = useAtomValue(attractivityWeightsAtom);
  const abortRef = useRef<AbortController | null>(null);
  // Skip the very first run of the automatic-trigger effect: the user-action
  // effect already does the initial (skeleton) load on mount.
  const autoMountedRef = useRef(false);

  const run = useCallback(async (isBackground = false): Promise<MarketMeta | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const rt = store.get(preferencesAtom).routeType;
    const org = store.get(characterStatusAtom)?.systemId ?? null;

    // If it's a user action (not a background refresh), we set status to 'loading'
    // so skeletons are shown.
    if (!isBackground) {
      setData((d) => ({ ...d, status: 'loading', error: null }));
    } else {
      setData((d) => (d.status === 'success' ? d : { ...d, status: 'loading', error: null }));
    }

    try {
      // One combined call: the server scores courier + arbitrage together,
      // truncates to the top-N by attractivity, and ships each with its score.
      const prefsNow = store.get(preferencesAtom);
      const wallet = store.get(characterWalletAtom)?.balance;
      const weights = store.get(attractivityWeightsAtom);
      const params = new URLSearchParams({ routeType: rt });
      if (org !== null) params.set('origin', String(org));
      if (prefsNow.cargoM3 != null) params.set('capacity', String(prefsNow.cargoM3));
      if (wallet != null) params.set('balance', String(wallet));
      params.set('taxPct', String(prefsNow.salesTaxPct ?? DEFAULT_SALES_TAX_PCT));
      params.set('wIncome', String(weights.income));
      params.set('wJumps', String(weights.totalJumps));
      params.set('wDanger', String(weights.danger));
      // Opportunity-type filter; empty = no filter (server returns all kinds).
      if (prefsNow.contractTypes.length) params.set('types', prefsNow.contractTypes.join(','));

      // Pinned hauls are revalidated in the SAME request (and thus the same
      // market snapshot) as the opportunities. Only planning/transit hauls carry
      // live status; echo the orders we last saw so the server can flag `stale`.
      const pinnedForCheck = store
        .get(pinnedHaulsAtom)
        .filter((h) => h.status === 'planning' || h.status === 'transit')
        .map((h) => ({
          id: h.id,
          typeId: h.typeId,
          source: h.source.locationId,
          dest: h.dest.locationId,
          quantity: h.status === 'planning' ? h.quantity : (h.boughtQuantity ?? h.quantity),
          status: h.status,
          boughtPrice: h.boughtPrice,
          // Lets the server re-optimize a planning haul to the qty that fits cargo.
          unitVolume: h.unitVolume,
          originalProfit: h.originalProfit,
          originalQuantity: h.originalQuantity,
          originalBuyPrice: h.originalBuyPrice,
          knownSourceOrderIds: h.sourceOrderIds,
          knownDestOrderIds: h.destOrderIds,
        }));

      // Pinned packages revalidated in the SAME request/snapshot. The FE carries
      // the full content + price, so the server needs no cache lookup.
      const pinnedPackagesForCheck = store
        .get(pinnedPackagesAtom)
        .filter((p) => p.status === 'planning' || p.status === 'transit')
        .map((p) => ({
          id: p.id,
          contractId: p.contractId,
          status: p.status,
          price: p.price,
          // Transit carries the frozen loaded subset (per-line soldQuantity); planning
          // omits it so the server re-knapsacks to the current hold.
          lines: p.contents.map((l) => ({
            typeId: l.typeId,
            quantity: l.quantity,
            isBlueprintCopy: l.isBlueprintCopy,
            ...(p.status === 'transit' ? { hauledQuantity: l.soldQuantity } : {}),
          })),
          sourceSystem: p.source.systemId,
          dest: p.dest.locationId,
          destSystem: p.dest.systemId,
          originalProfit: p.originalProfit,
        }));

      const haulRes = await fetch(`${API_BASE}/api/hauling?${params.toString()}`, {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hauls: pinnedForCheck, packages: pinnedPackagesForCheck }),
      });
      if (!haulRes.ok) throw new Error(`Hauling API returned ${haulRes.status}`);
      const haulData = (await haulRes.json()) as HaulingResponse;
      if (signal.aborted) return null;

      // Split the combined, server-scored list back into the two kinds (each
      // carries its attractivity); the FE does NOT re-score the list.
      const courier: ScoredCourier[] = [];
      const arbitrage: ScoredArbitrage[] = [];
      const packages: ScoredPackage[] = [];
      for (const it of haulData.items) {
        if (it.kind === 'courier') courier.push({ ...hydrateContract(it), attractivity: it.attractivity });
        else if (it.kind === 'arbitrage') arbitrage.push({ ...hydrateArbitrage(it), attractivity: it.attractivity });
        else packages.push({ ...hydratePackage(it), attractivity: it.attractivity });
      }

      setData({
        status: 'success',
        courier,
        arbitrage,
        packages,
        error: null,
        contractsAsOf: haulData.contractsAsOf,
        market: haulData.meta,
        total: haulData.total,
      });

      // Fold the same-snapshot pin revalidation into the store. Pins not echoed
      // back (none posted, or already executed) are left untouched.
      if (haulData.pinnedStatuses?.length) {
        updatePinnedStatuses(haulData.pinnedStatuses);
      }
      if (haulData.pinnedPackageStatuses?.length) {
        updatePinnedPackageStatuses(haulData.pinnedPackageStatuses);
      }

      // Fetch dynamic routes for secured pinned courier items (arbitrage routes are resolved on the server)
      const pinnedCouriers = store.get(pinnedCouriersAtom);
      const securedCouriers = pinnedCouriers.filter((c) => c.status === 'secured');

      const queries: { id: string; destSys: number }[] = [];
      securedCouriers.forEach((c) => {
        if (c.dropoff?.systemId) {
          queries.push({ id: `c:${c.id}`, destSys: c.dropoff.systemId });
        }
      });
      // Transit packages need the current-location → dest route too.
      store
        .get(pinnedPackagesAtom)
        .filter((p) => p.status === 'transit')
        .forEach((p) => {
          if (p.dest?.systemId) queries.push({ id: `pp:${p.id}`, destSys: p.dest.systemId });
        });

      if (org !== null && queries.length > 0) {
        const currentCache = store.get(pinnedRoutesAtom);
        const newCache = { ...currentCache };
        let updated = false;

        await Promise.all(
          queries.map(async ({ id, destSys }) => {
            const cacheKey = `${org}-${destSys}-${rt}`;
            if (newCache[cacheKey]) return; // already cached

            try {
              const routeParams = new URLSearchParams({
                origin: String(org),
                dest: String(destSys),
                routeType: rt,
              });
              const res = await fetch(`${API_BASE}/api/route?${routeParams.toString()}`, { signal });
              if (res.ok) {
                const data = (await res.json()) as { route: RouteSystem[] | null; jumps: number | null };
                if (data.route !== undefined) {
                  newCache[cacheKey] = { route: data.route, jumps: data.jumps };
                  updated = true;
                }
              }
            } catch (err) {
              console.error(`Failed to fetch route for ${id}`, err);
            }
          })
        );

        if (updated && !signal.aborted) {
          store.set(pinnedRoutesAtom, newCache);
        }
      }

      return haulData.meta;
    } catch (err) {
      if (signal.aborted) return null;
      const message = err instanceof Error ? err.message : 'Search failed';
      // Keep the last good data on a background failure; only surface the error
      // when we have nothing to show.
      setData((d) =>
        d.status === 'success'
          ? d
          : { status: 'error', courier: [], arbitrage: [], packages: [], error: message, contractsAsOf: null, market: null, total: 0 },
      );
      return null;
    }
  }, [store, setData, updatePinnedStatuses, updatePinnedPackageStatuses]);

  // USER-action triggers + the scheduled background refresh. The initial load
  // and every user change show skeletons (isBg=false); the scheduled re-runs are
  // silent (isBg=true).
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async (isBg = false) => {
      const market = await run(isBg);
      if (cancelled) return;
      const delay = market && market.status !== 'ready' ? WARMING_RETRY_MS : REFRESH_MS;
      timer = window.setTimeout(() => void tick(true), delay);
    };
    void tick(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [run, routeType, cargoM3, salesTaxPct, contractTypesKey, weights.income, weights.totalJumps, weights.danger]);

  // AUTOMATIC triggers: current system / wallet changed (from the pollers).
  // Reload silently so the grid + pinned cards update in place without flashing
  // skeletons. Skip the mount run — the effect above already loaded once.
  useEffect(() => {
    if (!autoMountedRef.current) {
      autoMountedRef.current = true;
      return;
    }
    void run(true);
  }, [run, origin, balance, refreshTrigger, packagesRefreshTrigger]);
}
