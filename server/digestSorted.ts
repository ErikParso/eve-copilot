// Isolation check: resolve the fixture through a VERBOSE store that applies the
// exact same sort (price, ties by id; stations by best, ties by station) the
// columnar store uses. If this digest matches the columnar digest byte-for-byte,
// the columnar refactor is proven result-identical to the verbose representation
// (any diff vs the original baseline is then purely the deterministic tiebreak).
//   npx tsx digestSorted.ts fixtures/opps-sorted.txt
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { type SerializedSnapshot, type TypeBook, type StationOrders, type MarketStore } from './market.js';
import { resolveOpportunities } from './arbitrage.js';

async function main() {
  const outArg = process.argv[2] ?? 'fixtures/opps-sorted.txt';
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  const data = JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot;

  const sortSide = (side: StationOrders[], asc: boolean): StationOrders[] => {
    const stations = side.map((so) => {
      const orders = [...so.orders].sort((a, b) => (asc ? a.price - b.price : b.price - a.price) || a.id - b.id);
      return { station: so.station, system: so.system, best: orders[0].price, orders };
    });
    stations.sort((a, b) => (asc ? a.best - b.best : b.best - a.best) || a.station - b.station);
    return stations;
  };
  const map = new Map<number, TypeBook>();
  let orderCount = 0;
  for (const [t, tb] of data.byType) {
    const book = { sells: sortSide(tb.sells, true), buys: sortSide(tb.buys, false) };
    for (const s of book.sells) orderCount += s.orders.length;
    for (const s of book.buys) orderCount += s.orders.length;
    map.set(t, book);
  }
  const store: MarketStore = {
    size: map.size,
    orderCount,
    typeIds: () => map.keys(),
    hydrateType: (id) => map.get(id),
    hydrateAll: () => map,
  };

  const opps = resolveOpportunities(store, { maxPairs: Infinity, maxTotal: Infinity });
  const lines = opps
    .map(
      (o) =>
        `${o.id}|q=${o.quantity}|prof=${o.profit.toFixed(2)}|bc=${o.buyCost.toFixed(2)}` +
        `|bp=${o.buyPrice.toFixed(4)}|sp=${o.sellPrice.toFixed(4)}` +
        `|src=${o.source.systemId}|dst=${o.dest.systemId}|rungs=${o.ladder.length}`,
    )
    .sort();
  const out = fileURLToPath(new URL(`./${outArg}`, import.meta.url));
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`Wrote ${lines.length.toLocaleString()} opportunities → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
