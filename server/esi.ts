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

// --- Global concurrency gate ---------------------------------------------
// ESI rate-limits by total concurrent connections per IP, so a hard cap on
// in-flight requests across the WHOLE app matters more than per-loop limits
// (which multiply: 5 regions x 10 pages = 50 sockets → 429s). Every request
// passes through this gate regardless of which crawler issued it.
const MAX_CONCURRENT = 10;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (active unchanged)
  else active--;
}

/** fetch() wrapper that never lets total in-flight ESI requests exceed MAX_CONCURRENT. */
async function gatedFetch(target: string): Promise<Response> {
  await acquire();
  try {
    return await fetch(target, { headers: { Accept: 'application/json' } });
  } finally {
    release();
  }
}

/** Build an EsiError from a non-ok response, capturing how long to back off (420/429). */
function esiErrorFrom(res: Response, message: string): EsiError {
  // 429 uses the standard `Retry-After`; 420 uses ESI's `x-esi-error-limit-reset`. Seconds either way.
  const retryAfter = Number(res.headers.get('retry-after'));
  const errReset = Number(res.headers.get('x-esi-error-limit-reset'));
  let retryAfterMs: number | undefined;
  if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
  else if (Number.isFinite(errReset) && errReset > 0) retryAfterMs = errReset * 1000;
  return new EsiError(message, res.status, retryAfterMs);
}

/** Whether a thrown error is worth retrying: transient network drop, 5xx, or 420/429 rate limit. */
function shouldRetry(err: unknown): boolean {
  if (err instanceof EsiError) return err.status >= 500 || err.status === 420 || err.status === 429;
  return true; // network-level failure (fetch throws TypeError) — retry
}

/** How long to wait before retrying: honour the server's reset window, else a sensible default. */
function retryWaitMs(err: unknown): number {
  if (err instanceof EsiError && err.retryAfterMs && err.retryAfterMs > 0) {
    return Math.min(err.retryAfterMs, 30_000);
  }
  // Rate-limited but no header given: back off hard rather than hammering again.
  if (err instanceof EsiError && (err.status === 420 || err.status === 429)) return 5000;
  return 1000;
}

/** Fetch data from ESI with automatic retry on transient 5xx errors and 420 rate limiting. */
export async function esiGet<T>(
  path: string,
  params?: Record<string, string | number>,
  retries = 5
): Promise<T> {
  try {
    const res = await gatedFetch(url(path, params));
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
  retries = 5
): Promise<PagedResponse<T>> {
  try {
    const res = await gatedFetch(url(path, { ...params, page }));
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
