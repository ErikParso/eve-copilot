// Offline fixture capture for the deterministic discovery-algorithm comparison.
// Crawls the live market ONCE and persists the snapshot to
// server/fixtures/market-snapshot.json (gitignored). No app endpoint involved.
//   npm run capture     # then: npm run compare
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { startMarketRefresh, getMarketMeta, dumpSnapshot } from './market.js';

const MAX_WAIT_MS = 180_000;
const POLL_MS = 2_000;

async function main() {
  console.log('Loading SDE…');
  await loadSde();

  console.log('Starting market crawl (hits ESI; ~10–30s for a full crawl)…');
  startMarketRefresh();

  // Wait for the first crawl to complete (or give up after MAX_WAIT_MS).
  const deadline = Date.now() + MAX_WAIT_MS;
  await new Promise<void>((resolve, reject) => {
    const t = setInterval(() => {
      const meta = getMarketMeta();
      if (meta.status === 'ready') {
        clearInterval(t);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(t);
        reject(new Error(`Crawl did not become ready within ${MAX_WAIT_MS / 1000}s (status: ${meta.status})`));
      }
    }, POLL_MS);
  });

  const data = dumpSnapshot();
  if (!data) throw new Error('Snapshot not ready after crawl');

  const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  const json = JSON.stringify(data);
  writeFileSync(file, json);

  console.log(
    `Saved ${(json.length / 1e6).toFixed(0)} MB: ${data.orderCount.toLocaleString()} orders, ${data.regions} regions → ${file}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
