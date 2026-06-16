import express from 'express';
import { loadSde } from './sde.js';
import { getEnrichedContracts, startContractsRefresh } from './contracts.js';
import { startMarketRefresh } from './market.js';
import { getEnrichedArbitrage } from './arbitrage.js';
import type { RouteType } from './routing.js';

const PORT = Number(process.env.PORT ?? 4000);

function parseRouteType(value: unknown): RouteType {
  return value === 'shortest' ? 'shortest' : 'safest';
}

/** Optional positive number query param, else null. */
function parseOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log('Loading SDE (stations, systems, jump graph)…');
  const meta = await loadSde();
  console.log(
    `SDE loaded: ${meta.stations} stations, ${meta.systems} systems, ${meta.jumps} systems with jumps, ${meta.types} market types.`,
  );

  startContractsRefresh();
  console.log('Started contracts crawl (refreshing every 10 min).');

  startMarketRefresh();
  console.log('Started market crawl (refreshing every 10 min).');

  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/contracts', async (req, res) => {
    try {
      const type = parseRouteType(req.query.routeType);
      const origin = parseOptionalNumber(req.query.origin);
      const result = await getEnrichedContracts(type, origin);
      res.json(result);
    } catch (err) {
      console.error('GET /api/contracts failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  app.get('/api/arbitrage', async (req, res) => {
    try {
      const type = parseRouteType(req.query.routeType);
      const origin = parseOptionalNumber(req.query.origin);
      const result = await getEnrichedArbitrage(type, origin);
      res.json(result);
    } catch (err) {
      console.error('GET /api/arbitrage failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
