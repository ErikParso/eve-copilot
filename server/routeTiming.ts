// Offline: how long do the cold route resolves actually take? Resolves every
// distinct delivery leg (src→dst system) and approach leg (origin→src) for the
// floored ~40k candidate set against the fixture, using the real routing graph,
// timing cold (cache miss) vs warm (cache hit). Tells us if the full version's
// route pre-warm is affordable.  npm run route-time
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadSde } from './sde.js';
import { loadSnapshot, getSnapshot, type SerializedSnapshot } from './market.js';
import { resolveOpportunities } from './arbitrage.js';
import { getRoute, type RouteType } from './routing.js';

const JITA = 30000142; // sample origin
const FLOOR = Number(process.env.FLOOR ?? 100_000); // profit floor to test (ISK)

async function main() {
  console.log('Loading SDE…');
  await loadSde();
  const fixture = fileURLToPath(new URL('./fixtures/market-snapshot.json', import.meta.url));
  console.log(`Loading fixture: ${fixture}`);
  loadSnapshot(JSON.parse(readFileSync(fixture, 'utf8')) as SerializedSnapshot);
  const byType = getSnapshot()!.byType;

  const opps = resolveOpportunities(byType, { maxPairs: Infinity, maxTotal: Infinity, minProfit: FLOOR }); // uncapped
  const deliv = new Map<string, [number, number]>();
  const srcSet = new Set<number>();
  for (const o of opps) {
    const s = o.source.systemId;
    const d = o.dest.systemId;
    if (s === null || d === null) continue;
    deliv.set(`${s}-${d}`, [s, d]);
    srcSet.add(s);
  }
  const delivLegs = [...deliv.values()];
  const srcSystems = [...srcSet];
  console.log(`\nfloor ${FLOOR.toLocaleString()} ISK → ${opps.length.toLocaleString()} pairs → ${delivLegs.length.toLocaleString()} distinct delivery legs, ${srcSystems.length.toLocaleString()} approach legs (from Jita)\n`);

  for (const type of ['shortest', 'safest'] as RouteType[]) {
    // Cold = first resolve (cache miss). Warm = second pass (cache hit).
    let t = performance.now();
    for (const [s, d] of delivLegs) getRoute(s, d, type);
    const delivCold = performance.now() - t;
    t = performance.now();
    for (const [s, d] of delivLegs) getRoute(s, d, type);
    const delivWarm = performance.now() - t;

    t = performance.now();
    for (const s of srcSystems) getRoute(JITA, s, type);
    const apprCold = performance.now() - t;
    t = performance.now();
    for (const s of srcSystems) getRoute(JITA, s, type);
    const apprWarm = performance.now() - t;

    console.log(`route type: ${type}`);
    console.log(`  delivery legs  cold ${delivCold.toFixed(0)}ms (${(delivCold / delivLegs.length).toFixed(2)}ms ea)  warm ${delivWarm.toFixed(0)}ms`);
    console.log(`  approach legs  cold ${apprCold.toFixed(0)}ms (${(apprCold / srcSystems.length).toFixed(2)}ms ea)  warm ${apprWarm.toFixed(0)}ms`);
    console.log(`  → total cold (1 origin): ${((delivCold + apprCold) / 1000).toFixed(1)}s\n`);
  }

  console.log('Delivery cold = background pre-warm cost per 20-min snapshot (shared, off request path).');
  console.log('Approach cold = per-origin, paid once on first request after a jump, then cached.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
