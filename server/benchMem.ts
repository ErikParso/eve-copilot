// Throwaway: heap of the columnar store loaded from the full fixture.
//   node --expose-gc --import tsx benchMem.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities } from './arbitrage.js';

const mb = (n: number) => (n / 1024 / 1024).toFixed(0) + ' MB';
function heap(): number {
  if (global.gc) { global.gc(); global.gc(); }
  return process.memoryUsage().heapUsed;
}

async function main() {
  await loadSde();
  const afterSde = heap();
  console.log(`after SDE:               ${mb(afterSde)}`);

  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  const data = JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot;
  loadSnapshot(data);
  const snap = getSnapshot()!;
  // Resolve once so any lazily-built state exists, then drop the parsed input.
  resolveOpportunities(snap.byType, { maxPairs: Infinity, maxTotal: Infinity });
  // help GC drop the 217MB parsed fixture + transient build structures
  (data as unknown as { byType: unknown }).byType = null;
  const afterLoad = heap();

  if (global.gc) { global.gc(); global.gc(); }
  const m = process.memoryUsage();
  console.log(`after columnar load:     heap ${mb(afterLoad)}`);
  console.log(`  ${snap.orderCount.toLocaleString()} orders, ${snap.byType.size.toLocaleString()} types`);
  console.log(`FULL FOOTPRINT (what Render's 512MB RSS limit sees):`);
  console.log(`  RSS:          ${mb(m.rss)}`);
  console.log(`  heapUsed:     ${mb(m.heapUsed)}  (object heap — was ~607 MB verbose)`);
  console.log(`  external:     ${mb(m.external)}  (typed arrays / ArrayBuffers)`);
  console.log(`  arrayBuffers: ${mb(m.arrayBuffers)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
