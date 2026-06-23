import express from 'express';
import { loadSde } from './sde.js';
import { getEnrichedContracts, startContractsRefresh } from './contracts.js';
import { startMarketRefresh } from './market.js';
import { startPricesRefresh } from './prices.js';
import { getEnrichedArbitrage, resolvePinnedHaulsStatus } from './arbitrage.js';
import { getRoute, type RouteType } from './routing.js';
import { toRouteSystems } from './enrich.js';
import { getShipKills } from './kills.js';
import type { PinnedHaulStatusRequest } from './types.js';

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


function parsePinnedHaulsRequest(value: unknown): PinnedHaulStatusRequest[] {
  if (!Array.isArray(value)) return [];
  const out: PinnedHaulStatusRequest[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = e.id;
    const typeId = Number(e.typeId);
    const source = Number(e.source);
    const dest = Number(e.dest);
    const quantity = Number(e.quantity);
    const status = e.status;
    const boughtPrice = e.boughtPrice !== undefined ? Number(e.boughtPrice) : undefined;
    
    if (typeof id !== 'string') continue;
    if (![typeId, source, dest, quantity].every(Number.isFinite)) continue;
    if (status !== 'planning' && status !== 'transit') continue;
    if (boughtPrice !== undefined && !Number.isFinite(boughtPrice)) continue;
    
    out.push({
      id,
      typeId,
      source,
      dest,
      quantity,
      status: status as 'planning' | 'transit',
      boughtPrice,
    });
  }
  return out;
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

  startPricesRefresh();
  console.log('Started reference-price refresh (refreshing every 60 min).');

  const app = express();
  app.use(express.json());

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

  app.post('/api/arbitrage/status', (req, res) => {
    try {
      const requests = parsePinnedHaulsRequest(req.body?.hauls);
      const statuses = resolvePinnedHaulsStatus(requests);
      res.json({ statuses });
    } catch (err) {
      console.error('POST /api/arbitrage/status failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  app.get('/api/route', async (req, res) => {
    try {
      const origin = parseOptionalNumber(req.query.origin);
      const dest = parseOptionalNumber(req.query.dest);
      const type = parseRouteType(req.query.routeType);
      if (origin === null || dest === null) {
        return res.status(400).json({ error: 'origin and dest are required' });
      }
      const routeIds = getRoute(origin, dest, type);
      if (!routeIds) {
        return res.json({ route: null, jumps: null });
      }
      const kills = await getShipKills();
      const route = toRouteSystems(routeIds, kills);
      const jumps = Math.max(0, routeIds.length - 1);
      res.json({ route, jumps });
    } catch (err) {
      console.error('GET /api/route failed', err);
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
