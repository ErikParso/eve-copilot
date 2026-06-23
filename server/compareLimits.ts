// Offline cap-sensitivity sweep for the improved discovery algorithm: run
// resolveOpportunities over the SAME fixed snapshot with different perf-guard
// limits and report how many opportunities / lanes / profit each captures, and
// the runtime cost. Answers "how much are the caps leaving on the table, and what
// would relaxing them cost?". Capture a fixture first with `npm run capture`.
//   npm run compare:limits
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities, DEFAULT_LIMITS, type DiscoveryLimits } from './arbitrage.js';
import type { ArbitrageOpportunity } from './types.js';

function isk(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return `${(n / 1e3).toFixed(0)}k`;
}
const pad = (s: string, n: number): string => s.padEnd(n);
const padL = (s: string, n: number): string => s.padStart(n);

interface Config {
  name: string;
  limits: Partial<DiscoveryLimits>;
}

// Note: maxSources/maxDests drive the O(dests²) pooling, so they're the costly
// knobs — kept to bounded relaxations (≤80). maxPairs/maxTotal are just slicing.
const configs: Config[] = [
  { name: 'prod (40/40/12/1500)', limits: {} },
  { name: 'maxTotal 3000', limits: { maxTotal: 3000 } },
  { name: 'maxTotal ∞', limits: { maxTotal: Infinity } },
  { name: 'maxPairs 24', limits: { maxPairs: 24 } },
  { name: 'maxPairs ∞ (+total ∞)', limits: { maxPairs: Infinity, maxTotal: Infinity } },
  { name: 'maxDests 80', limits: { maxDests: 80 } },
  { name: 'maxSources 80', limits: { maxSources: 80 } },
  { name: 'wide 80/80/24/5000', limits: { maxSources: 80, maxDests: 80, maxPairs: 24, maxTotal: 5000 } },
  { name: 'all relaxed 80/80/∞/∞', limits: { maxSources: 80, maxDests: 80, maxPairs: Infinity, maxTotal: Infinity } },
];

async function main() {
  console.log('Loading SDE…');
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  console.log(`Loading fixture: ${fixture}`);
  loadSnapshot(JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot);
  const byType = getSnapshot()!.byType;

  // Discovery time only (one-time, cached per 20-min snapshot rebuild). Warm up
  // once, then take the median of several runs so JIT/GC noise doesn't dominate.
  const ITERS = 7;
  // minProfit: 0 so this isolates the CAP effects; the 100k production floor is a
  // separate, orthogonal lever (see `npm run floor`).
  const timed = (limits: Partial<DiscoveryLimits>) => {
    const lim = { minProfit: 0, ...limits };
    resolveOpportunities(byType, lim); // warmup
    const times: number[] = [];
    let res: ArbitrageOpportunity[] = [];
    for (let i = 0; i < ITERS; i++) {
      const t0 = performance.now();
      res = resolveOpportunities(byType, lim);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { res, medianMs: times[Math.floor(times.length / 2)], minMs: times[0] };
  };

  console.log(
    `\n${pad('config', 24)}${padL('opps', 8)}${padL('Σ profit', 12)}${padL('disc.ms', 9)}${padL('min', 7)}${padL('Δopps', 8)}${padL('Δprofit', 12)}`,
  );
  console.log('-'.repeat(80));

  let baseOpps = 0;
  let baseProfit = 0;
  for (const c of configs) {
    const { res, medianMs, minMs } = timed(c.limits);
    const profit = res.reduce((s, o) => s + o.profit, 0);
    if (Object.keys(c.limits).length === 0) {
      baseOpps = res.length;
      baseProfit = profit;
    }
    const dOpps = res.length - baseOpps;
    const dProfit = profit - baseProfit;
    console.log(
      pad(c.name, 24) +
        padL(String(res.length), 8) +
        padL(isk(profit), 12) +
        padL(medianMs.toFixed(0), 9) +
        padL(minMs.toFixed(0), 7) +
        padL(dOpps >= 0 ? `+${dOpps}` : String(dOpps), 8) +
        padL(`${dProfit >= 0 ? '+' : ''}${isk(dProfit)}`, 12),
    );
  }
  console.log('\ndisc.ms = DISCOVERY time only (median of 7 runs), a one-time cost per 20-min');
  console.log('snapshot rebuild — NOT per request. Per-request route enrichment + JSON payload');
  console.log('scale with opps (≈ maxTotal). Σ profit sums the menu (alternatives, not all realizable).');

  // --- What exactly does MAX_OPPORTUNITIES truncate? ---------------------------
  // Production keeps the top `maxTotal` by profit, so the dropped ones are the
  // LOWEST-profit tail. Quantify that tail and the cutoff value, at prod's
  // per-type cap (maxPairs=12).
  const cap = DEFAULT_LIMITS.maxTotal;
  const full = resolveOpportunities(byType, { maxTotal: Infinity, minProfit: 0 }); // maxPairs stays prod (12)
  const cutoffProfit = full[cap - 1]?.profit ?? 0; // profit of the last KEPT deal
  const firstDropped = full[cap]?.profit ?? 0; // profit of the first DROPPED deal
  const dropped = full.slice(cap);
  const over = (t: number) => dropped.filter((o) => o.profit >= t).length;
  console.log(`\n--- MAX_OPPORTUNITIES truncation (cap = ${cap}, maxPairs = ${DEFAULT_LIMITS.maxPairs}) ---`);
  console.log(`kept #${cap} cutoff profit:   ${isk(cutoffProfit)}  (last deal that makes the menu)`);
  console.log(`first dropped deal profit: ${isk(firstDropped)}  (best deal that DOESN'T)`);
  console.log(`dropped deals:             ${dropped.length}  (Σ ${isk(dropped.reduce((s, o) => s + o.profit, 0))})`);
  console.log(`  of those ≥ 100M profit:  ${over(100e6)}`);
  console.log(`  of those ≥ 50M profit:   ${over(50e6)}`);
  console.log(`  of those ≥ 10M profit:   ${over(10e6)}`);

  // Same, but with the per-type cap removed (maxPairs ∞) — i.e. once deep types'
  // lucrative lanes are allowed to compete for the global top-`cap` slots.
  const full2 = resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity, minProfit: 0 });
  const cutoff2 = full2[cap - 1]?.profit ?? 0;
  const dropped2 = full2.slice(cap);
  const over2 = (t: number) => dropped2.filter((o) => o.profit >= t).length;
  console.log(`\n--- same, but maxPairs = ∞ (deep types allowed to compete) ---`);
  console.log(`kept #${cap} cutoff profit:   ${isk(cutoff2)}  (rises — better lanes now fill the slots)`);
  console.log(`dropped ≥ 100M / 50M / 10M: ${over2(100e6)} / ${over2(50e6)} / ${over2(10e6)}`);
  console.log(`  → if you raise maxPairs, raise maxTotal too or the global cap starts biting real deals.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
