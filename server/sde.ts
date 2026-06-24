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
  /** Region this system belongs to (for buy-order range resolution). */
  regionId: number;
}
export interface ItemType {
  id: number;
  name: string;
  /**
   * Volume in m³ as hauled. Packaged volume for repackageable groups (ships,
   * containers — see PACKAGED_VOLUME_BY_GROUP); the SDE assembled volume
   * otherwise. Used to cap haul quantity by cargo.
   */
  volume: number;
}

/**
 * Canonical packaged volumes (m³) for repackageable ship/container groups. The
 * SDE's invTypes.volume is the *assembled* volume, which massively overstates
 * what a ship occupies when hauled packaged — so a cargo cap would wrongly
 * exclude them. These per-group constants are long-stable EVE values. Groups not
 * listed here keep their assembled volume (correct for non-repackaged items), so
 * partial coverage is a strict improvement and never a regression.
 */
const PACKAGED_VOLUME_BY_GROUP = new Map<number, number>([
  // Frigate-sized
  [25, 2_500], // Frigate
  [31, 500], // Shuttle
  [237, 2_500], // Corvette
  [324, 2_500], // Assault Frigate
  [830, 2_500], // Covert Ops
  [831, 2_500], // Interceptor
  [834, 2_500], // Stealth Bomber
  [893, 2_500], // Electronic Attack Ship
  [1283, 2_500], // Expedition Frigate
  [1527, 2_500], // Logistics Frigate
  // Destroyer-sized
  [420, 5_000], // Destroyer
  [541, 5_000], // Interdictor
  [1305, 5_000], // Tactical Destroyer
  [1534, 5_000], // Command Destroyer
  // Cruiser-sized
  [26, 10_000], // Cruiser
  [358, 10_000], // Heavy Assault Cruiser
  [832, 10_000], // Logistics
  [833, 10_000], // Force Recon Ship
  [894, 10_000], // Heavy Interdiction Cruiser
  [906, 10_000], // Combat Recon Ship
  [963, 10_000], // Strategic Cruiser
  // Battlecruiser-sized
  [419, 15_000], // Combat Battlecruiser
  [540, 15_000], // Command Ship
  [1201, 15_000], // Attack Battlecruiser
  // Battleship-sized
  [27, 50_000], // Battleship
  [898, 50_000], // Black Ops
  [900, 50_000], // Marauder
  // Industrials / mining
  [28, 20_000], // Industrial (hauler)
  [380, 20_000], // Deep Space Transport
  [1202, 20_000], // Blockade Runner
  [463, 3_750], // Mining Barge
  [543, 3_750], // Exhumer
]);

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
/** Region of a solar system, or null if unknown. */
export const getRegion = (systemId: number): number | null => systemById.get(systemId)?.regionId ?? null;

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

/** Load stations, systems, item types, and the jump graph into memory sequentially to conserve RAM. */
export async function loadSde(): Promise<SdeMeta> {
  console.log('Loading mapSolarSystems SDE...');
  const sys = await fetchCsv('mapSolarSystems.csv');
  for (const r of sys.rows) {
    const id = Number(r[sys.idx.solarSystemID]);
    systemById.set(id, {
      id,
      name: r[sys.idx.solarSystemName],
      security: Math.round(Number(r[sys.idx.security]) * 100) / 100,
      regionId: Number(r[sys.idx.regionID]),
    });
  }

  console.log('Loading staStations SDE...');
  const sta = await fetchCsv('staStations.csv');
  for (const r of sta.rows) {
    const id = Number(r[sta.idx.stationID]);
    stationById.set(id, {
      id,
      name: r[sta.idx.stationName],
      systemId: Number(r[sta.idx.solarSystemID]),
    });
  }

  console.log('Loading mapSolarSystemJumps SDE...');
  const jumps = await fetchCsv('mapSolarSystemJumps.csv');
  for (const r of jumps.rows) {
    const from = Number(r[jumps.idx.fromSolarSystemID]);
    const to = Number(r[jumps.idx.toSolarSystemID]);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }

  // Only keep market-relevant types (published, with a non-zero volume) to
  // keep the map small; that's all arbitrage ever looks up.
  console.log('Loading invTypes SDE...');
  const types = await fetchCsv('invTypes.csv');
  for (const r of types.rows) {
    if (r[types.idx.published] !== '1') continue;
    const id = Number(r[types.idx.typeID]);
    const assembled = Number(r[types.idx.volume]);
    if (!Number.isFinite(assembled) || assembled <= 0) continue;
    // Prefer the packaged volume for repackageable groups (ships &c.); the SDE
    // `volume` is the assembled size, which overstates hauling volume.
    const groupId = Number(r[types.idx.groupID]);
    const volume = PACKAGED_VOLUME_BY_GROUP.get(groupId) ?? assembled;
    typeById.set(id, { id, name: r[types.idx.typeName], volume });
  }

  return {
    stations: stationById.size,
    systems: systemById.size,
    jumps: adjacency.size,
    types: typeById.size,
  };
}
