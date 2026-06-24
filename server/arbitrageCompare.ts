// OFFLINE DIAGNOSTIC ONLY (not wired into the running app) — a side-by-side
// comparison of the arbitrage opportunity discovery: a frozen BASELINE algorithm
// (`resolveOpportunitiesLegacy` below) vs the current production `resolveOpportunities`.
// Both run over the SAME fixed market snapshot (same orders/tax/volumes), so the
// only difference shown is the discovery algorithm itself. Run via `npm run compare`
// (see compareSnapshot.ts); capture the fixture with `npm run capture`.
//
// REUSING THIS FOR FUTURE DISCOVERY CHANGES: the baseline below is the
// pre-range-pooling algorithm. Before experimenting with a new change, replace the
// baseline's body with a copy of the CURRENT production `resolveOpportunities` (so
// the comparison measures your new change's incremental effect), then modify
// production and run `npm run compare`.
import { getSnapshot, storeFromVerboseEntries, type TypeBook, type MarketStore } from './market.js';
import { getType } from './sde.js';
import { getMarketPrice } from './prices.js';
import { resolveEndpoint } from './enrich.js';
import {
  walkDepth,
  resolveOpportunities,
  DEFAULT_SALES_TAX,
  MAX_SOURCES_PER_TYPE,
  MAX_DESTS_PER_TYPE,
  MAX_PAIRS_PER_TYPE,
  MAX_OPPORTUNITIES,
} from './arbitrage.js';
import type { ArbitrageOpportunity } from './types.js';

// --- Legacy discovery (verbatim from before the improvement) -----------------
// One opportunity per profitable source-station → dest-STATION pair: a dest's
// sellable depth was only the bids physically resting at that station (no range
// pooling, no per-system dedup).

function opportunitiesForTypeLegacy(
  typeId: number,
  name: string,
  unitVolume: number,
  book: TypeBook,
): ArbitrageOpportunity[] {
  const tax = DEFAULT_SALES_TAX;
  const dearestBuy = book.buys[0]?.best ?? -Infinity;
  if (book.sells.length === 0 || dearestBuy * (1 - tax) <= (book.sells[0]?.best ?? Infinity)) return [];

  const sources = book.sells.slice(0, MAX_SOURCES_PER_TYPE);
  const dests = book.buys.slice(0, MAX_DESTS_PER_TYPE);
  const marketPrice = getMarketPrice(typeId);
  const out: ArbitrageOpportunity[] = [];

  for (const source of sources) {
    if (dearestBuy * (1 - tax) <= source.best) break;
    for (const dest of dests) {
      if (dest.station === source.station) continue;
      if (dest.best * (1 - tax) <= source.best) break;
      const { quantity, buyCost, sellRevenueGross, ladder } = walkDepth(source.orders, dest.orders);
      if (quantity <= 0) continue;
      const profit = sellRevenueGross * (1 - tax) - buyCost;
      if (profit <= 0) continue;

      out.push({
        id: `${typeId}:${source.station}:${dest.station}`,
        typeId,
        itemName: name,
        quantity,
        unitVolume,
        totalVolume: quantity * unitVolume,
        buyPrice: buyCost / quantity,
        sellPrice: sellRevenueGross / quantity,
        marketPrice,
        buyCost,
        profit,
        marginPct: (profit / buyCost) * 100,
        ladder,
        salesTax: tax,
        source: resolveEndpoint(source.station, source.system),
        dest: resolveEndpoint(dest.station, dest.system),
      });
    }
  }

  out.sort((a, b) => b.profit - a.profit);
  return out.length > MAX_PAIRS_PER_TYPE ? out.slice(0, MAX_PAIRS_PER_TYPE) : out;
}

function resolveOpportunitiesLegacy(byType: Map<number, TypeBook>): ArbitrageOpportunity[] {
  const all: ArbitrageOpportunity[] = [];
  for (const [typeId, book] of byType) {
    const type = getType(typeId);
    if (!type) continue;
    all.push(...opportunitiesForTypeLegacy(typeId, type.name, type.volume, book));
  }
  all.sort((a, b) => b.profit - a.profit);
  return all.length > MAX_OPPORTUNITIES ? all.slice(0, MAX_OPPORTUNITIES) : all;
}

