// Server-side EVE Static Data Export: NPC stations, solar systems, and the
// stargate jump graph (for local routing). Loaded once from the Fuzzwork CSV
// mirror at startup.
import { parseCsv } from './csv.js';

const BASE = 'https://www.fuzzwork.co.uk/dump/latest/csv';

export type SecurityBand = 'high' | 'low' | 'null';

export interface Station {
  id: number;
  name: string;
  systemId: number;
}
export interface SolarSystem {
  id: number;
  name: string;
  security: number;
}
export interface ItemType {
  id: number;
  name: string;
  /** Volume in m³ (unpackaged). Used to cap haul quantity by cargo. */
  volume: number;
}

const stationById = new Map<number, Station>();
const systemById = new Map<number, SolarSystem>();
const typeById = new Map<number, ItemType>();
/** systemId -> neighbouring systemIds (via stargates). */
const adjacency = new Map<number, number[]>();

export function securityBand(security: number): SecurityBand {
  if (security >= 0.45) return 'high';
  if (security > 0) return 'low';
  return 'null';
}

export const getStation = (id: number) => stationById.get(id);
export const getSystem = (id: number) => systemById.get(id);
export const getType = (id: number) => typeById.get(id);
export const neighbors = (id: number) => adjacency.get(id) ?? [];

async function fetchCsv(file: string): Promise<ParsedReturn> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file} (${res.status})`);
  return parseCsv(await res.text());
}
type ParsedReturn = ReturnType<typeof parseCsv>;

export interface SdeMeta {
  stations: number;
  systems: number;
  jumps: number;
  types: number;
}

/** Load stations, systems, item types, and the jump graph into memory. */
export async function loadSde(): Promise<SdeMeta> {
  const [sta, sys, jumps, types] = await Promise.all([
    fetchCsv('staStations.csv'),
    fetchCsv('mapSolarSystems.csv'),
    fetchCsv('mapSolarSystemJumps.csv'),
    fetchCsv('invTypes.csv'),
  ]);

  for (const r of sys.rows) {
    const id = Number(r[sys.idx.solarSystemID]);
    systemById.set(id, {
      id,
      name: r[sys.idx.solarSystemName],
      security: Math.round(Number(r[sys.idx.security]) * 100) / 100,
    });
  }

  for (const r of sta.rows) {
    const id = Number(r[sta.idx.stationID]);
    stationById.set(id, {
      id,
      name: r[sta.idx.stationName],
      systemId: Number(r[sta.idx.solarSystemID]),
    });
  }

  for (const r of jumps.rows) {
    const from = Number(r[jumps.idx.fromSolarSystemID]);
    const to = Number(r[jumps.idx.toSolarSystemID]);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }

  // Only keep market-relevant types (published, with a non-zero volume) to
  // keep the map small; that's all arbitrage ever looks up.
  for (const r of types.rows) {
    if (r[types.idx.published] !== '1') continue;
    const id = Number(r[types.idx.typeID]);
    const volume = Number(r[types.idx.volume]);
    if (!Number.isFinite(volume) || volume <= 0) continue;
    typeById.set(id, { id, name: r[types.idx.typeName], volume });
  }

  return {
    stations: stationById.size,
    systems: systemById.size,
    jumps: adjacency.size,
    types: typeById.size,
  };
}
