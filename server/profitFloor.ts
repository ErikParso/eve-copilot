// Offline: profit-floor sensitivity for the planned full server-side discovery.
// Over the UNCAPPED candidate set (every pair the full version would route),
// shows how many pairs survive each absolute full-depth-profit floor — i.e. how
// much routing + scoring work a floor saves BEFORE enrichment, and how little
// profit it costs. Run `npm run capture` first, then:  npm run floor
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities } from './arbitrage.js';

function isk(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const pad = (s: string, n: number): string => s.padEnd(n);
const padL = (s: string, n: number): string => s.padStart(n);

async function main() {
  console.log('Loading SDE…');
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  console.log(`Loading fixture: ${fixture}`);
  loadSnapshot(JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot);
  const byType = getSnapshot()!.byType;

  // The full candidate population the "full version" would route (no caps), at
  // the production source/dest scan width.
  const opps = resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity, minProfit: 0 });
  const total = opps.length;
  const totalProfit = opps.reduce((s, o) => s + o.profit, 0);
  console.log(`\nUncapped candidate pairs: ${total.toLocaleString()}   Σ profit: ${isk(totalProfit)}\n`);

  // How many survive each absolute full-depth-profit floor (= routed count).
  const floors = [0, 1e3, 1e4, 1e5, 5e5, 1e6, 5e6];
  console.log(`${pad('floor', 10)}${padL('routed', 10)}${padL('% pairs', 9)}${padL('saved', 9)}${padL('Σ profit', 12)}${padL('% profit', 10)}`);
  console.log('-'.repeat(60));
  for (const f of floors) {
    const kept = opps.filter((o) => o.profit >= f);
    const keptProfit = kept.reduce((s, o) => s + o.profit, 0);
    console.log(
      pad(f === 0 ? 'none' : isk(f), 10) +
        padL(kept.length.toLocaleString(), 10) +
        padL(pct(kept.length / total), 9) +
        padL(pct(1 - kept.length / total), 9) +
        padL(isk(keptProfit), 12) +
        padL(pct(keptProfit / totalProfit), 10),
    );
  }

  // Distribution: where the pairs actually sit (log bands).
  const bands: Array<[number, number, string]> = [
    [0, 1e3, '< 1k'],
    [1e3, 1e4, '1k – 10k'],
    [1e4, 1e5, '10k – 100k'],
    [1e5, 1e6, '100k – 1M'],
    [1e6, 1e7, '1M – 10M'],
    [1e7, Infinity, '≥ 10M'],
  ];
  console.log(`\n${pad('profit band', 14)}${padL('pairs', 10)}${padL('% pairs', 9)}${padL('Σ profit', 12)}`);
  console.log('-'.repeat(46));
  for (const [lo, hi, label] of bands) {
    const inBand = opps.filter((o) => o.profit >= lo && o.profit < hi);
    const bandProfit = inBand.reduce((s, o) => s + o.profit, 0);
    console.log(
      pad(label, 14) + padL(inBand.length.toLocaleString(), 10) + padL(pct(inBand.length / total), 9) + padL(isk(bandProfit), 12),
    );
  }
  console.log('\n"saved" = fraction of candidate pairs a floor removes before routing.');

  // --- Unique route resolves: 1500 (prod) vs ~40k (floored, uncapped) ---------
  // Routes are keyed by SYSTEM pair (+ type), not by opportunity, so many pairs
  // share one cached route. These are the route SEARCHES the full version would
  // actually run (cache misses) — far fewer than the opportunity count.
  const routeStats = (list: typeof opps) => {
    const delivery = new Set(list.map((o) => `${o.source.systemId}->${o.dest.systemId}`));
    const src = new Set(list.map((o) => o.source.systemId)); // approach routes per origin
    const dst = new Set(list.map((o) => o.dest.systemId));
    return { pairs: list.length, delivery: delivery.size, src: src.size, dst: dst.size };
  };
  const prod = routeStats(resolveOpportunities(byType)); // defaults: floor 100k, maxPairs 12, maxTotal 1500
  const full = routeStats(resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity })); // floor 100k, uncapped

  console.log('\n--- unique route resolves: prod (top-1500) vs floored uncapped (~40k) ---');
  console.log(`${pad('', 34)}${padL('prod 1500', 12)}${padL('floored', 12)}`);
  const row = (label: string, a: number, b: number) => console.log(pad(label, 34) + padL(a.toLocaleString(), 12) + padL(b.toLocaleString(), 12));
  row('opportunity pairs', prod.pairs, full.pairs);
  row('distinct delivery routes (src→dst)', prod.delivery, full.delivery);
  row('  reuse (pairs / delivery route)', Math.round((prod.pairs / prod.delivery) * 10) / 10, Math.round((full.pairs / full.delivery) * 10) / 10);
  row('distinct source systems (approach)', prod.src, full.src);
  row('distinct destination systems', prod.dst, full.dst);
  row('COLD resolves, 1 origin (deliv+appr)', prod.delivery + prod.src, full.delivery + full.src);
  console.log('Delivery routes: origin-independent → resolved once per snapshot, shared across all origins.');
  console.log('Approach routes: per-origin = distinct source systems → re-cold on each jump, then cached.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
