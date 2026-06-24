// The hauling menu: courier contracts + arbitrage hauls scored TOGETHER by
// attractivity in one server-side pass (one min-max normalisation, so a courier
// 90 and an arbitrage 90 are comparable), truncated to the top-N, and shipped
// with the score attached. The FE renders this directly — it does not re-score
// the list. Pinned hauls/couriers are the only thing scored (well, not) on the
// client: they're private localStorage state the server never sees, and they
// carry no attractivity score (shown first regardless).
import { getShipKills } from './kills.js';
import { getMarketMeta, type MarketMeta } from './market.js';
import { dangerForSystems } from './danger.js';
import { scoreAttractivity, type AttractivityWeights } from './arbitrageScore.js';
import { getEnrichedContracts } from './contracts.js';
import { buildArbitrageCandidates, materializeArbitrageItem } from './arbitrage.js';
import type { EnrichedContract, ScaledArbitrageItem, RouteSystem } from './types.js';

export interface HaulingParams {
  routeType: 'safest' | 'shortest';
  origin: number | null;
  capacity: number;
  balance: number;
  taxPct: number;
  weights: AttractivityWeights;
  limit: number;
}

// Every shipped item carries its route danger index + breakdown (computed here);
// the FE renders these directly and computes no danger of its own.
export type HaulingItem =
  | ({ kind: 'courier'; attractivity: number; danger: number; dangerSteps: string[] } & EnrichedContract)
  | ({ kind: 'arbitrage'; attractivity: number; danger: number; dangerSteps: string[] } & ScaledArbitrageItem);

export interface HaulingResponse {
  items: HaulingItem[];
  meta: MarketMeta;
  /** Courier snapshot freshness (epoch ms), for the FE's "as of" display. */
  contractsAsOf: number | null;
  /** Total candidates scored before the top-N truncation (so the FE can say
   *  "top N of total"). */
  total: number;
}

/** jumps + danger (index + steps) over a contract's routes. */
function contractMetrics(
  c: EnrichedContract,
  kills: Map<number, number>,
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
  const kills = await getShipKills();

  const arb = buildArbitrageCandidates(params, kills);

  const contracts = await getEnrichedContracts(params.routeType, params.origin);
  // Courier filtering (collateral ≤ wallet, volume ≤ hold) stays here — it's the
  // courier analogue of arbitrage's cargo/wallet scaling.
  const courier = contracts.contracts.filter((c) => c.collateral <= params.balance && c.volume <= params.capacity);
  const courierMetrics = courier.map((c) => contractMetrics(c, kills));

  // One joint normalisation across both kinds.
  const scorables = [
    ...courier.map((c, i) => ({ income: c.reward, totalJumps: courierMetrics[i].totalJumps, danger: courierMetrics[i].danger })),
    ...arb.map((c) => ({ income: c.opp.profit, totalJumps: c.totalJumps, danger: c.danger })),
  ];
  const scores = scoreAttractivity(scorables, params.weights);

  interface Tagged {
    kind: 'courier' | 'arbitrage';
    attractivity: number;
    idx: number;
  }
  const tagged: Tagged[] = [
    ...courier.map((_, i) => ({ kind: 'courier' as const, attractivity: scores[i], idx: i })),
    ...arb.map((_, j) => ({ kind: 'arbitrage' as const, attractivity: scores[courier.length + j], idx: j })),
  ];
  tagged.sort((a, b) => b.attractivity - a.attractivity);

  const items: HaulingItem[] = tagged.slice(0, params.limit).map((t) =>
    t.kind === 'courier'
      ? {
          kind: 'courier',
          attractivity: t.attractivity,
          danger: courierMetrics[t.idx].danger,
          dangerSteps: courierMetrics[t.idx].dangerSteps,
          ...courier[t.idx],
        }
      : {
          kind: 'arbitrage',
          attractivity: t.attractivity,
          danger: arb[t.idx].danger,
          dangerSteps: arb[t.idx].dangerSteps,
          ...materializeArbitrageItem(arb[t.idx], kills),
        },
  );

  return { items, meta, contractsAsOf: contracts.lastModifiedAt, total: courier.length + arb.length };
}
