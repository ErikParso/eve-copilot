// Drives the active run end-to-end. Fetches mode-specific candidates (cheap stock
// to buy / buyers for held cargo), one route matrix covering the plan + candidate
// stops, then derives the ordered plan and the ranked suggestions from it. Buy
// suggestions rank by discount-under-market (the primary signal); sell
// suggestions by net ISK per jump. Mount once on the Copilot page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import type { RouteSystem } from '@/features/courierContracts/types';
import { effectiveStartIskAtom, inventoryAtom, inventoryVolumeAtom, planAtom, runModeAtom } from './atoms';
import { buildRunPlan } from './planner';
import {
  buyCandidateToStop,
  sellCandidateToStop,
  type BuyCandidate,
  type RunPlan,
  type RunStop,
  type SellCandidate,
} from './types';

type RoutesMap = Record<string, RouteSystem[] | null>;
type Status = 'idle' | 'loading' | 'ready' | 'error';

/** A ranked addition the user can drop into the plan, with the data its card shows. */
export interface RunSuggestion {
  stop: RunStop;
  /**
   * ISK this move is worth: a buy's resale upside (best bid − ask) × qty, or a
   * sell's profit (net revenue − cost basis × qty). The basis of the ranking.
   */
  profit: number;
  /** Total jumps of the whole run if this item is added (the ISK/jump denominator); null if it can't be placed. */
  runJumps: number | null;
  /** Extra jumps this item adds to the current run. */
  deltaJumps: number;
  /** `profit` ÷ runJumps (profit itself at 0 jumps); null when it can't be placed. The primary rank. */
  iskPerJump: number | null;
  /** How much the run's danger index rises if this item is added (can be negative). */
  dangerDelta: number;
  /** Sell run: weighted-avg cost basis per unit of the held stack (0 for buys / unknown). */
  unitCostBasis: number;
  buy: BuyCandidate | null;
  sell: SellCandidate | null;
}

export interface RunState {
  mode: 'buy' | 'sell';
  plan: RunPlan | null;
  planStatus: Status;
  suggestions: RunSuggestion[];
  considered: number;
  status: Status;
  error: string | null;
}

// Candidates routed + ranked (server sends a deeper menu; we only need the head).
const MAX_RANKED = 40;

/** Scale a buy candidate down to the units that fit the remaining hold + wallet (null = none fit). */
function scaleBuy(c: BuyCandidate, cargoRoom: number, wallet: number): BuyCandidate | null {
  let qty = c.quantity;
  if (c.unitVolume > 0 && Number.isFinite(cargoRoom)) qty = Math.min(qty, Math.floor(cargoRoom / c.unitVolume));
  if (c.askPrice > 0 && Number.isFinite(wallet)) qty = Math.min(qty, Math.floor(wallet / c.askPrice));
  if (qty <= 0) return null;
  if (qty >= c.quantity) return c;
  return { ...c, quantity: qty, totalVolume: qty * c.unitVolume, buyCost: qty * c.askPrice };
}

