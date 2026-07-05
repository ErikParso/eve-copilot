// The hauling menu: courier contracts + arbitrage hauls scored TOGETHER by
// attractivity in one server-side pass (one min-max normalisation, so a courier
// 90 and an arbitrage 90 are comparable), truncated to the top-N, and shipped
// with the score attached. The FE renders this directly — it does not re-score
// the list. Pinned hauls/couriers are the only thing scored (well, not) on the
// client: they're private localStorage state the server never sees, and they
// carry no attractivity score (shown first regardless).
import { getGateKills } from './gateKills.js';
import { getMarketMeta, type MarketMeta } from './market.js';
import { dangerForSystems } from './danger.js';
import { scoreAttractivity, type AttractivityWeights } from './arbitrageScore.js';
import { getEnrichedContracts } from './contracts.js';
import { buildArbitrageCandidates, materializeArbitrageItem } from './arbitrage.js';
import { buildPackageCandidates, materializePackageItem } from './packages.js';
import type { EnrichedContract, ScaledArbitrageItem, PackageItem, RouteSystem, GateKillData } from './types.js';

/** The kinds of opportunity the hauling menu can return. */
export type HaulingKind = 'courier' | 'arbitrage' | 'package';

export interface HaulingParams {
  routeType: 'safest' | 'shortest';
  origin: number | null;
  capacity: number;
  balance: number;
  taxPct: number;
  weights: AttractivityWeights;
  /** Opportunity kinds to include; empty = no filter (all kinds). */
  kinds: HaulingKind[];
  /** 1-based page of the attractivity-ranked set to ship. */
  page: number;
  /** Items per page (routes are materialised only for this page's slice). */
  pageSize: number;
}

/** Hard ceiling on how deep the ranked set can be paged (perf + UI sanity). */
export const MAX_PAGEABLE = 1000;

// Every shipped item carries its route danger index + breakdown (computed here);
// the FE renders these directly and computes no danger of its own.
export type HaulingItem =
  | ({ kind: 'courier'; attractivity: number; danger: number; dangerSteps: string[] } & EnrichedContract)
  | ({ kind: 'arbitrage'; attractivity: number; danger: number; dangerSteps: string[] } & ScaledArbitrageItem)
  | ({ kind: 'package'; attractivity: number; danger: number; dangerSteps: string[] } & PackageItem);

export interface HaulingResponse {
  items: HaulingItem[];
  meta: MarketMeta;
  /** Courier snapshot freshness (epoch ms), for the FE's "as of" display. */
  contractsAsOf: number | null;
  /** Total candidates scored before paging (so the FE can size the pager). Capped
   *  for navigation at MAX_PAGEABLE, but reported in full here for the count label. */
  total: number;
  /** 1-based page actually shipped (clamped to the available range). */
  page: number;
  /** Items per page used for this response. */
  pageSize: number;
}

/** jumps + danger (index + steps) over a contract's routes. */
function contractMetrics(
  c: EnrichedContract,
  kills: GateKillData,
): { totalJumps: number; danger: number; dangerSteps: string[] } {
  const ids = (r: RouteSystem[]) => r.map((s) => s.systemId);
  const deliveryIds = ids(c.deliveryRoute);
  const approachIds = c.approachRoute ? ids(c.approachRoute) : null;
  const totalJumps =
    Math.max(0, deliveryIds.length - 1) + (approachIds ? Math.max(0, approachIds.length - 1) : 0);
  const dangerRoute = approachIds ? [...approachIds, ...deliveryIds.slice(1)] : deliveryIds;
  const { index, steps } = dangerForSystems(dangerRoute, kills);
  return { totalJumps, danger: index, dangerSteps: steps };
}

/**
 * Score courier + arbitrage together, sort by attractivity, keep the top-N, and
 * materialise routes only for the shipped arbitrage items.
 */
