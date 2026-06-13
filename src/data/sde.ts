// Runtime-loaded EVE Static Data Export (SDE) codelists: NPC stations and
// solar systems. Data is fetched from the Fuzzwork SDE CSV mirror at startup
// (CORS-enabled), parsed in the browser and cached in IndexedDB so it stays
// fresh without re-downloading on every load. Player-owned structures
// (citadels) are not in the SDE and require authenticated ESI to resolve.
import { parseCsv } from './parseCsv';
import { readSdeCache, writeSdeCache, type CachedSde } from './sdeCache';

const STATIONS_URL = 'https://www.fuzzwork.co.uk/dump/latest/csv/staStations.csv';
const SYSTEMS_URL = 'https://www.fuzzwork.co.uk/dump/latest/csv/mapSolarSystems.csv';

// Re-fetch from the network when the cached snapshot is older than this.
// Stations/systems only change on game patches, so a few hours is plenty
// fresh while keeping startup instant for repeat visits.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface Station {
  id: number;
  name: string;
  systemId: number;
}

export interface SolarSystem {
  id: number;
  name: string;
  /** Truescaled security status, rounded to 2 decimals (-1.0 .. 1.0). */
  security: number;
}

export interface SdeMeta {
  fetchedAt: number;
  stationCount: number;
  systemCount: number;
  /** True when served from the IndexedDB cache rather than a fresh fetch. */
  fromCache: boolean;
}

// --- Module-level state, populated by loadSde() --------------------------
export let stations: Station[] = [];
let stationById = new Map<number, Station>();
let systemById = new Map<number, SolarSystem>();
let loadPromise: Promise<SdeMeta> | null = null;

// --- Parsing -------------------------------------------------------------
function parseStations(csv: string): CachedSde['stations'] {
  const { rows, idx } = parseCsv(csv);
  const out = rows.map((r) => ({
    id: Number(r[idx.stationID]),
    name: r[idx.stationName],
    systemId: Number(r[idx.solarSystemID]),
  }));
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function parseSystems(csv: string): CachedSde['systems'] {
  const { rows, idx } = parseCsv(csv);
  const out: CachedSde['systems'] = {};
  for (const r of rows) {
    const id = r[idx.solarSystemID];
    const name = r[idx.solarSystemName];
    const security = Math.round(Number(r[idx.security]) * 100) / 100;
    out[id] = [name, security];
  }
  return out;
}

// --- Ingest into in-memory lookup structures -----------------------------
function ingest(data: CachedSde): SdeMeta {
  stations = data.stations;
  stationById = new Map(stations.map((s) => [s.id, s]));
  systemById = new Map(
    Object.entries(data.systems).map(([id, [name, security]]) => [
      Number(id),
      { id: Number(id), name, security },
    ]),
  );
  return {
    fetchedAt: data.fetchedAt,
    stationCount: stations.length,
    systemCount: systemById.size,
    fromCache: false,
  };
}

async function fetchFresh(signal?: AbortSignal): Promise<CachedSde> {
  const [staCsv, sysCsv] = await Promise.all([
    fetch(STATIONS_URL, { signal }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load stations (${r.status})`);
      return r.text();
    }),
    fetch(SYSTEMS_URL, { signal }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load systems (${r.status})`);
      return r.text();
    }),
  ]);
  return {
    stations: parseStations(staCsv),
    systems: parseSystems(sysCsv),
    fetchedAt: Date.now(),
  };
}

/**
 * Load the SDE codelists into memory. Cached for the module's lifetime; call
 * with `force` to bypass the IndexedDB cache and re-fetch from the network.
 * Strategy: use a fresh-enough cache if present, otherwise fetch from the
 * network and update the cache, falling back to a stale cache when offline.
 */
export function loadSde(force = false): Promise<SdeMeta> {
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    const cached = force ? null : await readSdeCache();
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

    if (cached && isFresh) {
      return { ...ingest(cached), fromCache: true };
    }

    try {
      const fresh = await fetchFresh();
      await writeSdeCache(fresh);
      return ingest(fresh);
    } catch (err) {
      // Network failed — fall back to any cache we have, even if stale.
      if (cached) return { ...ingest(cached), fromCache: true };
      throw err;
    }
  })();

  return loadPromise;
}

// --- Accessors (valid once loadSde() has resolved) -----------------------
export function getStation(id: number): Station | undefined {
  return stationById.get(id);
}

export function getSystem(id: number): SolarSystem | undefined {
  return systemById.get(id);
}

export type SecurityBand = 'high' | 'low' | 'null';

export function securityBand(security: number): SecurityBand {
  if (security >= 0.45) return 'high';
  if (security > 0.0) return 'low';
  return 'null';
}

// EVE's security-status colour ramp (blue → green → yellow → orange → red),
// keyed by security rounded to one decimal, but muted/desaturated so a long
// row of squares is easy on the eyes.
const SECURITY_COLORS: Record<string, string> = {
  '1.0': '#7FB7C9',
  '0.9': '#7FC4B4',
  '0.8': '#83C193',
  '0.7': '#8FC084',
  '0.6': '#A6C084',
  '0.5': '#C4BE83',
  '0.4': '#C4A883',
  '0.3': '#C49483',
  '0.2': '#C48783',
  '0.1': '#BC7E7E',
  '0.0': '#AE7373',
};

/** Colour for a security status using EVE's ramp; null-sec (≤0) is deep red. */
export function securityColor(security: number): string {
  const clamped = Math.max(0, Math.min(1, security));
  const key = (Math.round(clamped * 10) / 10).toFixed(1);
  return SECURITY_COLORS[key] ?? '#F00000';
}

/**
 * Case-insensitive substring search over NPC station names.
 * Returns prefix matches first, then other substring matches, capped.
 */
export function searchStations(query: string, limit = 50): Station[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];

  const prefix: Station[] = [];
  const contains: Station[] = [];
  for (const station of stations) {
    const name = station.name.toLowerCase();
    if (name.startsWith(q)) {
      prefix.push(station);
    } else if (name.includes(q)) {
      contains.push(station);
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}