export function useRun(): RunState {
  const mode = useAtomValue(runModeAtom);
  const prefs = useAtomValue(preferencesAtom);
  const plan = useAtomValue(planAtom);
  const inventory = useAtomValue(inventoryAtom);
  const heldVolume = useAtomValue(inventoryVolumeAtom);
  const startIskRaw = useAtomValue(effectiveStartIskAtom);
  const status = useAtomValue(characterStatusAtom);

  const origin = status?.systemId ?? null;
  const routeType = prefs.routeType;
  const capacity = prefs.cargoM3 ?? Number.POSITIVE_INFINITY;
  const startIsk = startIskRaw ?? Number.POSITIVE_INFINITY;

  // --- 1. Fetch candidates for the active mode -------------------------------
  const [buyCands, setBuyCands] = useState<BuyCandidate[]>([]);
  const [sellCands, setSellCands] = useState<SellCandidate[]>([]);
  const [candStatus, setCandStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const candAbort = useRef<AbortController | null>(null);

  // Re-fetch sell candidates when the held stock changes; buy menu is global.
  const holdingsSig = useMemo(
    () => inventory.map((h) => `${h.typeId}:${h.qty}`).join('|'),
    [inventory],
  );

  useEffect(() => {
    candAbort.current?.abort();
    const controller = new AbortController();
    candAbort.current = controller;
    const { signal } = controller;
    setCandStatus('loading');

    (async () => {
      try {
        const url = mode === 'buy' ? '/api/copilot/buy-candidates' : '/api/copilot/sell-candidates';
        const body =
          mode === 'buy'
            ? '{}'
            : JSON.stringify({ holdings: inventory.map((h) => ({ typeId: h.typeId, qty: h.qty })) });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        });
        if (!res.ok) throw new Error(`Candidates API returned ${res.status}`);
        const data = (await res.json()) as { candidates: BuyCandidate[] | SellCandidate[] };
        if (signal.aborted) return;
        if (mode === 'buy') {
          setBuyCands(data.candidates as BuyCandidate[]);
          setSellCands([]);
        } else {
          setSellCands(data.candidates as SellCandidate[]);
          setBuyCands([]);
        }
        setError(null);
        setCandStatus('ready');
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load suggestions');
        setCandStatus('error');
      }
    })();

    return () => controller.abort();
    // `inventory` is read inside but keyed by `holdingsSig` (its qty signature).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, holdingsSig]);

  // --- 2. Normalise candidates into stops (scaled to fit, minus those in plan) -
  const inPlan = useMemo(() => new Set(plan.map((s) => s.key)), [plan]);

  const candidateStops = useMemo<Array<{ stop: RunStop; buy: BuyCandidate | null; sell: SellCandidate | null }>>(() => {
    if (mode === 'buy') {
      const room = capacity - heldVolume;
      return buyCands
        .filter((c) => !inPlan.has(c.id) && c.source.systemId !== null)
        .map((c) => scaleBuy(c, room, startIsk))
        .filter((c): c is BuyCandidate => c !== null)
        .slice(0, MAX_RANKED)
        .map((c) => ({ stop: buyCandidateToStop(c), buy: c, sell: null }));
    }
    return sellCands
      .filter((c) => !inPlan.has(c.id) && c.dest.systemId !== null)
      .slice(0, MAX_RANKED)
      .map((c) => ({ stop: sellCandidateToStop(c), buy: null, sell: c }));
  }, [mode, buyCands, sellCands, inPlan, capacity, heldVolume, startIsk]);

  // --- 3. Fetch the route matrix (plan stops + candidate stops, from origin) --
  const [routes, setRoutes] = useState<RoutesMap>({});
  const [routeStatus, setRouteStatus] = useState<Status>('idle');
  const routeAbort = useRef<AbortController | null>(null);

  // Stable signature of the systems we need routes for, so the effect only
  // re-fetches when the geography changes (not on every wallet tick).
  const planSystems = useMemo(
    () => plan.map((s) => s.stop.systemId).filter((x): x is number => x !== null),
    [plan],
  );
  const candSystems = useMemo(
    () => candidateStops.map((c) => c.stop.stop.systemId).filter((x): x is number => x !== null),
    [candidateStops],
  );
  const geoSig = useMemo(
    () => `${routeType}|${origin}|${[...planSystems].sort().join(',')}|${[...candSystems].sort().join(',')}`,
    [routeType, origin, planSystems, candSystems],
  );

  useEffect(() => {
    routeAbort.current?.abort();
    const base = new Set<number>();
    if (origin !== null) base.add(origin);
    for (const s of planSystems) base.add(s);
    const baseIds = [...base];

    const seen = new Set<string>();
    const pairs: Array<[number, number]> = [];
    const addPair = (a: number, b: number) => {
      const k = `${a}:${b}`;
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push([a, b]);
    };
    for (const a of baseIds) for (const b of baseIds) addPair(a, b);
    for (const c of candSystems) for (const b of baseIds) {
      addPair(b, c);
      addPair(c, b);
    }

    if (pairs.length === 0) {
      setRoutes({});
      setRouteStatus('ready');
      return;
    }

    const controller = new AbortController();
    routeAbort.current = controller;
    const { signal } = controller;
    setRouteStatus('loading');
    (async () => {
      try {
        const res = await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeType, pairs }),
          signal,
        });
        if (!res.ok) throw new Error(`Routes API returned ${res.status}`);
        const data = (await res.json()) as { routes: RoutesMap };
        if (signal.aborted) return;
        setRoutes(data.routes);
        setRouteStatus('ready');
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not compute routes');
        setRouteStatus('error');
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoSig]);

  const getLeg = useMemo(() => (from: number, to: number) => routes[`${from}:${to}`] ?? null, [routes]);

  // --- 4. Build the plan and rank the suggestions ----------------------------
  const builtPlan = useMemo<RunPlan | null>(() => {
    if (plan.length === 0) return null;
    if (routeStatus !== 'ready') return null;
    return buildRunPlan(plan, {
      mode,
      origin,
      capacity,
      startIsk,
      startCargo: heldVolume,
      getLeg,
    });
  }, [plan, routeStatus, mode, origin, capacity, startIsk, heldVolume, getLeg]);

  // Cost basis per held type, so a sell's ISK/jump is true profit, not revenue.
  const costBasisByType = useMemo(
    () => new Map(inventory.map((h) => [h.typeId, h.unitCostBasis])),
    [inventory],
  );

  const suggestions = useMemo<RunSuggestion[]>(() => {
    if (candidateStops.length === 0 || routeStatus !== 'ready') return [];
    const baseJumps = builtPlan?.totalJumps ?? 0;
    const baseDanger = builtPlan?.danger ?? 0;

    const out = candidateStops.map(({ stop, buy, sell }) => {
      const unitCostBasis = sell ? costBasisByType.get(stop.typeId) ?? 0 : 0;
      // Buy: resale upside (best bid − ask). Sell: profit over cost basis.
      const profit = buy
        ? (buy.bestResaleNet - buy.askPrice) * stop.quantity
        : sell
          ? sell.netRevenue - unitCostBasis * stop.quantity
          : 0;

      // Re-plan the whole run WITH this item: the denominator is the resulting
      // total jumps, and the danger delta is how much it raises the tour's risk.
      const planWith = buildRunPlan([...plan, stop], {
        mode,
        origin,
        capacity,
        startIsk,
        startCargo: heldVolume,
        getLeg,
      });
      const placed = !planWith.infeasibleKeys.includes(stop.key);
      const runJumps = placed ? planWith.totalJumps : null;
      const iskPerJump = runJumps !== null ? profit / Math.max(1, runJumps) : null;
      return {
        stop,
        profit,
        runJumps,
        deltaJumps: planWith.totalJumps - baseJumps,
        iskPerJump,
        dangerDelta: planWith.danger - baseDanger,
        unitCostBasis,
        buy,
        sell,
      };
    });
    // Primary: ISK per jump over the whole run (unplaceable last); tie-break on profit.
    out.sort((a, b) => {
      const ak = a.iskPerJump ?? Number.NEGATIVE_INFINITY;
      const bk = b.iskPerJump ?? Number.NEGATIVE_INFINITY;
      return bk !== ak ? bk - ak : b.profit - a.profit;
    });
    return out;
  }, [candidateStops, routeStatus, builtPlan, plan, mode, origin, capacity, startIsk, heldVolume, getLeg, costBasisByType]);

  const planStatus: Status =
    plan.length === 0 ? 'idle' : routeStatus === 'error' ? 'error' : builtPlan ? 'ready' : 'loading';
  const overall: Status =
    candStatus === 'error' || routeStatus === 'error'
      ? 'error'
      : candStatus === 'loading' || routeStatus === 'loading'
        ? 'loading'
        : 'ready';

  return {
    mode,
    plan: builtPlan,
    planStatus,
    suggestions,
    considered: candidateStops.length,
    status: overall,
    error,
  };
}
