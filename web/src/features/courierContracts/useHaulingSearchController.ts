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
import { haulingDataAtom, attractivityWeightsAtom, type CourierBase, type ScoredCourier, type ScoredArbitrage } from './atoms';
import type { ContractEndpoint, RouteSystem } from './types';
import type { ScaledArbitrage, MarketMeta } from '@/features/arbitrage/types';
import { pinnedHaulsAtom, pinnedCouriersAtom, pinnedRoutesAtom } from '@/features/arbitrage/atoms';

// Background refresh aligns to the server crawl cadence (~10 min); retry sooner
// while the market crawl is still warming up on a cold server.
const REFRESH_MS = 10 * 60 * 1000;
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
type ApiHaulingItem =
  | ({ kind: 'courier'; attractivity: number } & ApiContract)
  | ({ kind: 'arbitrage'; attractivity: number } & ApiArbitrageItem);
interface HaulingResponse {
  items: ApiHaulingItem[];
  meta: MarketMeta;
  contractsAsOf: number | null;
  total: number;
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
  // Weights ARE a re-fetch trigger now: the server scores/truncates by them, and
  // the FE no longer re-scores the list.
  const weights = useAtomValue(attractivityWeightsAtom);
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

      const haulRes = await fetch(`${API_BASE}/api/hauling?${params.toString()}`, { signal });
      if (!haulRes.ok) throw new Error(`Hauling API returned ${haulRes.status}`);
      const haulData = (await haulRes.json()) as HaulingResponse;
      if (signal.aborted) return null;

      // Split the combined, server-scored list back into the two kinds (each
      // carries its attractivity); the FE does NOT re-score the list.
      const courier: ScoredCourier[] = [];
      const arbitrage: ScoredArbitrage[] = [];
      for (const it of haulData.items) {
        if (it.kind === 'courier') courier.push({ ...hydrateContract(it), attractivity: it.attractivity });
        else arbitrage.push({ ...hydrateArbitrage(it), attractivity: it.attractivity });
      }

      setData({
        status: 'success',
        courier,
        arbitrage,
        error: null,
        contractsAsOf: haulData.contractsAsOf,
        market: haulData.meta,
        total: haulData.total,
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
          : { status: 'error', courier: [], arbitrage: [], error: message, contractsAsOf: null, market: null, total: 0 },
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
  }, [run, routeType, origin, cargoM3, salesTaxPct, balance, weights.income, weights.totalJumps, weights.danger]);
}
