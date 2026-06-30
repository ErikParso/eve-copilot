// Offline fixture capture for contracts and packages.
// Crawls ESI for public contracts (couriers + sells) and fetches contents for up to 100 sells.
// Saves the snapshot to server/fixtures/contracts-snapshot.json.
// Run using: npm run capture:contracts
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde, getStation, getRegion } from './sde.js';
import { crawlContracts } from './contracts.js';
import { fetchContents } from './packages.js';
import { regionPriorityRank } from './market.js';
import { mapWithConcurrency } from './esi.js';
import type { PublicContract } from './types.js';

function regionRankOf(c: PublicContract): number {
  const systemId = getStation(c.start_location_id)?.systemId ?? null;
  return regionPriorityRank(systemId === null ? null : getRegion(systemId));
}

async function main() {
  console.log('Loading SDE…');
  await loadSde();

  console.log('Crawling public contracts from ESI…');
  const { contracts: couriers, sells, lastModifiedAt } = await crawlContracts();

  // Sort sell contracts so hub regions are crawled first
  const sortedSells = [...sells].sort((a, b) => regionRankOf(a) - regionRankOf(b));

  // Cap contents fetching to keep script fast and prevent rate limit
  const fetchLimit = 100;
  const sellsToFetch = sortedSells.slice(0, fetchLimit);

  console.log(`Fetching contents for top ${sellsToFetch.length} sell contracts...`);
  type ContentsTuple = [number, Awaited<ReturnType<typeof fetchContents>>];
  const contents = await mapWithConcurrency(sellsToFetch, 8, async (c): Promise<ContentsTuple> => {
    try {
      const lines = await fetchContents(c.contract_id);
      return [c.contract_id, lines];
    } catch (err) {
      console.error(`[Capture] Failed to fetch contents for ${c.contract_id}:`, err);
      return [c.contract_id, 'skip'];
    }
  });

  const snapshot = {
    couriers,
    sells,
    lastModifiedAt,
    contents,
  };

  const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = fileURLToPath(new URL('./fixtures/contracts-snapshot.json', import.meta.url));
  const json = JSON.stringify(snapshot, null, 2);
  writeFileSync(file, json);

  console.log(
    `Saved contracts snapshot: ${couriers.length} couriers, ${sells.length} sells, ${contents.length} package contents → ${file}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});
