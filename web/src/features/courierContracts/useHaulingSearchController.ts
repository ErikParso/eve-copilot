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
import { haulingDataAtom, attractivityWeightsAtom, type CourierBase } from './atoms';
import type { ContractEndpoint, RouteSystem } from './types';
import type { ScaledArbitrage, MarketMeta } from '@/features/arbitrage/types';
import { pinnedHaulsAtom, pinnedCouriersAtom, pinnedRoutesAtom } from '@/features/arbitrage/atoms';

// Background refresh aligns to the server crawl cadence (~10 min); retry sooner
// while the market crawl is still warming up on a cold server.
const REFRESH_MS = 10 * 60 * 1000;
const WARMING_RETRY_MS = 20 * 1000;

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
> & { deliveryRoute: RouteSystem[] };
interface ContractsResponse {
  contracts: ApiContract[];
  lastModifiedAt: number | null;
  total: number;
}
interface ArbitrageResponse {
  items: ApiArbitrageItem[];
  meta: MarketMeta;
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
    danger: j.danger,
    dangerSteps: j.dangerSteps,
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
    danger: j.danger,
    dangerSteps: j.dangerSteps,
  };
}

export function useHaulingSearchController(): void {
  const store = useStore();
  const setData = useSetAtom(haulingDataAtom);
  // Re-fetch triggers: anything that changes the server-side arbitrage result.
  // (Weights are read at fetch time but are NOT a trigger — see haulingRowsAtom.)
  const prefs = useAtomValue(preferencesAtom);
  const routeType = prefs.routeType;
  const cargoM3 = prefs.cargoM3;
  const salesTaxPct = prefs.salesTaxPct;
  const origin = useAtomValue(characterStatusAtom)?.systemId ?? null;
  const balance = useAtomValue(characterWalletAtom)?.balance ?? null;
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<MarketMeta | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const rt = store.get(preferencesAtom).routeType;
    const org = store.get(characterStatusAtom)?.systemId ?? null;

    // Keep showing the current cards during a background refresh; only flip to
    // "loading" on the very first fetch.
    setData((d) => (d.status === 'success' ? d : { ...d, status: 'loading', error: null }));

    try {
      const params = new URLSearchParams({ routeType: rt });
      if (org !== null) params.set('origin', String(org));

      // Arbitrage takes the full server-side pipeline params: capacity, wallet,
      // tax (re-priced server-side) + attractivity weights (for the top-N rank).
      const prefsNow = store.get(preferencesAtom);
      const wallet = store.get(characterWalletAtom)?.balance;
      const weights = store.get(attractivityWeightsAtom);
      const arbParams = new URLSearchParams(params);
      if (prefsNow.cargoM3 != null) arbParams.set('capacity', String(prefsNow.cargoM3));
      if (wallet != null) arbParams.set('balance', String(wallet));
      arbParams.set('taxPct', String(prefsNow.salesTaxPct ?? DEFAULT_SALES_TAX_PCT));
      arbParams.set('wIncome', String(weights.income));
      arbParams.set('wJumps', String(weights.totalJumps));
      arbParams.set('wDanger', String(weights.danger));

      const [contractRes, arbRes] = await Promise.all([
        fetch(`/api/contracts?${params.toString()}`, { signal }),
        fetch(`/api/arbitrage?${arbParams.toString()}`, { signal }),
      ]);
      if (!contractRes.ok) throw new Error(`Contracts API returned ${contractRes.status}`);
      if (!arbRes.ok) throw new Error(`Arbitrage API returned ${arbRes.status}`);
      const contractData = (await contractRes.json()) as ContractsResponse;
      const arbData = (await arbRes.json()) as ArbitrageResponse;
      if (signal.aborted) return null;

      setData({
        status: 'success',
        courier: contractData.contracts.map(hydrateContract),
        arbitrage: arbData.items.map(hydrateArbitrage),
        error: null,
        contractsAsOf: contractData.lastModifiedAt,
        market: arbData.meta,
      });

      // Fetch dynamic routes for in-transit/secured pinned items
      const pinnedHauls = store.get(pinnedHaulsAtom);
      const pinnedCouriers = store.get(pinnedCouriersAtom);
      const transitHauls = pinnedHauls.filter((h) => h.status === 'transit');
      const securedCouriers = pinnedCouriers.filter((c) => c.status === 'secured');

      const queries: { id: string; destSys: number }[] = [];
      transitHauls.forEach((h) => {
        if (h.dest?.systemId) {
          queries.push({ id: `a:${h.id}`, destSys: h.dest.systemId });
        }
      });
      securedCouriers.forEach((c) => {
        if (c.dropoff?.systemId) {
          queries.push({ id: `c:${c.id}`, destSys: c.dropoff.systemId });
        }
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
              const res = await fetch(`/api/route?${routeParams.toString()}`, { signal });
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

      return arbData.meta;
    } catch (err) {
      if (signal.aborted) return null;
      const message = err instanceof Error ? err.message : 'Search failed';
      // Keep the last good data on a background failure; only surface the error
      // when we have nothing to show.
      setData((d) =>
        d.status === 'success'
          ? d
          : { status: 'error', courier: [], arbitrage: [], error: message, contractsAsOf: null, market: null },
      );
      return null;
    }
  }, [store, setData]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      const market = await run();
      if (cancelled) return;
      const delay = market && market.status !== 'ready' ? WARMING_RETRY_MS : REFRESH_MS;
      timer = window.setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [run, routeType, origin, cargoM3, salesTaxPct, balance]);
}
