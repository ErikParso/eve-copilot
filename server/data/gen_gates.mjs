import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const strip = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

// Pass 1: gate itemID -> solarSystemID (groupID 10 = Stargate)
const gateSystem = new Map();
{
  const rl = createInterface({ input: createReadStream('mapDenormalize.csv'), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    // cols 0..3 are numeric (itemID,typeID,groupID,solarSystemID) — safe naive split
    const c = line.split(',');
    if (strip(c[2]) !== '10') continue;
    gateSystem.set(Number(strip(c[0])), Number(strip(c[3])));
  }
}

// Pass 2: mapJumps stargateID -> destinationID, join to build gate -> [sys, dest]
const triples = [];
{
  const rl = createInterface({ input: createReadStream('mapJumps.csv'), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const c = line.split(',');
    const gate = Number(strip(c[0]));
    const destGate = Number(strip(c[1]));
    const sys = gateSystem.get(gate);
    const dest = gateSystem.get(destGate);
    if (sys === undefined || dest === undefined) continue;
    triples.push([gate, sys, dest]);
  }
}

triples.sort((a, b) => a[0] - b[0]);
writeFileSync('gates.json', JSON.stringify(triples));
console.log('gates:', triples.length, 'gateSystem entries:', gateSystem.size);
// sanity: show a few
console.log('sample:', JSON.stringify(triples.slice(0, 3)));
// coverage sanity: how many distinct systems appear as a source
console.log('distinct source systems:', new Set(triples.map((t) => t[1])).size);
