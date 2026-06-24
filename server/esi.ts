// Thin ESI fetch helpers for the server (public endpoints only).
const ESI_BASE = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

export class EsiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

function url(path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${ESI_BASE}${path}`);
  u.searchParams.set('datasource', DATASOURCE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Build an EsiError from a non-ok response, capturing the error-limit reset window for 420s. */
function esiErrorFrom(res: Response, message: string): EsiError {
  const reset = Number(res.headers.get('x-esi-error-limit-reset'));
  const retryAfterMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined;
  return new EsiError(message, res.status, retryAfterMs);
}

/** Whether a thrown error is worth retrying: transient network drop, 5xx, or 420 rate limit. */
function shouldRetry(err: unknown): boolean {
  if (err instanceof EsiError) return err.status >= 500 || err.status === 420;
  return true; // network-level failure (fetch throws TypeError) — retry
}

/** How long to wait before retrying: honour ESI's error-limit reset on 420, else a flat 1s. */
function retryWaitMs(err: unknown): number {
  if (err instanceof EsiError && err.retryAfterMs && err.retryAfterMs > 0) {
    return Math.min(err.retryAfterMs, 30_000);
  }
  return 1000;
}

/** Fetch data from ESI with automatic retry on transient 5xx errors and 420 rate limiting. */
export async function esiGet<T>(
  path: string,
  params?: Record<string, string | number>,
  retries = 3
): Promise<T> {
  try {
    const res = await fetch(url(path, params), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path}`);
    return (await res.json()) as T;
  } catch (err) {
    if (retries > 0 && shouldRetry(err)) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(err)));
      return esiGet(path, params, retries - 1);
    }
    throw err;
  }
}

export interface PagedResponse<T> {
  data: T;
  pages: number;
  lastModified: number | null;
}

/** Fetch paginated data from ESI with automatic retry on transient 5xx errors and 420 rate limiting. */
export async function esiGetPaged<T>(
  path: string,
  page: number,
  params?: Record<string, string | number>,
  retries = 3
): Promise<PagedResponse<T>> {
  try {
    const res = await fetch(url(path, { ...params, page }), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path} (page ${page})`);
    const pages = Number(res.headers.get('x-pages') ?? '1');
    const lm = res.headers.get('last-modified');
    const lastModified = lm ? Date.parse(lm) : null;
    return { data: (await res.json()) as T, pages, lastModified: Number.isFinite(lastModified) ? lastModified : null };
  } catch (err) {
    if (retries > 0 && shouldRetry(err)) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(err)));
      return esiGetPaged(path, page, params, retries - 1);
    }
    throw err;
  }
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
