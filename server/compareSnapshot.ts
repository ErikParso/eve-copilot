// Offline, deterministic arbitrage algorithm comparison against a saved market
// fixture (server/fixtures/market-snapshot.json) — no ESI, no variance. Capture
// the fixture once via GET /api/arbitrage/snapshot/save on a warmed server, then:
//   npm run compare
// Prints a text summary and writes the full side-by-side HTML report.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { summarizeComparison, buildComparisonHtml } from './arbitrageCompare.js';

async function main() {
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  console.log('Loading SDE (stations, systems, regions, item groups)…');
  await loadSde();

  console.log(`Loading market fixture: ${fixture}`);
  const data = JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot;
  loadSnapshot(data);

  const snap = getSnapshot()!;
  console.log(
    `Snapshot: ${snap.orderCount.toLocaleString()} orders, ${snap.regions} regions, built ${new Date(snap.builtAt).toISOString()}\n`,
  );
  console.log(summarizeComparison(snap.byType));

  const out = fileURLToPath(new URL('./fixtures/compare.html', import.meta.url));
  writeFileSync(out, buildComparisonHtml(null));
  console.log(`\nFull HTML report written to: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
