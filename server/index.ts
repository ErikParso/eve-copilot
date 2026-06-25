import express from 'express';
import cors from 'cors';
import { loadSde } from './sde.js';
import { startContractsRefresh } from './contracts.js';
import { startMarketScheduler, onMarketRefresh, getMarketFreshness } from './market.js';
import { startPricesRefresh } from './prices.js';
import { resolvePinnedHaulsStatus, resolveSellDestinations, prewarmDeliveryRoutes } from './arbitrage.js';
import { getEnrichedHauling } from './hauling.js';
import type { AttractivityWeights } from './arbitrageScore.js';
import { getRoute, type RouteType } from './routing.js';
import { toRouteSystems } from './enrich.js';
import { getShipKills } from './kills.js';
import type { PinnedHaulStatusRequest } from './types.js';

// Last-resort backstop: a stray rejected promise or thrown error in any
// background crawl must never take the whole server down (a transient ESI 504
// once did exactly that). Log it and keep serving the cached data.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection (ignored, server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception (ignored, server stays up):', err);
});

const PORT = Number(process.env.PORT ?? 4000);
const DEFAULT_SHIP_LIMIT = 48; // how many top-attractivity hauls to ship (the FE shows them all, no paging)

function parseRouteType(value: unknown): RouteType {
  return value === 'shortest' ? 'shortest' : 'safest';
}

/** Optional finite number query param, else null. */
function parseOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A cargo/wallet ceiling: absent or negative ⇒ unconstrained (Infinity). */
function parseCeiling(value: unknown): number {
  const n = parseOptionalNumber(value);
  return n === null || n < 0 ? Infinity : n;
}

/** A non-negative attractivity weight, defaulting to `fallback`. */
function parseWeight(value: unknown, fallback: number): number {
  const n = parseOptionalNumber(value);
  return n === null ? fallback : Math.max(0, n);
}


function parseNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(Number).filter(Number.isFinite);
  return out.length ? out : undefined;
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
    const unitVolume = e.unitVolume !== undefined ? Number(e.unitVolume) : undefined;

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
      unitVolume: unitVolume !== undefined && Number.isFinite(unitVolume) ? unitVolume : undefined,
      // Echoed back from the previous response so the server can flag `stale`
      // (the specific orders backing the haul changed). Without these the stale
      // check is inert.
      knownSourceOrderIds: parseNumberArray(e.knownSourceOrderIds),
      knownDestOrderIds: parseNumberArray(e.knownDestOrderIds),
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

  // After each (throttled) index rebuild, re-resolve opportunities and pre-warm
  // delivery-leg routes in the background — off the request path — so requests
  // never pay the cold graph searches synchronously. prewarmDeliveryRoutes()
  // calls getOpportunities() internally, so this is also the resolve trigger.
  onMarketRefresh(() => {
    void prewarmDeliveryRoutes();
  });
  void startMarketScheduler().catch((err) => console.error('Market scheduler failed to start', err));
  console.log('Started incremental market crawler (sequential worker) + background resolve/route pre-warm.');

  startPricesRefresh();
  console.log('Started reference-price refresh (refreshing every 60 min).');

  // Periodic health heartbeat every 2 minutes: memory + a one-line market summary
  // (status, coverage, order count, and how stale the stalest region is) so a
  // single log line tells you whether the crawler is healthy.
  setInterval(() => {
    const mem = process.memoryUsage();
    const rss = Math.round(mem.rss / 1024 / 1024);
    const heapUsed = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(mem.heapTotal / 1024 / 1024);
    const f = getMarketFreshness();
    const ages = f.regions.filter((r) => r.status === 'loaded' && r.ageSeconds !== null).map((r) => r.ageSeconds!);
    const stalest = ages.length ? Math.max(...ages) : 0;
    console.log(
      `[Heartbeat] RSS ${rss}MB | heap ${heapUsed}/${heapTotal}MB | market ${f.status}: ` +
        `${f.regionsLoaded} regions, ${f.orderCount.toLocaleString()} orders, stalest ${Math.round(stalest / 60)}m old`,
    );
  }, 2 * 60 * 1000).unref();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Per-region market-data freshness, for the UI panel. Cheap — poll every few sec.
  app.get('/api/market/freshness', (_req, res) => {
    res.json(getMarketFreshness());
  });


  // Combined hauling menu: courier + arbitrage scored together server-side,
  // truncated to the top-N by attractivity, shipped with the score attached.
  // One combined call: fresh opportunities AND a revalidation of the caller's
  // pinned hauls, both resolved against the SAME market snapshot. POST so the
  // pinned set (which lives client-side) can ride in the body; search params
  // stay on the query string. Pins are validated only on this reload cadence —
  // there is no separate per-pin check — so a freshly pinned item stays as-is
  // until the next reload instead of being re-priced the instant it's added.
  app.post('/api/hauling', async (req, res) => {
    try {
      const weights: AttractivityWeights = {
        income: parseWeight(req.query.wIncome, 5),
        totalJumps: parseWeight(req.query.wJumps, 5),
        danger: parseWeight(req.query.wDanger, 5),
      };
      const capacity = parseCeiling(req.query.capacity);
      const balance = parseCeiling(req.query.balance);
      const taxPct = parseOptionalNumber(req.query.taxPct) ?? 4.5;
      const result = await getEnrichedHauling({
        routeType: parseRouteType(req.query.routeType),
        origin: parseOptionalNumber(req.query.origin),
        capacity,
        balance,
        taxPct,
        weights,
        limit: parseOptionalNumber(req.query.limit) ?? DEFAULT_SHIP_LIMIT,
      });
      // Pins are re-optimized against the SAME cargo/wallet/tax as the grid, so a
      // pinned planning haul reflects exactly what the matching opportunity would.
      const pinnedStatuses = resolvePinnedHaulsStatus(parsePinnedHaulsRequest(req.body?.hauls), {
        capacity,
        balance,
        taxFraction: taxPct / 100,
      });
      res.json({ ...result, pinnedStatuses });
    } catch (err) {
      console.error('POST /api/hauling failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  // Where can I sell the cargo I'm carrying right now? Liquidation search for one
  // item, ranked by the same attractivity weights as the hauling list, routed from
  // the caller's current system. On-demand (a transit card's "Sell elsewhere").
  app.post('/api/arbitrage/sell-destinations', async (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const typeId = Number(b.typeId);
      const quantity = Number(b.quantity);
      const boughtPrice = Number(b.boughtPrice);
      const origin = Number(b.origin);
      if (![typeId, quantity, boughtPrice, origin].every(Number.isFinite) || quantity <= 0) {
        return res.status(400).json({ error: 'typeId, quantity, boughtPrice and origin are required' });
      }
      const w = (b.weights ?? {}) as Record<string, unknown>;
      const weights: AttractivityWeights = {
        income: parseWeight(w.income, 5),
        totalJumps: parseWeight(w.totalJumps, 5),
        danger: parseWeight(w.danger, 5),
      };
      const kills = await getShipKills();
      const items = resolveSellDestinations(
        {
          typeId,
          quantity,
          boughtPrice,
          origin,
          routeType: parseRouteType(b.routeType),
          taxPct: parseOptionalNumber(b.taxPct) ?? 4.5,
          weights,
        },
        kills,
      );
      res.json({ items });
    } catch (err) {
      console.error('POST /api/arbitrage/sell-destinations failed', err);
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
