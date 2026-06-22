// DIAGNOSTIC ONLY — a side-by-side comparison of the arbitrage opportunity
// discovery BEFORE vs AFTER the range-aware destination pooling change. Both
// algorithms run over the SAME live market snapshot (same orders, same tax, same
// volumes), so the only difference shown is the discovery algorithm itself.
//
// Served read-only at GET /api/arbitrage/compare (optional ?typeId=<n> to focus
// one item type). Safe to delete once the change has been validated.
import { getSnapshot, type TypeBook } from './market.js';
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

interface Diff {
  o: ArbitrageOpportunity;
  legacy: ArbitrageOpportunity;
  dQty: number;
  dProfit: number;
}

/** Render the legacy-vs-improved comparison for the live snapshot as HTML. */
export function buildComparisonHtml(typeIdFilter: number | null): string {
  const snap = getSnapshot();
  if (!snap) {
    return page('Arbitrage compare', '<h1>Arbitrage discovery: before vs after</h1><p>Market snapshot not ready yet — wait for the crawl to warm up, then refresh.</p>');
  }

  let byType = snap.byType;
  if (typeIdFilter !== null) {
    const b = byType.get(typeIdFilter);
    byType = new Map(b ? [[typeIdFilter, b]] : []);
  }

  const improved = resolveOpportunities(byType);
  const legacy = resolveOpportunitiesLegacy(byType);
  const impById = new Map(improved.map((o) => [o.id, o]));
  const legById = new Map(legacy.map((o) => [o.id, o]));

  // Matched opportunities (same source + representative dest station): the
  // improved depth/profit should be >= legacy thanks to range pooling.
  const matched: Diff[] = [];
  for (const o of improved) {
    const l = legById.get(o.id);
    if (l) matched.push({ o, legacy: l, dQty: o.quantity - l.quantity, dProfit: o.profit - l.profit });
  }
  const gained = matched.filter((m) => m.dQty > 0.5);
  const extraQty = gained.reduce((s, m) => s + m.dQty, 0);
  const extraProfit = gained.reduce((s, m) => s + m.dProfit, 0);

  // Opportunities present in only one side.
  const legacyOnly = legacy.filter((o) => !impById.has(o.id));
  const improvedOnly = improved.filter((o) => !legById.has(o.id));

  const diffRow = (m: Diff): string => {
    const qCls = m.dQty > 0.5 ? 'up' : m.dQty < -0.5 ? 'down' : 'muted';
    const pCls = m.dProfit > 0 ? 'up' : m.dProfit < 0 ? 'down' : 'muted';
    return `<tr><td>${esc(m.o.itemName)}</td><td class="muted">${esc(lane(m.o))}</td>
      <td>${num(m.legacy.quantity)}</td><td>${num(m.o.quantity)}</td>
      <td class="${qCls}">${m.dQty >= 0 ? '+' : ''}${num(Math.round(m.dQty))}</td>
      <td>${isk(m.legacy.profit)}</td><td>${isk(m.o.profit)}</td>
      <td class="${pCls}">${m.dProfit >= 0 ? '+' : ''}${isk(m.dProfit)}</td></tr>`;
  };
  const oppRow = (o: ArbitrageOpportunity): string =>
    `<tr><td>${esc(o.itemName)}</td><td class="muted">${esc(lane(o))}</td><td>${num(o.quantity)}</td><td>${isk(o.profit)}</td><td>${o.marginPct.toFixed(1)}%</td></tr>`;

  const scope = typeIdFilter !== null ? ` for type <code>${typeIdFilter}</code>` : '';
  const body = `
    <h1>Arbitrage discovery: before vs after${scope}</h1>
    <p class="muted">Both algorithms run over the same live snapshot
      (built ${new Date(snap.builtAt).toLocaleTimeString()}, ${num(snap.orderCount)} orders, ${snap.regions} regions).
      The improved side adds range-aware destination pooling + per-system dedup. Append <code>?typeId=34</code> to focus one item type.
      Sums below are across the listed opportunity menu (capped at ${num(MAX_OPPORTUNITIES)} by profit) — a menu of alternatives, not all simultaneously realizable.</p>

    <div class="cards">
      <div class="card"><div class="muted">Opportunities (legacy)</div><div class="big">${num(legacy.length)}</div></div>
      <div class="card"><div class="muted">Opportunities (improved)</div><div class="big">${num(improved.length)}</div></div>
      <div class="card"><div class="muted">Matched, depth increased</div><div class="big up">${num(gained.length)}</div><div class="muted">of ${num(matched.length)} matched</div></div>
      <div class="card"><div class="muted">Extra sellable units</div><div class="big up">+${num(Math.round(extraQty))}</div></div>
      <div class="card"><div class="muted">Extra profit (on matched)</div><div class="big up">+${isk(extraProfit)}</div></div>
    </div>

    <h2>Matched opportunities — biggest depth/profit gains from pooling (top 80)</h2>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane</th><th>Qty (legacy)</th><th>Qty (improved)</th><th>Δ qty</th><th>Profit (legacy)</th><th>Profit (improved)</th><th>Δ profit</th></tr></thead>
      <tbody>${matched.sort((a, b) => b.dProfit - a.dProfit).slice(0, 80).map(diffRow).join('')}</tbody>
    </table></div>

    <h2>Legacy-only opportunities (top 60) — redundant per-station rows folded into one per-system opportunity (or dropped)</h2>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane</th><th>Qty</th><th>Profit</th><th>Margin</th></tr></thead>
      <tbody>${legacyOnly.slice(0, 60).map(oppRow).join('')}</tbody>
    </table></div>
    <p class="muted">${num(legacyOnly.length)} legacy-only in total.</p>

    <h2>Improved-only opportunities (top 60) — newly surfaced by pooling</h2>
    <div class="wrap"><table>
      <thead><tr><th>Item</th><th>Lane</th><th>Qty</th><th>Profit</th><th>Margin</th></tr></thead>
      <tbody>${improvedOnly.slice(0, 60).map(oppRow).join('')}</tbody>
    </table></div>
    <p class="muted">${num(improvedOnly.length)} improved-only in total.</p>
  `;
  return page('Arbitrage compare', body);
}
