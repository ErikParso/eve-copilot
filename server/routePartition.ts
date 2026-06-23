// Proof that cold route time is monotonic in leg count: in ONE process (same
// machine state), time the 500k-subset delivery legs vs the EXTRA legs only the
// 100k floor adds. Disjoint, both cold. Shows 100k_cold = subset_cold + extra_cold,
// so fewer legs (500k) is strictly less work — any earlier "500k slower" was noise.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities } from './arbitrage.js';
import { getRoute } from './routing.js';

async function main() {
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  loadSnapshot(JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot);
  const byType = getSnapshot()!.byType;

  const legSet = (minProfit: number) => {
    const m = new Map<string, [number, number]>();
    for (const o of resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity, minProfit })) {
      if (o.source.systemId === null || o.dest.systemId === null) continue;
      m.set(`${o.source.systemId}-${o.dest.systemId}`, [o.source.systemId, o.dest.systemId]);
    }
    return m;
  };
  const low = legSet(100_000); // 100k floor — full set
  const highKeys = new Set(legSet(500_000).keys()); // 500k floor — subset

  const subset: [number, number][] = [];
  const extra: [number, number][] = [];
  for (const [k, v] of low) (highKeys.has(k) ? subset : extra).push(v);

  console.log(`100k legs: ${low.size}  =  500k subset: ${subset.length}  +  extra (100k-only): ${extra.length}\n`);

  // Same process, disjoint cold sets, safest (the expensive router).
  let t = performance.now();
  for (const [s, d] of subset) getRoute(s, d, 'safest');
  const tSub = performance.now() - t;
  t = performance.now();
  for (const [s, d] of extra) getRoute(s, d, 'safest');
  const tExtra = performance.now() - t;

  console.log(`safest, cold, same process:`);
  console.log(`  500k subset (${subset.length}):   ${tSub.toFixed(0)}ms  (${(tSub / subset.length).toFixed(2)}ms/leg)`);
  console.log(`  extra 100k-only (${extra.length}): ${tExtra.toFixed(0)}ms  (${(tExtra / extra.length).toFixed(2)}ms/leg)`);
  console.log(`  => 100k total = ${(tSub + tExtra).toFixed(0)}ms,  500k = ${tSub.toFixed(0)}ms  (500k is ${((1 - tSub / (tSub + tExtra)) * 100).toFixed(0)}% less)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
