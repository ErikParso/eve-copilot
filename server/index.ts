import express from 'express';
import cors from 'cors';
import { loadSde } from './sde.js';
import { startContractsRefresh } from './contracts.js';
import { startPackagesService, resolvePinnedPackagesStatus, resolvePackageSellDestinations, getPackagesFreshness } from './packages.js';
import { startMarketScheduler, onMarketRefresh, getMarketFreshness } from './market.js';
import { startPricesRefresh } from './prices.js';
import { resolvePinnedHaulsStatus, resolveSellDestinations, prewarmDeliveryRoutes } from './arbitrage.js';
import { getEnrichedHauling, type HaulingKind } from './hauling.js';
import type { AttractivityWeights } from './arbitrageScore.js';
import { getRoute, type RouteType } from './routing.js';
import { toRouteSystems } from './enrich.js';
import { getGateKills, setTestKills, clearTestKills, startGateKillFeed, getGateKillReport } from './gateKills.js';
import type { PinnedHaulStatusRequest, PinnedPackageStatusRequest, PackageStatusLine } from './types.js';

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

/** Opportunity-kind filter (comma-separated); empty/absent ⇒ no filter (all kinds). */
function parseHaulingKinds(value: unknown): HaulingKind[] {
  if (typeof value !== 'string') return [];
  const valid: HaulingKind[] = ['courier', 'arbitrage', 'package'];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is HaulingKind => (valid as string[]).includes(s));
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
    const originalProfit = e.originalProfit !== undefined ? Number(e.originalProfit) : undefined;
    const originalQuantity = e.originalQuantity !== undefined ? Number(e.originalQuantity) : undefined;
    const originalBuyPrice = e.originalBuyPrice !== undefined ? Number(e.originalBuyPrice) : undefined;

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
      originalProfit: originalProfit !== undefined && Number.isFinite(originalProfit) ? originalProfit : undefined,
      originalQuantity: originalQuantity !== undefined && Number.isFinite(originalQuantity) ? originalQuantity : undefined,
      originalBuyPrice: originalBuyPrice !== undefined && Number.isFinite(originalBuyPrice) ? originalBuyPrice : undefined,
      // Echoed back from the previous response so the server can flag `stale`
      // (the specific orders backing the haul changed). Without these the stale
      // check is inert.
      knownSourceOrderIds: parseNumberArray(e.knownSourceOrderIds),
      knownDestOrderIds: parseNumberArray(e.knownDestOrderIds),
    });
  }
  return out;
}

/** Body numbers arrive as JSON numbers (not strings), so parseOptionalNumber —
 *  which only accepts strings — would wrongly null them. */
function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePackageStatusLines(value: unknown): PackageStatusLine[] {
  if (!Array.isArray(value)) return [];
  const out: PackageStatusLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const typeId = Number(e.typeId);
    const quantity = Number(e.quantity);
    if (!Number.isFinite(typeId) || !Number.isFinite(quantity)) continue;
    const hauledQuantity = e.hauledQuantity !== undefined && Number.isFinite(Number(e.hauledQuantity)) ? Number(e.hauledQuantity) : undefined;
    out.push({ typeId, quantity, isBlueprintCopy: e.isBlueprintCopy === true, hauledQuantity });
  }
  return out;
}

function parsePinnedPackagesRequest(value: unknown): PinnedPackageStatusRequest[] {
  if (!Array.isArray(value)) return [];
  const out: PinnedPackageStatusRequest[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = e.id;
    const contractId = Number(e.contractId);
    const price = Number(e.price);
    const dest = Number(e.dest);
    const status = e.status;
    if (typeof id !== 'string') continue;
    if (![contractId, price, dest].every(Number.isFinite)) continue;
    if (status !== 'planning' && status !== 'transit') continue;
    const lines = parsePackageStatusLines(e.lines);
    if (lines.length === 0) continue;
    out.push({
      id,
      contractId,
      status: status as 'planning' | 'transit',
      price,
      lines,
      sourceSystem: numberOrNull(e.sourceSystem),
      dest,
      destSystem: numberOrNull(e.destSystem),
      originalProfit: e.originalProfit !== undefined && Number.isFinite(Number(e.originalProfit)) ? Number(e.originalProfit) : undefined,
    });
  }
  return out;
}

