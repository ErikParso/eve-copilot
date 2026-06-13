// One-off generator: trims fuzzwork SDE CSV dumps into small JSON bundles
// used by the app (NPC stations for the autocomplete + solar systems for
// names, security status and route endpoints).
//
// Usage: node scripts/generate-sde.mjs <staStations.csv> <mapSolarSystems.csv>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'src', 'data');

/** Minimal RFC-4180-ish CSV parser (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function loadCsv(path) {
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { rows: rows.slice(1).filter((r) => r.length > 1), idx };
}

const [staPath, sysPath] = process.argv.slice(2);
if (!staPath || !sysPath) {
  console.error('Usage: node scripts/generate-sde.mjs <staStations.csv> <mapSolarSystems.csv>');
  process.exit(1);
}

// --- Solar systems -> { [systemId]: [name, security] } -------------------
const sys = loadCsv(sysPath);
const systems = {};
for (const r of sys.rows) {
  const id = Number(r[sys.idx.solarSystemID]);
  const name = r[sys.idx.solarSystemName];
  const security = Math.round(Number(r[sys.idx.security]) * 100) / 100;
  systems[id] = [name, security];
}

// --- NPC stations -> [{ id, name, systemId }] ----------------------------
const sta = loadCsv(staPath);
const stations = sta.rows.map((r) => ({
  id: Number(r[sta.idx.stationID]),
  name: r[sta.idx.stationName],
  systemId: Number(r[sta.idx.solarSystemID]),
}));
stations.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'systems.json'), JSON.stringify(systems));
writeFileSync(resolve(outDir, 'stations.json'), JSON.stringify(stations));

console.log(`Wrote ${Object.keys(systems).length} systems and ${stations.length} stations.`);
