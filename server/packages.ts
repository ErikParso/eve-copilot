// Sell contracts (packages): public item_exchange contracts sold whole for a
// fixed price, containing multiple item types. The pipeline mirrors arbitrage —
// route resolution is the only per-request work — with two differences:
//   * the buy side is a FIXED price + FIXED content (a whole contract), not an
//     order-book walk, so there's no cargo/wallet scaling — a package either
//     fits (volume ≤ hold, price ≤ wallet) or it doesn't (binary);
//   * the destination is found by liquidating EVERY item type in the bundle at
//     one drop station (range-aware bid pool), summing the revenue; types with no
//     bids there, or blueprint copies, contribute 0.
//
// The contract *list* rides on the existing courier crawl (same region pages, no
// extra calls). The only new ESI cost is fetching each contract's CONTENTS once
// (/contracts/public/items/{id}/) — immutable, so cached by contract_id and only
// fetched for newly-seen ids, hub regions first. The cache evicts any contract
// that drops out of the live crawl set.
import { esiGetPaged, EsiError } from './esi.js';
import { onContractsRefresh, getRawSellContracts } from './contracts.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { getType, getStation, getSystem, getRegion, securityBand } from './sde.js';
import { dangerForSystems } from './danger.js';
import { getSnapshot, regionPriorityRank, type TypeBook } from './market.js';
import { poolBidsForDrop, DEFAULT_SALES_TAX, MIN_PROFIT, type CandidateParams } from './arbitrage.js';
import { scoreAttractivity, type AttractivityWeights } from './arbitrageScore.js';
import { getMarketPrice } from './prices.js';
import type { ContractEndpoint, PublicContract } from './types.js';
import type {
  PackageLine,
  PackageLineResult,
  PackageRung,
  PackageOpportunity,
  PackageItem,
  PackageStatusLine,
  PinnedPackageStatusRequest,
  PinnedPackageStatusResponse,
  RouteSystem,
} from './types.js';

// Most bid rungs we keep per line for the cargo knapsack — generous enough for
// normal items; pathologically deep ones keep the dearest top.
const MAX_LADDER_RUNGS = 80;

// --- ESI contract-contents shape ---------------------------------------------

interface RawContractItem {
  type_id: number;
  quantity: number;
  /** true = the buyer receives this item; false = the contract asks for it (a
   *  want-to-buy / mixed contract, which we don't handle). */
  is_included: boolean;
  is_blueprint_copy?: boolean;
}

// Cached contents, keyed by contract_id. `PackageLine[]` = a sellable package;
// `'skip'` = anything we won't show (want-to-buy, vanished/404, or empty) so we
// never re-fetch it.
type ContentsEntry = PackageLine[] | 'skip';

// --- Perf guards -------------------------------------------------------------

// Candidate drop stations to evaluate per package. We union the dearest-demand
// stations across the bundle's item types, then bound the total — a major hub
// almost always wins, so a generous slice is plenty.
const MAX_DROP_STATIONS_PER_LINE = 20;
const MAX_CANDIDATE_DROPS = 60;
// Bound the per-line bid pool (dearest stations first) so a deep item like
// Tritanium can't make each candidate's pooling scan thousands of stations —
// mirrors arbitrage's MAX_DESTS_PER_TYPE guard. The dearest demand is at the top.
const MAX_DEST_STATIONS_PER_LINE = 40;
const WORKER_IDLE_SLEEP_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- State -------------------------------------------------------------------

/** Live sell contracts from the latest crawl, keyed by contract_id. */
const meta = new Map<number, PublicContract>();
/** Fetched contents cache (memory-only for now; disk persistence is a later-todo). */
const contents = new Map<number, ContentsEntry>();
/** Contract ids awaiting a contents fetch, hub-priority first. */
let pendingQueue: number[] = [];
const pendingSet = new Set<number>();
/** Bumped whenever the cache changes, so opportunities recompute. */
let contentsVersion = 0;
/** When the contract set was last reconciled against a crawl (epoch ms), or null. */
let lastReconcileAt: number | null = null;

function regionRankOf(c: PublicContract): number {
  const systemId = getStation(c.start_location_id)?.systemId ?? null;
  return regionPriorityRank(systemId === null ? null : getRegion(systemId));
}

/**
 * Reconcile the cache against the latest crawl: enqueue newly-seen contracts
 * (hub regions first) and EVICT any whose contract_id is gone from the live set
 * (bought/expired) so a stale package can never surface.
 */
