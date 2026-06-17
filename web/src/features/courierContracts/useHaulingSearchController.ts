// Drives the global hauling fetch: runs once on load, refreshes in the
// background on the server's crawl cadence, and re-fetches when the route type
// or the character's current system changes (both alter server-resolved routes).
// Mount this exactly once (in the app shell). Results land in haulingDataAtom,
// shared by the Hauling and Copilot tabs. Filtering/scoring is derived from the
// preferences in haulingRowsAtom, so preference tweaks don't trigger a re-fetch.
import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import { deriveJourney, perJump } from './journey';
import { haulingDataAtom, type CourierBase } from './atoms';
import type { ContractEndpoint, RouteSystem } from './types';
import type { ArbitrageItem, MarketMeta } from '@/features/arbitrage/types';

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
  ArbitrageItem,
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
  | 'source'
  | 'dest'
  | 'approachRoute'
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

function hydrateArbitrage(a: ApiArbitrageItem): ArbitrageItem {
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
  // Triggers: re-fetch when either of these changes (they alter server routes).
  const routeType = useAtomValue(preferencesAtom).routeType;
  const origin = useAtomValue(characterStatusAtom)?.systemId ?? null;
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

      const [contractRes, arbRes] = await Promise.all([
        fetch(`/api/contracts?${params.toString()}`, { signal }),
        fetch(`/api/arbitrage?${params.toString()}`, { signal }),
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
  }, [run, routeType, origin]);
}
