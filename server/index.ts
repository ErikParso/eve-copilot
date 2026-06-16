import express from 'express';
import { loadSde } from './sde.js';
import { getEnrichedContracts, startContractsRefresh } from './contracts.js';
import { startMarketRefresh } from './market.js';
import { startPricesRefresh } from './prices.js';
import { getEnrichedArbitrage } from './arbitrage.js';
import { getRoute, type RouteType } from './routing.js';
import { toRouteSystems } from './enrich.js';
import { getShipKills } from './kills.js';

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

/** Parse + validate the `pairs` body of /api/routes into [origin, dest] tuples. */
function parsePairs(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const out: Array<[number, number]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const a = Number(entry[0]);
    const b = Number(entry[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
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

  // Batch route-matrix for the Copilot planner: pathfinding lives only here (the
  // SDE jump graph is server-side), so the client asks for routes between the
  // arbitrary stop pairs of a multi-stop plan. Reuses getRoute's process cache,
  // so repeated pairs across re-plans are free.
  app.post('/api/routes', async (req, res) => {
    try {
      const type = parseRouteType(req.body?.routeType);
      const pairs = parsePairs(req.body?.pairs);
      const kills = await getShipKills();
      const routes: Record<string, ReturnType<typeof toRouteSystems> | null> = {};
      for (const [origin, dest] of pairs) {
        const key = `${origin}:${dest}`;
        if (key in routes) continue;
        const ids = getRoute(origin, dest, type);
        routes[key] = ids === null ? null : toRouteSystems(ids, kills);
      }
      res.json({ routes });
    } catch (err) {
      console.error('POST /api/routes failed', err);
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
