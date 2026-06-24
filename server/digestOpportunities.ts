// Result-identity harness for the columnar refactor. Loads the fixture, resolves
// the full opportunity set, and writes a canonical one-line-per-opportunity
// digest. Run on the OLD code → baseline, on the NEW code → candidate, then diff:
//   npx tsx digestOpportunities.ts fixtures/opps-baseline.txt
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities } from './arbitrage.js';

async function main() {
  const outArg = process.argv[2] ?? 'fixtures/opps-digest.txt';
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  loadSnapshot(JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot);
  const byType = getSnapshot()!.byType;

  const opps = resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity });
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