async function main() {
  console.log('Loading SDE (stations, systems, jump graph)…');
  const meta = await loadSde();
  console.log(
    `SDE loaded: ${meta.stations} stations, ${meta.systems} systems, ${meta.jumps} systems with jumps, ${meta.types} market types, ${meta.gates} stargates.`,
  );

  // Start the RedisQ gate-kill firehose (forward-only; the 60-min window warms up
  // over the first hour). No-op under OFFLINE, where tests inject kills directly.
  startGateKillFeed();

  if (process.env.OFFLINE === 'true') {
    console.log('OFFLINE mode enabled: loading market-snapshot.json fixture...');
    const fs = await import('fs');
    const fileURLToPath = (await import('url')).fileURLToPath;
    const fixturePath = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const { loadSnapshot } = await import('./market.js');
    loadSnapshot(JSON.parse(raw));
    console.log('Offline snapshot loaded successfully.');

    // Load contracts-snapshot.json if present
    const contractsFixturePath = fileURLToPath(new URL('./fixtures/contracts-snapshot.json', import.meta.url));
    if (fs.existsSync(contractsFixturePath)) {
      console.log('Loading contracts-snapshot.json fixture...');
      const contractsRaw = fs.readFileSync(contractsFixturePath, 'utf8');
      const parsedContracts = JSON.parse(contractsRaw);
      const { loadContractsSnapshot } = await import('./contracts.js');
      loadContractsSnapshot(parsedContracts);

      const { loadPackagesSnapshot } = await import('./packages.js');
      loadPackagesSnapshot(parsedContracts.contents);
      console.log('Offline contracts snapshot loaded successfully.');
    } else {
      console.log('No contracts-snapshot.json fixture found, starting with empty contracts.');
    }
    
    // Also run initial route pre-warm on offline load
    const { prewarmDeliveryRoutes } = await import('./arbitrage.js');
    void prewarmDeliveryRoutes();
  } else {
    startContractsRefresh();
    console.log('Started contracts crawl (refreshing every 10 min).');

    // Sell-contract (package) service: reconciles its contract set on every
    // contracts crawl and fetches each contract's contents once in the background
    // (hub regions first), through the shared ESI rate limiter.
    startPackagesService();
    console.log('Started sell-contract (package) service.');

    // After each (throttled) index rebuild, re-resolve opportunities and pre-warm
    // delivery-leg routes in the background — off the request path — so requests
    // never pay the cold graph searches synchronously. prewarmDeliveryRoutes()
    // calls getOpportunities() internally, so this is also the resolve trigger.
    onMarketRefresh(() => {
      void prewarmDeliveryRoutes();
    });
    void startMarketScheduler().catch((err) => console.error('Market scheduler failed to start', err));
    console.log('Started incremental market crawler (sequential worker) + background resolve/route pre-warm.');
  }

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

  // Test mutation route for E2E browser tests
  app.post('/api/test/mutate-market', async (req, res) => {
    try {
      const { typeId, action, stationId, price, quantity, orderIds } = req.body;
      const { getSnapshot, loadSnapshot } = await import('./market.js');
      const snap = getSnapshot();

      if (action === 'reset') {
        const fs = await import('fs');
        const fileURLToPath = (await import('url')).fileURLToPath;
        const fixturePath = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
        const raw = fs.readFileSync(fixturePath, 'utf8');
        loadSnapshot(JSON.parse(raw));
        
        const { prewarmDeliveryRoutes } = await import('./arbitrage.js');
        await prewarmDeliveryRoutes();
        
        return res.json({ ok: true });
      }

      if (!snap) {
        return res.status(400).json({ error: 'No live snapshot to mutate' });
      }

      const newByType = new Map(snap.byType);
      const book = newByType.get(typeId);
      if (!book) {
        return res.status(404).json({ error: `Type ${typeId} not found in snapshot` });
      }

      // Clone book structure
      const newBook = {
        ...book,
        sells: book.sells.map(s => ({ ...s, orders: s.orders.map(o => ({ ...o })) })),
        buys: book.buys.map(b => ({ ...b, orders: b.orders.map(o => ({ ...o })) })),
      };

      if (action === 'change_sell_price') {
        const sellSide = newBook.sells.find(s => s.station === stationId);
        if (sellSide) {
          sellSide.orders.forEach(o => {
            o.price = price;
          });
        }
      } else if (action === 'reduce_sell_volume') {
        const sellSide = newBook.sells.find(s => s.station === stationId);
        if (sellSide) {
          sellSide.orders.forEach(o => {
            o.volume = Math.min(o.volume, quantity);
          });
        }
      } else if (action === 'remove_sells') {
        newBook.sells = newBook.sells.filter(s => s.station !== stationId);
      } else if (action === 'change_buy_price') {
        const buySide = newBook.buys.find(b => b.station === stationId);
        if (buySide) {
          buySide.orders.forEach(o => {
            o.price = price;
          });
        }
      } else if (action === 'reduce_buy_volume') {
        const buySide = newBook.buys.find(b => b.station === stationId);
        if (buySide) {
          buySide.orders.forEach(o => {
            o.volume = Math.min(o.volume, quantity);
          });
        }
      } else if (action === 'remove_buys') {
        newBook.buys = newBook.buys.filter(b => b.station !== stationId);
      } else if (action === 'change_order_ids') {
        const sellSide = newBook.sells.find(s => s.station === stationId);
        if (sellSide) {
          sellSide.orders.forEach((o, i) => {
            o.id = (orderIds && orderIds[i]) ?? (o.id + 1000000);
          });
        }
        const buySide = newBook.buys.find(b => b.station === stationId);
        if (buySide) {
          buySide.orders.forEach((o, i) => {
            o.id = (orderIds && orderIds[i]) ?? (o.id + 1000000);
          });
        }
      }

      newByType.set(typeId, newBook);
      loadSnapshot({
        builtAt: snap.builtAt,
        lastModifiedAt: snap.lastModifiedAt,
        orderCount: snap.orderCount,
        regions: snap.regions,
        byType: [...newByType.entries()],
      });

      const { prewarmDeliveryRoutes } = await import('./arbitrage.js');
      await prewarmDeliveryRoutes();

      res.json({ ok: true });
    } catch (err) {
      console.error('Market mutation failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Mutation error' });
    }
  });

  // Test kills injection route for E2E browser tests (danger testing)
  app.post('/api/test/mutate-kills', (req, res) => {
    try {
      const { action, kills: killsData } = req.body;
      if (action === 'reset') {
        clearTestKills();
        return res.json({ ok: true });
      }
      if (action === 'set' && killsData && typeof killsData === 'object') {
        const killsMap = new Map<number, number>();
        for (const [systemId, count] of Object.entries(killsData)) {
          killsMap.set(Number(systemId), Number(count));
        }
        setTestKills(killsMap);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Invalid action. Use "set" with kills data or "reset".' });
    } catch (err) {
      console.error('Kills mutation failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Mutation error' });
    }
  });

  // Test packages injection route for E2E browser tests
  app.post('/api/test/mutate-packages', async (req, res) => {
    try {
      const { action, contracts } = req.body;
      if (action === 'reset') {
        const fs = await import('fs');
        const fileURLToPath = (await import('url')).fileURLToPath;
        const contractsFixturePath = fileURLToPath(new URL('./fixtures/contracts-snapshot.json', import.meta.url));
        if (fs.existsSync(contractsFixturePath)) {
          const contractsRaw = fs.readFileSync(contractsFixturePath, 'utf8');
          const parsedContracts = JSON.parse(contractsRaw);
          const { loadContractsSnapshot } = await import('./contracts.js');
          loadContractsSnapshot(parsedContracts);
          const { loadPackagesSnapshot } = await import('./packages.js');
          loadPackagesSnapshot(parsedContracts.contents);
        } else {
          const { __seedTestPackages } = await import('./packages.js');
          __seedTestPackages([]);
        }
        return res.json({ ok: true });
      }
      if (action === 'set' && Array.isArray(contracts)) {
        const { __seedTestPackages } = await import('./packages.js');
        __seedTestPackages(contracts);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Invalid action. Use "set" with contracts data or "reset".' });
    } catch (err) {
      console.error('Packages mutation failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Mutation error' });
    }
  });

  // Per-region market-data freshness, for the UI panel. Cheap — poll every few sec.
  app.get('/api/market/freshness', (_req, res) => {
    res.json(getMarketFreshness());
  });

  // Sell-contract (package) processing stats, for the Market Data tab's bundle
  // panel. Cheap — poll every few sec.
  app.get('/api/packages/freshness', (_req, res) => {
    res.json(getPackagesFreshness());
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
        valueAtRisk: parseWeight(req.query.wValueAtRisk, 5),
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
        kinds: parseHaulingKinds(req.query.types),
        limit: parseOptionalNumber(req.query.limit) ?? DEFAULT_SHIP_LIMIT,
      });
      // Pins are re-optimized against the SAME cargo/wallet/tax as the grid, so a
      // pinned planning haul reflects exactly what the matching opportunity would.
      const origin = parseOptionalNumber(req.query.origin);
      const routeType = parseRouteType(req.query.routeType);
      const kills = await getGateKills();
      const pinnedStatuses = resolvePinnedHaulsStatus(parsePinnedHaulsRequest(req.body?.hauls), {
        capacity,
        balance,
        taxFraction: taxPct / 100,
        origin,
        routeType,
        kills,
      });
      // Pinned packages revalidated against the SAME snapshot as the opportunities.
      const pinnedPackageStatuses = resolvePinnedPackagesStatus(parsePinnedPackagesRequest(req.body?.packages), {
        taxFraction: taxPct / 100,
        capacity,
        origin,
        routeType,
        kills,
      });
      res.json({ ...result, pinnedStatuses, pinnedPackageStatuses });
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
        valueAtRisk: parseWeight(w.valueAtRisk, 5),
      };
      const kills = await getGateKills();
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

  // Where can I sell the package I'm carrying? Multi-type liquidation search,
  // ranked by the same attractivity weights as the hauling list, routed from the
  // caller's current system. On-demand (a transit package card's "Sell elsewhere").
  app.post('/api/packages/sell-destinations', async (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const origin = Number(b.origin);
      const price = Number(b.price);
      const lines = parsePackageStatusLines(b.lines);
      if (!Number.isFinite(origin) || !Number.isFinite(price) || lines.length === 0) {
        return res.status(400).json({ error: 'origin, price and lines are required' });
      }
      const w = (b.weights ?? {}) as Record<string, unknown>;
      const weights = {
        income: parseWeight(w.income, 5),
        totalJumps: parseWeight(w.totalJumps, 5),
        danger: parseWeight(w.danger, 5),
        valueAtRisk: parseWeight(w.valueAtRisk, 5),
      };
      const kills = await getGateKills();
      const items = resolvePackageSellDestinations(
        { lines, price, origin, routeType: parseRouteType(b.routeType), taxPct: parseOptionalNumber(b.taxPct) ?? 4.5, weights },
        kills,
      );
      res.json({ items });
    } catch (err) {
      console.error('POST /api/packages/sell-destinations failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  // Kill Data page: systems with recent stargate kills (last 60 min, warming up
  // over the first hour after boot), each with its per-gate breakdown.
  app.get('/api/kills/gates', (_req, res) => {
    try {
      res.json(getGateKillReport());
    } catch (err) {
      console.error('GET /api/kills/gates failed', err);
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
      const kills = await getGateKills();
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
