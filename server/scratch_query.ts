import { loadSde } from './sde.js';
import { loadSnapshot } from './market.js';
import { prewarmDeliveryRoutes } from './arbitrage.js';
import { getEnrichedHauling } from './hauling.js';
import fs from 'fs';
import { fileURLToPath } from 'url';

async function test() {
  console.log('Loading SDE...');
  await loadSde();
  
  console.log('Loading Snapshot...');
  const fixturePath = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  const raw = fs.readFileSync(fixturePath, 'utf8');
  loadSnapshot(JSON.parse(raw));
  console.log('Prewarming...');
  await prewarmDeliveryRoutes();

  console.log('Querying getEnrichedHauling...');
  const res = await getEnrichedHauling({
    routeType: 'safest',
    origin: 30000142, // Jita
    capacity: Infinity,
    balance: Infinity,
    taxPct: 4.5,
    weights: { income: 5, totalJumps: 5, danger: 5 },
    kinds: [],
    limit: 50
  });

  console.log(`Enriched hauling items returned: ${res.items.length}`);
  console.log('Sample items:', JSON.stringify(res.items.slice(0, 3), null, 2));
}

test().catch(console.error);