// --- HTML rendering ----------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function isk(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}
const num = (n: number): string => n.toLocaleString('en-US');
const endpoint = (e: ArbitrageOpportunity['source']): string => `${e.systemName ?? '?'} · ${e.name}`;
const lane = (o: ArbitrageOpportunity): string => `${endpoint(o.source)} → ${endpoint(o.dest)}`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; color: #1a1a2e; background: #f7f7fb; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 24px 0 8px; }
  .muted { color: #667; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .card { background: #fff; border: 1px solid #e2e2ee; border-radius: 8px; padding: 12px 16px; min-width: 150px; }
  .card .big { font-size: 22px; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin-bottom: 8px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  th { background: #f0f0f7; position: sticky; top: 0; }
  .up { color: #0a7d34; font-weight: 600; } .down { color: #b00020; font-weight: 600; }
  .wrap { max-height: 480px; overflow: auto; border: 1px solid #e2e2ee; border-radius: 8px; }
  code { background: #eee; padding: 1px 4px; border-radius: 4px; }
</style></head><body>${body}</body></html>`;
}

// A "lane" = (item type, source station, destination SYSTEM). The improved
// algorithm folds a system's per-station dests into one representative drop, so
// matching by lane — not by exact dest-station id — is the only fair way to ask
// "does the new algo still capture what legacy found here?". The same lane being
// emitted under a different representative station is a benign fold, NOT a loss.
const laneKey = (o: ArbitrageOpportunity): string => `${o.typeId}:${o.source.locationId}:${o.dest.systemId}`;
const laneSys = (o: ArbitrageOpportunity): string => `${o.source.systemName ?? '?'} → ${o.dest.systemName ?? '?'}`;

interface LaneAgg {
  best: ArbitrageOpportunity; // most profitable legacy row on the lane
  rows: number; // how many per-station legacy rows folded into this lane
}
interface Regression {
  leg: ArbitrageOpportunity;
  rows: number;
  imp: ArbitrageOpportunity | null;
  loss: number;
}

export interface ComparisonResult {
  legacyCount: number; // legacy opportunities (capped menu)
  improvedCount: number; // improved opportunities (capped menu)
  legacyLaneCount: number;
  improvedLaneCount: number;
  cappedOut: boolean;
  // Discovery quality — legacy lane vs the UNCAPPED improved set (the menu cap is
  // a separate concern, so it can't mask a discovery regression here).
  lostTrue: Regression[]; // improved doesn't discover the lane at all
  weaker: Regression[]; // improved discovers it but at materially LESS profit
  gains: Regression[]; // improved discovers MORE profit (pooling)
  coveredCount: number; // improved ≈ legacy
  coveredProfit: number;
  improvedOnly: ArbitrageOpportunity[]; // lanes only the improved menu has
  // Orthogonal, informational: legacy lanes the improved logic still discovers
  // but the top-N menu cap drops from the shown set (a MAX_OPPORTUNITIES concern,
  // NOT a discovery regression).
  capDisplaced: Regression[];
}

/** Run both algorithms over one order book and classify every lane. Pure. */
export function computeComparison(byType: MarketStore): ComparisonResult {
  // The legacy discovery iterates a verbose Map; hydrate the whole store once for
  // it (offline diagnostic, so the memory spike is fine).
  const legacyMap = byType.hydrateAll();
  // minProfit: 0 on both sides so this stays a pure ALGORITHM comparison (legacy
  // has no floor); the 100k production floor is an orthogonal lever.
  const improved = resolveOpportunities(byType, { minProfit: 0 });
  const legacy = resolveOpportunitiesLegacy(legacyMap);
  // The improved discovery with the per-type + global caps removed. Discovery
  // quality is judged against THIS, so menu truncation can't hide a regression.
  const improvedUncapped = resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity, minProfit: 0 });
  const impUncappedByLane = new Map<string, ArbitrageOpportunity>();
  for (const o of improvedUncapped) {
    const cur = impUncappedByLane.get(laneKey(o));
    if (!cur || o.profit > cur.profit) impUncappedByLane.set(laneKey(o), o);
  }
  const cappedOut = improved.length >= MAX_OPPORTUNITIES;

  // Fold both sides into lanes.
  const legByLane = new Map<string, LaneAgg>();
  for (const o of legacy) {
    const k = laneKey(o);
    const cur = legByLane.get(k);
    if (!cur) legByLane.set(k, { best: o, rows: 1 });
    else {
      cur.rows++;
      if (o.profit > cur.best.profit) cur.best = o;
    }
  }
  const impByLane = new Map<string, ArbitrageOpportunity>(); // capped menu
  for (const o of improved) {
    const cur = impByLane.get(laneKey(o));
    if (!cur || o.profit > cur.profit) impByLane.set(laneKey(o), o);
  }

  // Classify each legacy lane by DISCOVERY (vs uncapped improved), and separately
  // note whether the capped menu still shows it.
  const lostTrue: Regression[] = [];
  const weaker: Regression[] = [];
  const gains: Regression[] = [];
  const capDisplaced: Regression[] = [];
  let coveredCount = 0;
  let coveredProfit = 0;
  for (const [k, agg] of legByLane) {
    const u = impUncappedByLane.get(k) ?? null;
    if (!u) {
      lostTrue.push({ leg: agg.best, rows: agg.rows, imp: null, loss: agg.best.profit });
    } else {
      const loss = agg.best.profit - u.profit;
      if (loss > Math.max(1000, agg.best.profit * 0.001)) {
        weaker.push({ leg: agg.best, rows: agg.rows, imp: u, loss });
      } else if (u.profit > agg.best.profit * 1.001) {
        gains.push({ leg: agg.best, rows: agg.rows, imp: u, loss });
      } else {
        coveredCount++;
        coveredProfit += agg.best.profit;
      }
      // Discovered fine, but did the capped menu keep it?
      if (!impByLane.has(k)) capDisplaced.push({ leg: agg.best, rows: agg.rows, imp: u, loss });
    }
  }
  lostTrue.sort((a, b) => b.leg.profit - a.leg.profit);
  weaker.sort((a, b) => b.loss - a.loss);
  gains.sort((a, b) => a.loss - b.loss); // most negative loss = biggest gain first
  capDisplaced.sort((a, b) => b.leg.profit - a.leg.profit);

  const improvedOnly = [...impByLane.entries()].filter(([k]) => !legByLane.has(k)).map(([, o]) => o);

  return {
    legacyCount: legacy.length,
    improvedCount: improved.length,
    legacyLaneCount: legByLane.size,
    improvedLaneCount: impByLane.size,
    cappedOut,
    lostTrue,
    weaker,
    gains,
    coveredCount,
    coveredProfit,
    improvedOnly,
    capDisplaced,
  };
}

/** One-line-per-metric text summary (for the offline fixture script / tests). */
export function summarizeComparison(byType: MarketStore): string {
  const c = computeComparison(byType);
  const sum = (rs: Regression[], pick: (r: Regression) => number) => rs.reduce((s, r) => s + pick(r), 0);
  return [
    `legacy opportunities:   ${c.legacyCount}`,
    `improved opportunities: ${c.improvedCount}${c.cappedOut ? '  (hit MAX_OPPORTUNITIES cap)' : ''}`,
    `legacy lanes:           ${c.legacyLaneCount}`,
    `improved lanes:         ${c.improvedLaneCount}`,
    `covered (no change):    ${c.coveredCount}  (${isk(c.coveredProfit)} profit)`,
    `gains (pooling):        ${c.gains.length}  (+${isk(-sum(c.gains, (r) => r.loss))} profit)`,
    `improved-only lanes:    ${c.improvedOnly.length}`,
    `--- discovery regressions (vs UNCAPPED improved) ---`,
    `lost (not discovered):  ${c.lostTrue.length}  (${isk(sum(c.lostTrue, (r) => r.leg.profit))} legacy profit)`,
    `weaker (less profit):   ${c.weaker.length}  (-${isk(sum(c.weaker, (r) => r.loss))} profit)`,
    `cap-displaced (menu):   ${c.capDisplaced.length}  (${isk(sum(c.capDisplaced, (r) => r.leg.profit))} legacy profit, still discovered)`,
  ].join('\n');
}

/** Render the legacy-vs-improved comparison for the live snapshot as HTML. */
export function buildComparisonHtml(typeIdFilter: number | null): string {
  const snap = getSnapshot();
  if (!snap) {
    return page('Arbitrage compare', '<h1>Arbitrage discovery: before vs after</h1><p>Market snapshot not ready yet — wait for the crawl to warm up, then refresh.</p>');
  }

  let byType: MarketStore = snap.byType;
  if (typeIdFilter !== null) {
    const b = snap.byType.hydrateType(typeIdFilter);
    byType = storeFromVerboseEntries(b ? [[typeIdFilter, b]] : []);
  }

  const { lostTrue, capDisplaced, weaker, gains, improvedOnly, coveredCount, coveredProfit, cappedOut, legacyCount, legacyLaneCount, improvedLaneCount } =
    computeComparison(byType);
  const lostTrueProfit = lostTrue.reduce((s, r) => s + r.leg.profit, 0);
  const capDisplacedProfit = capDisplaced.reduce((s, r) => s + r.leg.profit, 0);
  const weakerLoss = weaker.reduce((s, r) => s + r.loss, 0);

  // Row renderers.
  const lostRow = (r: Regression): string =>
    `<tr><td>${esc(r.leg.itemName)}</td><td class="muted">${esc(laneSys(r.leg))}</td><td class="muted">${esc(r.leg.dest.name)}</td>` +
    `<td class="down">${isk(r.leg.profit)}</td><td>${num(r.leg.quantity)}</td><td>${r.leg.marginPct.toFixed(1)}%</td><td>${r.rows}</td></tr>`;
  const weakerRow = (r: Regression): string =>
    `<tr><td>${esc(r.leg.itemName)}</td><td class="muted">${esc(laneSys(r.leg))}</td>` +
    `<td class="muted">${esc(r.leg.dest.name)}</td><td>${isk(r.leg.profit)}</td>` +
    `<td class="muted">${esc(r.imp!.dest.name)}</td><td>${isk(r.imp!.profit)}</td>` +
    `<td class="down">-${isk(r.loss)}</td><td>${r.rows}</td></tr>`;
  const capRow = (r: Regression): string =>
    `<tr><td>${esc(r.leg.itemName)}</td><td class="muted">${esc(laneSys(r.leg))}</td>` +
    `<td>${isk(r.leg.profit)}</td><td>${r.imp ? isk(r.imp.profit) : '—'}</td><td>${r.rows}</td></tr>`;
  const gainRow = (r: Regression): string =>
    `<tr><td>${esc(r.leg.itemName)}</td><td class="muted">${esc(laneSys(r.leg))}</td>` +
    `<td>${num(r.leg.quantity)}</td><td>${num(r.imp!.quantity)}</td>` +
    `<td>${isk(r.leg.profit)}</td><td>${isk(r.imp!.profit)}</td><td class="up">+${isk(-r.loss)}</td></tr>`;
  const oppRow = (o: ArbitrageOpportunity): string =>
    `<tr><td>${esc(o.itemName)}</td><td class="muted">${esc(lane(o))}</td><td>${num(o.quantity)}</td><td>${isk(o.profit)}</td><td>${o.marginPct.toFixed(1)}%</td></tr>`;

  const scope = typeIdFilter !== null ? ` for type <code>${typeIdFilter}</code>` : '';
  const regNote =
    'A regression is a per-system <em>lane</em> (source → dest system) where the new algorithm finds <strong>less profit</strong> than the best legacy ' +
    'opportunity on that lane — almost always because per-system dedup keeps only the dearest-best-bid drop station, dropping <strong>station-range</strong> ' +
    'buy orders resting at other stations in that system. Lanes merely re-keyed to a different representative station (same/greater profit) are benign folds, not losses.';
  const body = `
    <h1>Arbitrage discovery: before vs after${scope}</h1>
    <p class="muted">Both algorithms run over the same live snapshot
      (built ${new Date(snap.builtAt).toLocaleTimeString()}, ${num(snap.orderCount)} orders, ${snap.regions} regions).
      The improved side adds range-aware destination pooling + per-system dedup. Append <code>?typeId=34</code> to focus one item type.
      Analysis is per <strong>lane</strong> = (item, source station, destination system); profit sums span the menu (capped at ${num(MAX_OPPORTUNITIES)} by profit), a set of alternatives not all simultaneously realizable.</p>

    <div class="cards">
      <div class="card"><div class="muted">Legacy lanes</div><div class="big">${num(legacyLaneCount)}</div></div>
      <div class="card"><div class="muted">Improved lanes</div><div class="big">${num(improvedLaneCount)}</div></div>
      <div class="card"><div class="muted">Lost — not discovered (regression)</div><div class="big ${lostTrue.length ? 'down' : ''}">${num(lostTrue.length)}</div><div class="muted">${isk(lostTrueProfit)} profit</div></div>
      <div class="card"><div class="muted">Weaker — less profit (regression)</div><div class="big ${weaker.length ? 'down' : ''}">${num(weaker.length)}</div><div class="muted">-${isk(weakerLoss)} profit</div></div>
      <div class="card"><div class="muted">Improved by pooling</div><div class="big up">${num(gains.length)}</div></div>
      <div class="card"><div class="muted">Covered (no change)</div><div class="big">${num(coveredCount)}</div><div class="muted">${isk(coveredProfit)} profit</div></div>
      <div class="card"><div class="muted">Cap-displaced (menu, not discovery)</div><div class="big">${num(capDisplaced.length)}</div><div class="muted">${isk(capDisplacedProfit)} profit, still discovered</div></div>
    </div>

    <p class="muted">Discovery quality (lost / weaker / covered / gains) is judged against the <strong>uncapped</strong> improved discovery, so the menu cap can't mask a real regression. ${cappedOut ? `The shown menu hit the ${num(MAX_OPPORTUNITIES)}-opportunity cap (legacy emitted ${num(legacyCount)}); "cap-displaced" lists legacy lanes the improved logic still finds but the cap drops from the shown set — a cap-tuning concern, not a discovery loss.` : ''}</p>

    <h2>⚠ TRUE regressions — lucrative legacy lanes the new algorithm does NOT discover even uncapped (top 80, by legacy profit)</h2>
    <p class="muted">${regNote}</p>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane (systems)</th><th>Legacy drop station</th><th>Legacy profit</th><th>Qty</th><th>Margin</th><th>Folded rows</th></tr></thead>
      <tbody>${lostTrue.slice(0, 80).map(lostRow).join('') || '<tr><td colspan="7" class="muted">None — the improved logic discovers every legacy lane (some may be cap-displaced from the shown menu; see below).</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${num(lostTrue.length)} truly-lost lanes (${isk(lostTrueProfit)} of legacy profit).</p>

    <h2>⚠ WEAKER — legacy lanes the new algorithm discovers but at LESS profit (top 80, by profit lost)</h2>
    <p class="muted">The real cost of per-system dedup: improved picks the dearest-best-bid drop station, which can miss big <strong>station-range</strong> demand resting at another station in the same system. Compared against the uncapped improved discovery.</p>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane (systems)</th><th>Legacy drop</th><th>Legacy profit</th><th>Improved drop</th><th>Improved profit</th><th>Profit lost</th><th>Folded rows</th></tr></thead>
      <tbody>${weaker.slice(0, 80).map(weakerRow).join('') || '<tr><td colspan="8" class="muted">None — the new algorithm matches or beats legacy on every discovered lane.</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${num(weaker.length)} weaker lanes in total (-${isk(weakerLoss)} profit).</p>

    <h2>Cap-displaced (informational) — legacy lanes the improved logic still finds, but the top-${num(MAX_OPPORTUNITIES)} menu cap drops (top 60)</h2>
    <p class="muted">Not a discovery regression: shown with their uncapped improved profit. Raise <code>MAX_OPPORTUNITIES</code> to keep them in the menu.</p>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane (systems)</th><th>Legacy profit</th><th>Improved profit (uncapped)</th><th>Folded rows</th></tr></thead>
      <tbody>${capDisplaced.slice(0, 60).map(capRow).join('') || '<tr><td colspan="5" class="muted">None.</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${num(capDisplaced.length)} cap-displaced lanes (${isk(capDisplacedProfit)} of legacy profit).</p>

    <h2>Gains — lanes where pooling increased profit (top 80)</h2>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane (systems)</th><th>Qty (legacy)</th><th>Qty (improved)</th><th>Profit (legacy)</th><th>Profit (improved)</th><th>Δ profit</th></tr></thead>
      <tbody>${gains.slice(0, 80).map(gainRow).join('') || '<tr><td colspan="7" class="muted">None.</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${num(gains.length)} improved lanes in total.</p>

    <h2>Improved-only lanes (top 60) — newly surfaced by pooling</h2>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane</th><th>Qty</th><th>Profit</th><th>Margin</th></tr></thead>
      <tbody>${improvedOnly.slice(0, 60).map(oppRow).join('') || '<tr><td colspan="5" class="muted">None.</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${num(improvedOnly.length)} improved-only lanes in total.</p>
  `;
  return page('Arbitrage compare', body);
}
