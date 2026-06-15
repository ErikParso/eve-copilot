// Thin ESI fetch helpers for the server (public endpoints only).
const ESI_BASE = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

export class EsiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function url(path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${ESI_BASE}${path}`);
  u.searchParams.set('datasource', DATASOURCE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export async function esiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const res = await fetch(url(path, params), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new EsiError(`ESI ${res.status} for ${path}`, res.status);
  return (await res.json()) as T;
}

export interface PagedResponse<T> {
  data: T;
  pages: number;
  lastModified: number | null;
}

export async function esiGetPaged<T>(
  path: string,
  page: number,
  params?: Record<string, string | number>,
): Promise<PagedResponse<T>> {
  const res = await fetch(url(path, { ...params, page }), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new EsiError(`ESI ${res.status} for ${path} (page ${page})`, res.status);
  const pages = Number(res.headers.get('x-pages') ?? '1');
  const lm = res.headers.get('last-modified');
  const lastModified = lm ? Date.parse(lm) : null;
  return { data: (await res.json()) as T, pages, lastModified: Number.isFinite(lastModified) ? lastModified : null };
}

/** Run an async mapper with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  onSettled?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await mapper(items[i], i);
      onSettled?.(++completed, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
