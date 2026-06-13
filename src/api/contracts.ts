// Fetch public courier contracts across the whole cluster.
//
// ESI has no single "all contracts" endpoint, so we iterate every region's
// paginated /contracts/public/{region_id}/ feed and keep only courier
// contracts. This is request-heavy (~100 regions, several pages each), so the
// fan-out is concurrency-limited and reports progress.
import { esiGet, esiGetPaged } from './esiClient';
import { mapWithConcurrency } from '@/utils/concurrency';

export type ContractType = 'item_exchange' | 'auction' | 'courier' | 'unknown';

/** Raw public contract shape from ESI (only fields we consume). */
export interface PublicContract {
  contract_id: number;
  type: ContractType;
  start_location_id: number;
  end_location_id: number;
  volume: number;
  reward: number;
  collateral: number;
  price: number;
  days_to_complete: number;
  date_issued: string;
  date_expired: string;
  title?: string;
}

export interface FetchProgress {
  /** Regions whose first page has been fetched. */
  regionsDone: number;
  regionsTotal: number;
}

export async function fetchRegionIds(signal?: AbortSignal): Promise<number[]> {
  return esiGet<number[]>('/universe/regions/', undefined, signal);
}

interface RegionResult {
  contracts: PublicContract[];
  /** `Expires` of the region's first page (when CCP serves fresh data). */
  expires: number | null;
  /** `Last-Modified` of the region's first page (snapshot build time). */
  lastModified: number | null;
}

async function fetchRegionCourierContracts(
  regionId: number,
  signal: AbortSignal | undefined,
): Promise<RegionResult> {
  const collected: PublicContract[] = [];
  let expires: number | null = null;
  let lastModified: number | null = null;
  try {
    const first = await esiGetPaged<PublicContract[]>(
      `/contracts/public/${regionId}/`,
      1,
      undefined,
      signal,
    );
    expires = first.expires;
    lastModified = first.lastModified;
    const keep = (list: PublicContract[]) => {
      for (const c of list) if (c.type === 'courier') collected.push(c);
    };
    keep(first.data);

    if (first.pages > 1) {
      const restPages = Array.from({ length: first.pages - 1 }, (_, i) => i + 2);
      const pages = await mapWithConcurrency(restPages, 4, async (page) => {
        const res = await esiGetPaged<PublicContract[]>(
          `/contracts/public/${regionId}/`,
          page,
          undefined,
          signal,
        );
        return res.data;
      });
      pages.forEach(keep);
    }
  } catch {
    // A region with no contracts returns 404; treat any region-level failure
    // as "no contracts here" rather than failing the whole search.
  }
  return { contracts: collected, expires, lastModified };
}

export interface CourierContractsResult {
  contracts: PublicContract[];
  /** When CCP will next serve fresh data (latest region `Expires`), or null. */
  expiresAt: number | null;
  /** When the current snapshot was built (latest region `Last-Modified`). */
  lastModifiedAt: number | null;
}

/**
 * Fetch every public courier contract in the cluster, along with the feed's
 * cache timestamps (CCP caches the public contracts feed ~30 min, so the data
 * is only as fresh as `lastModifiedAt` and refreshes by `expiresAt`).
 * @param onProgress called as regions complete so the UI can show a counter.
 */
export async function fetchAllCourierContracts(
  onProgress?: (progress: FetchProgress) => void,
  signal?: AbortSignal,
): Promise<CourierContractsResult> {
  const regionIds = await fetchRegionIds(signal);

  const perRegion = await mapWithConcurrency(
    regionIds,
    16,
    (regionId) => fetchRegionCourierContracts(regionId, signal),
    (done, total) => onProgress?.({ regionsDone: done, regionsTotal: total }),
  );

  const maxOf = (pick: (r: RegionResult) => number | null): number | null => {
    const values = perRegion.map(pick).filter((v): v is number => v !== null);
    return values.length ? Math.max(...values) : null;
  };

  return {
    contracts: perRegion.flatMap((r) => r.contracts),
    expiresAt: maxOf((r) => r.expires),
    lastModifiedAt: maxOf((r) => r.lastModified),
  };
}