export async function getEnrichedHauling(params: HaulingParams): Promise<HaulingResponse> {
  const meta = getMarketMeta();
  const kills = await getGateKills();

  // Opportunity-type filter: an empty `kinds` means no filter (build all). When
  // a kind is excluded we skip building it entirely so it costs nothing and is
  // left out of both the scored set and the `total` candidate count.
  const want = (k: HaulingKind) => params.kinds.length === 0 || params.kinds.includes(k);

  const arb = want('arbitrage') ? buildArbitrageCandidates(params, kills) : [];
  const pkg = want('package') ? buildPackageCandidates(params, kills) : [];

  const contracts = await getEnrichedContracts(params.routeType, params.origin);
  // Courier filtering (collateral ≤ wallet, volume ≤ hold) stays here — it's the
  // courier analogue of arbitrage's cargo/wallet scaling.
  const courier = want('courier')
    ? contracts.contracts.filter((c) => c.collateral <= params.balance && c.volume <= params.capacity)
    : [];
  const courierMetrics = courier.map((c) => contractMetrics(c, kills));

  // One joint normalisation across all three kinds (a courier 90, an arbitrage 90
  // and a package 90 are comparable).
  const scorables = [
    ...courier.map((c, i) => ({ income: c.reward, totalJumps: courierMetrics[i].totalJumps, danger: courierMetrics[i].danger })),
    ...arb.map((c) => ({ income: c.opp.profit, totalJumps: c.totalJumps, danger: c.danger })),
    ...pkg.map((c) => ({ income: c.opp.profit, totalJumps: c.totalJumps, danger: c.danger })),
  ];
  const scores = scoreAttractivity(scorables, params.weights);

  interface Tagged {
    kind: 'courier' | 'arbitrage' | 'package';
    attractivity: number;
    idx: number;
  }
  const tagged: Tagged[] = [
    ...courier.map((_, i) => ({ kind: 'courier' as const, attractivity: scores[i], idx: i })),
    ...arb.map((_, j) => ({ kind: 'arbitrage' as const, attractivity: scores[courier.length + j], idx: j })),
    ...pkg.map((_, k) => ({ kind: 'package' as const, attractivity: scores[courier.length + arb.length + k], idx: k })),
  ];
  tagged.sort((a, b) => b.attractivity - a.attractivity);

  // Page window over the ranked set. The whole set is scored/sorted above (cheap:
  // routes + danger are already on every candidate); only THIS page's items get
  // their display route materialised below. Navigation is capped at MAX_PAGEABLE.
  const pageSize = Math.max(1, params.pageSize);
  const pageable = Math.min(tagged.length, MAX_PAGEABLE);
  const lastPage = Math.max(1, Math.ceil(pageable / pageSize));
  const page = Math.min(Math.max(1, params.page), lastPage);
  const start = (page - 1) * pageSize;
  const window = tagged.slice(start, Math.min(start + pageSize, pageable));

  const items: HaulingItem[] = window.map((t) => {
    if (t.kind === 'courier') {
      return {
        kind: 'courier',
        attractivity: t.attractivity,
        danger: courierMetrics[t.idx].danger,
        dangerSteps: courierMetrics[t.idx].dangerSteps,
        ...courier[t.idx],
      };
    }
    if (t.kind === 'arbitrage') {
      return {
        kind: 'arbitrage',
        attractivity: t.attractivity,
        danger: arb[t.idx].danger,
        dangerSteps: arb[t.idx].dangerSteps,
        ...materializeArbitrageItem(arb[t.idx], kills),
      };
    }
    return {
      kind: 'package',
      attractivity: t.attractivity,
      danger: pkg[t.idx].danger,
      dangerSteps: pkg[t.idx].dangerSteps,
      ...materializePackageItem(pkg[t.idx], kills),
    };
  });

  return { items, meta, contractsAsOf: contracts.lastModifiedAt, total: courier.length + arb.length + pkg.length, page, pageSize };
}
