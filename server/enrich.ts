// Shared enrichment helpers: turn raw location/system ids into the resolved
// endpoints and route-system arrays the client cards render. Used by both the
// courier-contract and arbitrage pipelines.
import { getStation, getSystem, securityBand } from './sde.js';
import { isGankRisk } from './danger.js';
import type { ContractEndpoint, RouteSystem } from './types.js';

/**
 * Resolve a market/contract location id to an endpoint. NPC stations resolve
 * fully from the SDE; player structures can't be named without auth, but if we
 * know their system (market orders carry it) we still fill system details.
 */
export function resolveEndpoint(locationId: number, systemIdHint?: number): ContractEndpoint {
  const station = getStation(locationId);
  const systemId = station?.systemId ?? systemIdHint ?? null;
  const system = systemId !== null ? getSystem(systemId) : undefined;
  return {
    locationId,
    name: station?.name ?? `Structure #${locationId}`,
    systemName: system?.name ?? null,
    systemId,
    security: system?.security ?? null,
    securityBand: system ? securityBand(system.security) : null,
    resolved: Boolean(station),
  };
}

/** Turn an ordered list of system ids into route systems with kill counts. */
export function toRouteSystems(systemIds: number[], kills: Map<number, number>): RouteSystem[] {
  return systemIds.map((id) => {
    const system = getSystem(id);
    const security = system?.security ?? 0;
    const band = securityBand(security);
    const shipKills = kills.get(id) ?? 0;
    return {
      systemId: id,
      name: system?.name ?? `System ${id}`,
      security,
      securityBand: band,
      shipKills,
      gank: isGankRisk(band, shipKills),
    };
  });
}
