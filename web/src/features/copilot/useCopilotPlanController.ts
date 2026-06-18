// Drives the plan-aware arbitrage fetch for the Copilot. Sends the basket's
// reservations to /api/arbitrage/plan so the server subtracts their order-book
// depth, then stores what's still available + each reservation's live worth in
// copilotPlanDataAtom. Re-fetches when the reservations change or the market
// snapshot refreshes (so the plan and suggestions stay in sync with the book).
// Mount once on the Copilot page.
import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { haulingDataAtom } from '@/features/courierContracts/atoms';
import type { ArbitrageOpportunity, CommittedEconomics } from '@/features/arbitrage/types';
import { commitmentsAtom, copilotPlanDataAtom } from './atoms';

interface PlanResponse {
  available: ArbitrageOpportunity[];
  committed: CommittedEconomics[];
}

export function useCopilotPlanController(): void {
  const commitments = useAtomValue(commitmentsAtom);
  // Re-fetch when the market snapshot the server is serving changes.
  const builtAt = useAtomValue(haulingDataAtom).market?.builtAt ?? null;
  const setData = useSetAtom(copilotPlanDataAtom);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setData((d) => ({ ...d, status: 'loading', error: null }));
    (async () => {
      try {
        const res = await fetch('/api/arbitrage/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitments }),
          signal,
        });
        if (!res.ok) throw new Error(`Plan API returned ${res.status}`);
        const data = (await res.json()) as PlanResponse;
        if (signal.aborted) return;
        setData({ status: 'ready', available: data.available, committed: data.committed, error: null });
      } catch (err) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Could not resolve the plan';
        setData((d) => ({ ...d, status: 'error', error: message }));
      }
    })();

    return () => controller.abort();
  }, [commitments, builtAt, setData]);
}