function reconcile(): void {
  const sells = getRawSellContracts();
  if (sells.length === 0) return; // crawl not ready yet — keep what we have

  const live = new Set<number>();
  meta.clear();
  for (const c of sells) {
    live.add(c.contract_id);
    meta.set(c.contract_id, c);
  }

  // Evict vanished contracts from the contents cache + queue.
  let evicted = 0;
  for (const id of [...contents.keys()]) {
    if (!live.has(id)) {
      contents.delete(id);
      evicted++;
    }
  }
  if (pendingSet.size) {
    pendingQueue = pendingQueue.filter((id) => live.has(id));
    for (const id of [...pendingSet]) if (!live.has(id)) pendingSet.delete(id);
  }

  // Enqueue contracts we haven't fetched contents for yet.
  const toQueue: number[] = [];
  for (const c of sells) {
    if (!contents.has(c.contract_id) && !pendingSet.has(c.contract_id)) {
      toQueue.push(c.contract_id);
      pendingSet.add(c.contract_id);
    }
  }
  // Hub regions first, so the most valuable contents warm up earliest.
  toQueue.sort((a, b) => regionRankOf(meta.get(a)!) - regionRankOf(meta.get(b)!));
  pendingQueue.push(...toQueue);

  contentsVersion++;
  lastReconcileAt = Date.now();
  console.log(
    `[Packages] Reconciled: ${meta.size} live sell contracts, ${contents.size} cached, ` +
      `${pendingQueue.length} queued (+${toQueue.length} new, −${evicted} evicted).`,
  );
}

// --- Contents fetch worker ---------------------------------------------------

/** Fetch + classify one contract's contents. Returns the sellable lines, or
 *  'skip' for want-to-buy / mixed contracts. Throws on transient ESI errors. */
export async function fetchContents(id: number): Promise<ContentsEntry> {
  const first = await esiGetPaged<RawContractItem[]>(`/contracts/public/items/${id}/`, 1);
  const items: RawContractItem[] = [...first.data];
  for (let page = 2; page <= first.pages; page++) {
    const res = await esiGetPaged<RawContractItem[]>(`/contracts/public/items/${id}/`, page);
    items.push(...res.data);
  }
  if (items.length === 0) return 'skip';
  // A pure sell: the buyer receives every line. Any not-included line means the
  // contract asks for items (want-to-buy / mixed) — out of scope.
  if (items.some((it) => it.is_included === false)) return 'skip';

  const lines: PackageLine[] = items.map((it) => ({
    typeId: it.type_id,
    itemName: getType(it.type_id)?.name ?? `Type ${it.type_id}`,
    quantity: it.quantity,
    isBlueprintCopy: it.is_blueprint_copy === true,
  }));
  return lines;
}

