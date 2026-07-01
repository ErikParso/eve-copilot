// Shared enrichment helpers: turn raw location/system ids into the resolved
// endpoints and route-system arrays the client cards render. Used by both the
// courier-contract and arbitrage pipelines.
import { getStation, getSystem, securityBand } from './sde.js';
import { isGankRisk, gateKillsForSystem, systemDanger } from './danger.js';
import type { ContractEndpoint, RouteSystem, GateKillData } from './types.js';

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

/**
 * Turn an ORDERED list of system ids into route systems, each carrying the kills
 * on the two gates it uses on this route (to the previous & next system) plus
 * those neighbours' names for the "N kills at gate to X" tooltip. `gank` (skull)
 * fires when the two gate counts sum to the skull threshold or more.
 */
export function toRouteSystems(systemIds: number[], data: GateKillData): RouteSystem[] {
  return systemIds.map((id, i) => {
    const system = getSystem(id);
    const security = system?.security ?? 0;
    const band = securityBand(security);
    const prev = i > 0 ? systemIds[i - 1] : undefined;
    const next = i < systemIds.length - 1 ? systemIds[i + 1] : undefined;
    const { recentPrev, recentNext, basePrev, baseNext } = gateKillsForSystem(systemIds, i, data);
    const nameOf = (sid: number | undefined) =>
      sid !== undefined ? (getSystem(sid)?.name ?? `System ${sid}`) : null;
    const { index: danger, steps: dangerSteps } = systemDanger(security, recentPrev, recentNext, basePrev, baseNext);
    return {
      systemId: id,
      name: system?.name ?? `System ${id}`,
      security,
      securityBand: band,
      gateKillsToPrev: recentPrev,
      gateKillsToNext: recentNext,
      baselineToPrev: basePrev,
      baselineToNext: baseNext,
      prevName: nameOf(prev),
      nextName: nameOf(next),
      danger,
      dangerSteps,
      // Skull is RECENT-only ("camp right now") — the 24h baseline never trips it.
      gank: isGankRisk(recentPrev + recentNext),
    };
  });
}