let workerStarted = false;
async function runContentsWorker(): Promise<void> {
  for (;;) {
    const id = pendingQueue.shift();
    if (id === undefined) {
      await sleep(WORKER_IDLE_SLEEP_MS);
      continue;
    }
    pendingSet.delete(id);
    if (!meta.has(id)) continue; // evicted while queued

    try {
      const entry = await fetchContents(id);
      if (!meta.has(id)) continue; // evicted during the fetch
      contents.set(id, entry);
      contentsVersion++;
    } catch (err) {
      if (err instanceof EsiError && err.status === 404) {
        // Contract already gone — mark skip so we don't retry; eviction cleans up.
        contents.set(id, 'skip');
      } else {
        // Transient — requeue at the tail for a later retry.
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Packages] contents fetch failed for ${id} (requeued): ${reason}`);
        pendingSet.add(id);
        pendingQueue.push(id);
        await sleep(WORKER_IDLE_SLEEP_MS);
      }
    }
  }
}

/** Start the packages service: reconcile on every contracts crawl + drain the
 *  contents queue in the background. Idempotent. */
export function startPackagesService(): void {
  if (workerStarted) return;
  workerStarted = true;
  onContractsRefresh(reconcile);
  reconcile(); // in case the first crawl already finished
  void runContentsWorker();
}

// --- Route-free resolution (cached by snapshot + contents version) -----------

/** Distinct candidate drop stations across the bundle's item books. */
function collectCandidateDrops(books: (TypeBook | undefined)[]): { station: number; system: number }[] {
  const seen = new Map<number, { station: number; system: number }>();
  for (const book of books) {
    if (!book) continue;
    const n = Math.min(book.buys.length, MAX_DROP_STATIONS_PER_LINE);
    for (let i = 0; i < n; i++) {
      const s = book.buys[i];
      if (!seen.has(s.station)) seen.set(s.station, { station: s.station, system: s.system });
    }
  }
  return [...seen.values()].slice(0, MAX_CANDIDATE_DROPS);
}

/** A line as needed for liquidation — the full PackageLine or the slim status line. */
type LiquidationLine = { typeId: number; quantity: number; isBlueprintCopy: boolean };
interface Drop {
  station: number;
  system: number;
}

/** Liquidate one line against the bids reachable from a drop station, up to the
 *  line quantity (no profitability break — the bundle is owned whole). Records the
 *  consumed bid ladder so the per-request cargo knapsack can re-fill by ISK/m³. */
function liquidateLine(line: LiquidationLine, book: TypeBook | undefined, drop: Drop): { soldQuantity: number; sellValue: number; rungs: PackageRung[] } {
  if (!book || line.isBlueprintCopy) return { soldQuantity: 0, sellValue: 0, rungs: [] };
  const dests = book.buys.length > MAX_DEST_STATIONS_PER_LINE ? book.buys.slice(0, MAX_DEST_STATIONS_PER_LINE) : book.buys;
  const bids = poolBidsForDrop(dests, { station: drop.station, system: drop.system, best: -Infinity, orders: [] });
  let sold = 0;
  let value = 0;
  const rungs: PackageRung[] = [];
  for (const bid of bids) {
    if (sold >= line.quantity) break;
    const take = Math.min(bid.volume, line.quantity - sold);
    if (take <= 0) continue;
    sold += take;
    value += take * bid.price;
    if (rungs.length < MAX_LADDER_RUNGS) rungs.push({ units: take, sell: bid.price });
  }
  return { soldQuantity: sold, sellValue: value, rungs };
}

/**
 * Price the whole bundle at one drop station as the capacity-UNBOUNDED fit:
 * everything sellable is "hauled", units with no dest bid are "left" (valued at
 * nominal market price). Each line carries its bid ladder for the later knapsack.
 */
function priceLinesAtDrop(lines: LiquidationLine[], drop: Drop, byType: Map<number, TypeBook>): { results: PackageLineResult[]; sellValue: number } {
  let total = 0;
  const results: PackageLineResult[] = [];
  for (const line of lines) {
    const { soldQuantity, sellValue, rungs } = liquidateLine(line, byType.get(line.typeId), drop);
    const type = getType(line.typeId);
    const unitVolume = type?.volume ?? 0;
    const marketPrice = getMarketPrice(line.typeId);
    const leftQuantity = Math.max(0, line.quantity - soldQuantity);
    results.push({
      typeId: line.typeId,
      itemName: type?.name ?? `Type ${line.typeId}`,
      quantity: line.quantity,
      isBlueprintCopy: line.isBlueprintCopy,
      unitVolume,
      marketPrice,
      soldQuantity,
      sellValue,
      leftQuantity,
      leftMarketValue: leftQuantity * (marketPrice ?? 0),
      rungs,
    });
    total += sellValue;
  }
  return { results, sellValue: total };
}

/** Pick the drop station that liquidates the FULL bundle for the most gross value. */
function bestDropForLines(lines: LiquidationLine[], byType: Map<number, TypeBook>): { drop: Drop; results: PackageLineResult[]; sellValue: number } | null {
  const candidates = collectCandidateDrops(lines.map((l) => byType.get(l.typeId)));
  if (candidates.length === 0) return null;
  let best: { drop: Drop; results: PackageLineResult[]; sellValue: number } | null = null;
  for (const drop of candidates) {
    const { results, sellValue } = priceLinesAtDrop(lines, drop, byType);
    if (!best || sellValue > best.sellValue) best = { drop, results, sellValue };
  }
  return best;
}

/**
 * Fit a priced bundle to a cargo hold. You pay the full price regardless; you
 * carry the subset that maximises destination revenue within `capacity` and
 * abandon the rest in station (valued at nominal market price). A type can
 * straddle the cargo line (part hauled, part left). Strips the rungs from the
 * result.
 *
 * Greedy-by-ISK/m³ alone is wrong here: it's only optimal for divisible goods,
 * so a single big-volume / low-ISK-per-m³ but high-TOTAL-value unit (a ship) gets
 * crowded out by small high-density modules even when carrying it (and dropping a
 * cheap module instead) is far better. So we ENUMERATE the bulky units (those few
 * enough to fit that integrality matters) and greedily fill the divisible
 * remainder for each combination — exact for the common "one ship + modules" case,
 * with a combination cap that falls back to pure greedy for pathological bundles.
 */
interface ScaledBundle {
  contents: PackageLineResult[];
  realizedValue: number;
  hauledVolume: number;
  leftMarketValue: number;
  limited: boolean;
}
// A line is "bulky" (enumerated) when fewer than this many of its units fit — i.e.
// unitVolume × this > capacity; greedy's integrality gap only bites such items.
const BULKY_FIT_THRESHOLD = 10;
// Cap on enumerated bulky combinations before falling back to pure greedy.
const MAX_BULKY_COMBOS = 20_000;

function scaleBundleToCargo(lines: PackageLineResult[], capacity: number): ScaledBundle {
  const n = lines.length;
  const sellableUnits = lines.map((l) => (l.rungs ?? []).reduce((s, r) => s + r.units, 0));
  // Gross revenue of the top-k (dearest) units of a line.
  const valueOfTopK = (li: number, k: number): number => {
    let rem = k;
    let v = 0;
    for (const r of lines[li].rungs ?? []) {
      if (rem <= 0) break;
      const t = Math.min(r.units, rem);
      v += t * r.sell;
      rem -= t;
    }
    return v;
  };

  // hauled[li] = units of line li carried in the best fit found.
  let hauled = new Array<number>(n).fill(0);

  if (capacity === Infinity) {
    hauled = sellableUnits.slice(); // everything sellable fits
  } else {
    const fitOf = (li: number): number => {
      const uv = lines[li].unitVolume;
      return Math.min(sellableUnits[li], uv > 0 ? Math.floor(capacity / uv) : sellableUnits[li]);
    };
    let bulky: number[] = [];
    const fine: number[] = [];
    for (let li = 0; li < n; li++) {
      if (lines[li].unitVolume > 0 && lines[li].unitVolume * BULKY_FIT_THRESHOLD > capacity && sellableUnits[li] > 0) bulky.push(li);
      else fine.push(li);
    }
    // Bound the enumeration; fall back to pure greedy (all-fine) if too large.
    let combos = 1;
    for (const li of bulky) combos *= fitOf(li) + 1;
    if (combos > MAX_BULKY_COMBOS) {
      bulky = [];
      fine.length = 0;
      for (let li = 0; li < n; li++) fine.push(li);
    }

    // Pre-sort the divisible (fine) rungs by ISK/m³ once; greedy fill is optimal for them.
    interface FR {
      li: number;
      units: number;
      sell: number;
      uv: number;
    }
    const fineRungs: FR[] = [];
    for (const li of fine) for (const r of lines[li].rungs ?? []) fineRungs.push({ li, units: r.units, sell: r.sell, uv: lines[li].unitVolume });
    fineRungs.sort((a, b) => b.sell / (b.uv || Number.EPSILON) - a.sell / (a.uv || Number.EPSILON));
    const fineFill = (cap: number): { counts: number[]; value: number } => {
      const counts = new Array<number>(n).fill(0);
      let value = 0;
      let c = cap;
      for (const r of fineRungs) {
        let take = r.units;
        if (r.uv > 0) {
          const fit = Math.floor(c / r.uv);
          if (fit <= 0) continue;
          take = Math.min(take, fit);
        }
        if (take <= 0) continue;
        counts[r.li] += take;
        value += take * r.sell;
        if (r.uv > 0) c -= take * r.uv;
      }
      return { counts, value };
    };

    // Enumerate how many units to take of each bulky line; greedily fill the rest.
    const bulkyFit = bulky.map(fitOf);
    let bestValue = -Infinity;
    const picks = new Array<number>(n).fill(0);
    const choose = (idx: number, volUsed: number, valAcc: number): void => {
      if (idx === bulky.length) {
        const fr = fineFill(capacity - volUsed);
        const total = valAcc + fr.value;
        if (total > bestValue) {
          bestValue = total;
          const h = fr.counts;
          for (const li of bulky) h[li] = picks[li];
          hauled = h;
        }
        return;
      }
      const li = bulky[idx];
      const uv = lines[li].unitVolume;
      for (let k = 0; k <= bulkyFit[idx]; k++) {
        const vol = volUsed + k * uv;
        if (vol > capacity) break;
        picks[li] = k;
        choose(idx + 1, vol, valAcc + valueOfTopK(li, k));
      }
      picks[li] = 0;
    };
    choose(0, 0, 0);
  }

  let realizedValue = 0;
  let hauledVolume = 0;
  let leftMarketValue = 0;
  let limited = false;
  const contents: PackageLineResult[] = lines.map((l, li) => {
    const soldQuantity = hauled[li];
    const sellValue = valueOfTopK(li, soldQuantity);
    const leftQuantity = Math.max(0, l.quantity - soldQuantity);
    const leftMV = leftQuantity * (l.marketPrice ?? 0);
    realizedValue += sellValue;
    hauledVolume += soldQuantity * l.unitVolume;
    leftMarketValue += leftMV;
    if (leftQuantity > 0) limited = true;
    // Shipped line: drop the rungs.
    return {
      typeId: l.typeId,
      itemName: l.itemName,
      quantity: l.quantity,
      isBlueprintCopy: l.isBlueprintCopy,
      unitVolume: l.unitVolume,
      marketPrice: l.marketPrice,
      soldQuantity,
      sellValue,
      leftQuantity,
      leftMarketValue: leftMV,
    };
  });
  return { contents, realizedValue, hauledVolume, leftMarketValue, limited };
}

/** Resolve one sell contract into the route-free cached opportunity: best dest +
 *  per-line bid ladders. Economics are the capacity-unbounded fit; the discovery
 *  prune uses the full-bundle profit (an upper bound on any realized profit). */
function resolveOpportunity(c: PublicContract, lines: PackageLine[]): PackageOpportunity | null {
  const source = resolveEndpoint(c.start_location_id);
  if (source.systemId === null) return null; // can't route from an unplaceable structure

  const snap = getSnapshot();
  if (!snap) return null;
  const tax = DEFAULT_SALES_TAX;

  const best = bestDropForLines(lines, snap.byType);
  if (!best || best.sellValue <= 0) return null;

  // Discovery floor on the FULL-bundle (capacity-unbounded) profit — an upper
  // bound on any realized profit, so anything that can't clear MIN_PROFIT even
  // fully sold is dropped before the per-request knapsack. The per-request step
  // re-applies the floor to the realized (fitting) profit.
  const fullProfit = best.sellValue * (1 - tax) - c.price;
  if (fullProfit < MIN_PROFIT) return null;

  const hauledVolume = best.results.reduce((s, l) => s + l.soldQuantity * l.unitVolume, 0);
  const leftMarketValue = best.results.reduce((s, l) => s + l.leftMarketValue, 0);
  const limited = best.results.some((l) => l.leftQuantity > 0);

  return {
    id: String(c.contract_id),
    contractId: c.contract_id,
    source,
    dest: resolveEndpoint(best.drop.station, best.drop.system),
    price: c.price,
    totalVolume: c.volume,
    hauledVolume,
    contents: best.results,
    sellValue: best.sellValue,
    fullSellValue: best.sellValue,
    leftMarketValue,
    limited,
    profit: fullProfit,
    marginPct: c.price > 0 ? (fullProfit / c.price) * 100 : 0,
    salesTax: tax,
    issuedAt: Date.parse(c.date_issued),
    expiresAt: Date.parse(c.date_expired),
  };
}

let oppsSnapshotAt = -1;
let oppsContentsVersion = -1;
let opportunities: PackageOpportunity[] = [];

/** Cached route-free package opportunities, rebuilt only when the market
 *  snapshot or the contents cache changes. */
function getPackageOpportunities(): PackageOpportunity[] {
  const snap = getSnapshot();
  if (!snap) return [];
  if (snap.builtAt === oppsSnapshotAt && contentsVersion === oppsContentsVersion) return opportunities;

  const out: PackageOpportunity[] = [];
  for (const [id, lines] of contents) {
    if (lines === 'skip') continue;
    const c = meta.get(id);
    if (!c) continue;
    const opp = resolveOpportunity(c, lines);
    if (opp) out.push(opp);
  }
  out.sort((a, b) => b.profit - a.profit);
  opportunities = out;
  oppsSnapshotAt = snap.builtAt;
  oppsContentsVersion = contentsVersion;
  return opportunities;
}

/** Processing stats for the Market Data tab's sell-contract panel. */
export interface PackagesFreshness {
  /** Worker started (live crawl) vs not (OFFLINE / pre-start). */
  workerRunning: boolean;
  /** Live sell contracts in the latest crawl set. */
  liveContracts: number;
  /** Contracts whose contents have been fetched (cached). */
  cached: number;
  /** Cached contracts that are sellable bundles (the rest are want-to-buy / skipped). */
  sellable: number;
  /** Cached contracts classified as not-a-sell (want-to-buy, empty, 404). */
  skipped: number;
  /** Contracts still queued for a contents fetch. */
  pending: number;
  /** Profitable bundles in the last computed opportunity set. */
  opportunities: number;
  /** When the contract set was last reconciled against a crawl (epoch ms). */
  lastReconcileAt: number | null;
}

export function getPackagesFreshness(): PackagesFreshness {
  let sellable = 0;
  let skipped = 0;
  for (const entry of contents.values()) {
    if (entry === 'skip') skipped++;
    else sellable++;
  }
  return {
    workerRunning: workerStarted,
    liveContracts: meta.size,
    cached: contents.size,
    sellable,
    skipped,
    pending: pendingQueue.length,
    opportunities: opportunities.length,
    lastReconcileAt,
  };
}

// --- Per-request candidates (filter + route + jumps/danger) ------------------

/** A package opportunity that fits the requester and is routable, with jumps +
 *  danger as numbers and the route ids (RouteSystem[] materialised only for the
 *  shipped top-N). */
export interface PackageCandidate {
  opp: PackageOpportunity;
  deliveryIds: number[];
  approachIds: number[] | null;
  totalJumps: number;
  danger: number;
  dangerSteps: string[];
}

/**
 * Every package that fits the hold/wallet and is reachable, re-priced to the
 * user's tax and routed (jumps + danger from cached paths). No RouteSystem[]
 * built here — that's only for the shipped top-N (see materializePackageItem).
 */
export function buildPackageCandidates(params: CandidateParams, kills: Map<number, number>): PackageCandidate[] {
  if (!getSnapshot()) return [];
  const tax = params.taxPct / 100;
  const out: PackageCandidate[] = [];
  for (const raw of getPackageOpportunities()) {
    // You can buy a bundle even if it's bigger than your hold — cargo no longer
    // hides it. It only gates on whether you can AFFORD the fixed price.
    if (raw.price > params.balance) continue;
    const srcSys = raw.source.systemId;
    const dstSys = raw.dest.systemId;
    if (srcSys === null || dstSys === null) continue;

    // Fit the bundle to the hold (carry the highest ISK/m³ items, abandon the rest)
    // and re-price the realized profit to the requester's tax.
    const fit = scaleBundleToCargo(raw.contents, params.capacity);
    const profit = fit.realizedValue * (1 - tax) - raw.price;
    // Realized-profit floor (stricter than the discovery prune): a bundle drops
    // out if nothing valuable enough fits your hold.
    if (profit < MIN_PROFIT) continue;

    const deliveryIds = getRoute(srcSys, dstSys, params.routeType);
    if (!deliveryIds) continue; // can't haul source → dest
    let approachIds: number[] | null = null;
    if (params.origin !== null) {
      approachIds = getRoute(params.origin, srcSys, params.routeType);
      if (!approachIds) continue; // can't reach the package from here
    }

    const opp: PackageOpportunity = {
      ...raw,
      contents: fit.contents,
      sellValue: fit.realizedValue,
      hauledVolume: fit.hauledVolume,
      leftMarketValue: fit.leftMarketValue,
      limited: fit.limited,
      profit,
      marginPct: raw.price > 0 ? (profit / raw.price) * 100 : 0,
      salesTax: tax,
    };

    const totalJumps =
      Math.max(0, deliveryIds.length - 1) + (approachIds ? Math.max(0, approachIds.length - 1) : 0);
    const dangerRoute = approachIds ? [...approachIds, ...deliveryIds.slice(1)] : deliveryIds;
    const { index: danger, steps: dangerSteps } = dangerForSystems(dangerRoute, kills);

    out.push({ opp, deliveryIds, approachIds, totalJumps, danger, dangerSteps });
  }
  return out;
}

/** Materialise a candidate's full RouteSystem[] legs into a shippable item. */
export function materializePackageItem(c: PackageCandidate, kills: Map<number, number>): PackageItem {
  const approachRoute: RouteSystem[] | null = c.approachIds ? toRouteSystems(c.approachIds, kills) : null;
  return {
    ...c.opp,
    approachRoute,
    deliveryRoute: toRouteSystems(c.deliveryIds, kills),
  };
}

// --- Pinned-package revalidation ---------------------------------------------

function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const negative = value < 0;
  const abs = Math.abs(value);
  const factor = 10 ** maxFractionDigits;
  const [intPart, fracPart] = (Math.round(abs * factor) / factor).toFixed(maxFractionDigits).split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedFrac = fracPart ? fracPart.replace(/0+$/, '') : '';
  const body = trimmedFrac ? `${groupedInt}.${trimmedFrac}` : groupedInt;
  return negative ? `-${body}` : body;
}
const formatIskMillions = (value: number): string => `${formatNumber(value / 1_000_000, 2)} M ISK`;

/**
 * Recheck pinned packages against the live book. The FE carries the full content
 * + price, so each is re-priced purely from the request (no cache dependency — a
 * bought/expired contract is evicted from the cache, but a transit package is
 * still in your hold). The dest is FIXED here (re-pricing where you're headed);
 * choosing a new dest is "sell elsewhere". Planning routes source→dest (+approach
 * from origin); transit routes origin→dest (cargo is aboard).
 */
export function resolvePinnedPackagesStatus(
  reqs: PinnedPackageStatusRequest[],
  opts: { taxFraction?: number; capacity?: number; origin: number | null; routeType: 'safest' | 'shortest'; kills: Map<number, number> },
): PinnedPackageStatusResponse[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const tax = opts.taxFraction ?? DEFAULT_SALES_TAX;
  const capacity = opts.capacity ?? Infinity;
  const liveIds = new Set(meta.keys());
  const out: PinnedPackageStatusResponse[] = [];

  for (const r of reqs) {
    const drop: Drop = { station: r.dest, system: r.destSystem ?? -1 };
    // Planning re-knapsacks to the current hold (the load you'd take); transit
    // re-prices the loaded subset (each line's `hauledQuantity`), leaving the rest
    // at market value (the choice is frozen — the cargo is already aboard).
    let results: PackageLineResult[] = [];
    let sellValue = 0;
    let hauledVolume = 0;
    let leftMarketValue = 0;
    let limited = false;
    if (r.destSystem !== null) {
      if (r.status === 'planning') {
        const priced = priceLinesAtDrop(r.lines, drop, snap.byType);
        const fit = scaleBundleToCargo(priced.results, capacity);
        results = fit.contents;
        sellValue = fit.realizedValue;
        hauledVolume = fit.hauledVolume;
        leftMarketValue = fit.leftMarketValue;
        limited = fit.limited;
      } else {
        for (const line of r.lines) {
          const hauled = line.hauledQuantity ?? line.quantity;
          const { soldQuantity, sellValue: v } = liquidateLine(
            { typeId: line.typeId, quantity: hauled, isBlueprintCopy: line.isBlueprintCopy },
            snap.byType.get(line.typeId),
            drop,
          );
          const type = getType(line.typeId);
          const uv = type?.volume ?? 0;
          const mp = getMarketPrice(line.typeId);
          const leftQ = Math.max(0, line.quantity - hauled);
          results.push({
            typeId: line.typeId,
            itemName: type?.name ?? `Type ${line.typeId}`,
            quantity: line.quantity,
            isBlueprintCopy: line.isBlueprintCopy,
            unitVolume: uv,
            marketPrice: mp,
            soldQuantity,
            sellValue: v,
            leftQuantity: leftQ,
            leftMarketValue: leftQ * (mp ?? 0),
          });
          sellValue += v;
          hauledVolume += soldQuantity * uv;
          leftMarketValue += leftQ * (mp ?? 0);
          if (leftQ > 0) limited = true;
        }
      }
    }
    const soldUnits = results.reduce((s, l) => s + l.soldQuantity, 0);
    const profit = sellValue * (1 - tax) - r.price;
    const marginPct = r.price > 0 ? (profit / r.price) * 100 : 0;

    const contractGone = r.status === 'planning' && !liveIds.has(r.contractId);
    const buyerGone = soldUnits === 0;

    // Routes + metrics.
    let approachRoute: RouteSystem[] | null = null;
    let deliveryRoute: RouteSystem[] = [];
    let jumpsFromCurrent: number | null = null;
    let jumpsToDest: number | null = null;
    let totalJumps: number | null = null;
    let profitPerJump: number | null = null;
    let danger = 0;
    let dangerSteps: string[] = [];

    if (r.destSystem !== null) {
      let approachIds: number[] | null = null;
      let deliveryIds: number[] | null = null;
      if (r.status === 'planning') {
        if (r.sourceSystem !== null) deliveryIds = getRoute(r.sourceSystem, r.destSystem, opts.routeType);
        if (opts.origin !== null && r.sourceSystem !== null) approachIds = getRoute(opts.origin, r.sourceSystem, opts.routeType);
      } else {
        // transit: cargo aboard — route from the current location to the dest.
        const from = opts.origin ?? r.sourceSystem;
        if (from !== null) deliveryIds = getRoute(from, r.destSystem, opts.routeType);
      }
      if (deliveryIds) {
        deliveryRoute = toRouteSystems(deliveryIds, opts.kills);
        jumpsToDest = Math.max(0, deliveryIds.length - 1);
      }
      if (approachIds) {
        approachRoute = toRouteSystems(approachIds, opts.kills);
        jumpsFromCurrent = Math.max(0, approachIds.length - 1);
      }
      totalJumps = (jumpsFromCurrent ?? 0) + (jumpsToDest ?? 0);
      profitPerJump = totalJumps > 0 ? profit / totalJumps : null;
      const dangerRoute = approachIds ? [...approachIds, ...(deliveryIds ? deliveryIds.slice(1) : [])] : (deliveryIds ?? []);
      const d = dangerForSystems(dangerRoute, opts.kills);
      danger = d.index;
      dangerSteps = d.steps;
    }

    // Visual comparison vs the baseline captured at pin time.
    const baseline = r.originalProfit !== undefined ? r.originalProfit : profit;
    let statusKind: 'up' | 'down' | 'zero' | null = null;
    let borderColor = 'primary.main';
    let statusMessage = '';
    if (contractGone) {
      statusKind = 'zero';
      borderColor = 'error.main';
      statusMessage = `This contract is no longer listed (bought or expired). ${formatIskMillions(baseline)} → ${formatIskMillions(profit)}.`;
    } else if (profit <= 0) {
      statusKind = 'zero';
      borderColor = 'error.main';
      const why = buyerGone ? ' (no buyers at the destination)' : '';
      statusMessage =
        r.status === 'transit'
          ? `Income is negative: ${formatIskMillions(baseline)} → ${formatIskMillions(profit)}${why}. You can sell at a loss or pick another destination.`
          : `Income dropped to zero: ${formatIskMillions(baseline)} → ${formatIskMillions(profit)}${why}.`;
    } else if (profit > baseline * 1.03) {
      statusKind = 'up';
      borderColor = 'success.main';
      statusMessage = `Income up: ${formatIskMillions(baseline)} → ${formatIskMillions(profit)}.`;
    } else if (profit < baseline * 0.97) {
      statusKind = 'down';
      borderColor = 'warning.main';
      statusMessage = `Income down: ${formatIskMillions(baseline)} → ${formatIskMillions(profit)}.`;
    }

    out.push({
      id: r.id,
      sellValue,
      hauledVolume,
      leftMarketValue,
      limited,
      profit,
      marginPct,
      contents: results,
      contractGone,
      buyerGone,
      approachRoute,
      deliveryRoute,
      jumpsFromCurrent,
      jumpsToDest,
      totalJumps,
      profitPerJump,
      danger,
      dangerSteps,
      statusKind,
      statusMessage,
      borderColor,
    });
  }
  return out;
}

// --- Sell-elsewhere (liquidate a carried package) ----------------------------

const SELL_DEST_ROUTE_BUDGET = 50;
const DEFAULT_SELL_DEST_LIMIT = 24;

export interface PackageSellDestinationParams {
  lines: PackageStatusLine[];
  price: number;
  origin: number;
  routeType: RouteType;
  taxPct: number;
  weights: AttractivityWeights;
  limit?: number;
}

/** A routed, attractivity-scored place to sell the carried bundle — shaped like a
 *  shipped package item so the client reuses the package card to render it. */
export type PackageSellDestinationItem = PackageItem & { danger: number; dangerSteps: string[]; attractivity: number };

/** A synthetic "your ship" source endpoint (the bundle is already aboard). */
function shipEndpoint(systemId: number): ContractEndpoint {
  const system = getSystem(systemId);
  return {
    locationId: 0,
    name: 'Your ship',
    systemName: system?.name ?? null,
    systemId,
    security: system?.security ?? null,
    securityBand: system ? securityBand(system.security) : null,
    resolved: false,
  };
}

/**
 * Where can the carried bundle be sold? For each destination SYSTEM take the drop
 * station that liquidates the most value, route it from the current location,
 * score danger, and rank by the same attractivity weights as the hauling list.
 */
export function resolvePackageSellDestinations(params: PackageSellDestinationParams, kills: Map<number, number>): PackageSellDestinationItem[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const tax = params.taxPct / 100;
  const totalVolume = params.lines.reduce((s, l) => s + (getType(l.typeId)?.volume ?? 0) * l.quantity, 0);

  // Best liquidation per destination system.
  const candidates = collectCandidateDrops(params.lines.map((l) => snap.byType.get(l.typeId)));
  interface Liq {
    drop: Drop;
    results: PackageLineResult[];
    sellValue: number;
  }
  const bestBySystem = new Map<number, Liq>();
  for (const drop of candidates) {
    const { results, sellValue } = priceLinesAtDrop(params.lines, drop, snap.byType);
    if (sellValue <= 0) continue;
    const existing = bestBySystem.get(drop.system);
    if (!existing || sellValue > existing.sellValue) bestBySystem.set(drop.system, { drop, results, sellValue });
  }

  // Route only the strongest by raw revenue (routing bound, not a results cap).
  const ranked = [...bestBySystem.values()].sort((a, b) => b.sellValue - a.sellValue).slice(0, SELL_DEST_ROUTE_BUDGET);

  const items: PackageSellDestinationItem[] = [];
  for (const liq of ranked) {
    const deliveryIds = getRoute(params.origin, liq.drop.system, params.routeType);
    if (!deliveryIds) continue;
    const { index: danger, steps: dangerSteps } = dangerForSystems(deliveryIds, kills);
    const profit = liq.sellValue * (1 - tax) - params.price;
    const hauledVolume = liq.results.reduce((s, l) => s + l.soldQuantity * l.unitVolume, 0);
    const leftMarketValue = liq.results.reduce((s, l) => s + l.leftMarketValue, 0);
    const limited = liq.results.some((l) => l.leftQuantity > 0);
    // Strip the cached bid ladders from the shipped lines.
    const contents: PackageLineResult[] = liq.results.map(({ rungs: _rungs, ...rest }) => rest);
    items.push({
      id: `pkgsell:${liq.drop.station}`,
      contractId: 0,
      source: shipEndpoint(params.origin),
      dest: resolveEndpoint(liq.drop.station, liq.drop.system),
      price: params.price,
      totalVolume,
      hauledVolume,
      contents,
      sellValue: liq.sellValue,
      fullSellValue: liq.sellValue,
      leftMarketValue,
      limited,
      profit,
      marginPct: params.price > 0 ? (profit / params.price) * 100 : 0,
      salesTax: tax,
      issuedAt: 0,
      expiresAt: 0,
      approachRoute: null,
      deliveryRoute: toRouteSystems(deliveryIds, kills),
      danger,
      dangerSteps,
      attractivity: 0,
    });
  }

  const scores = scoreAttractivity(
    items.map((it) => ({ income: it.profit, totalJumps: it.deliveryRoute.length - 1, danger: it.danger })),
    params.weights,
  );
  items.forEach((it, i) => (it.attractivity = scores[i]));
  items.sort((a, b) => b.attractivity - a.attractivity);
  return items.slice(0, params.limit ?? DEFAULT_SELL_DEST_LIMIT);
}

export function loadPackagesSnapshot(contentsList: [number, ContentsEntry][]): void {
  contents.clear();
  for (const [id, entry] of contentsList) {
    contents.set(id, entry);
  }
  reconcile();
}

export function __seedTestPackages(contracts: { contract: PublicContract; lines: PackageLine[] }[]): void {
  meta.clear();
  contents.clear();
  for (const { contract, lines } of contracts) {
    meta.set(contract.contract_id, contract);
    contents.set(contract.contract_id, lines);
  }
  contentsVersion++;
}
