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
const MAX_CONCURRENT = 8;
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

// --- Global rate-limit circuit breaker -----------------------------------
// When ESI pushes back (420 error-limited / 429 too-many-requests), every
// in-flight request retrying independently just re-trips the limit and
// cascades. Instead, the FIRST 429/420 pauses the WHOLE gate until the
// server's reset window passes, so the crawler backs off as one and ESI's
// error budget recovers — then everyone resumes. Prevents the cascade & the
// region drops it causes.
let gatePausedUntil = 0;
let pauseLogActive = false;
let pauseHits = 0;

/** Pause all ESI requests for `ms` (honouring the server's reset window if given). */
function notePushback(retryAfterMs: number | undefined): void {
  const backoff = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, 30_000) : 5_000;
  const until = Date.now() + backoff;
  if (until > gatePausedUntil) gatePausedUntil = until;
  pauseHits++;
  if (!pauseLogActive) {
    // Log the trip once per pause window; a self-rescheduling check logs the
    // resume when the (possibly extended) window finally clears.
    pauseLogActive = true;
    const hitsAtStart = pauseHits;
    console.warn(`[ESI] ⏸ Rate limited — pausing ALL requests ~${Math.round(backoff / 1000)}s (${active} in flight).`);
    const checkResume = () => {
      const remaining = gatePausedUntil - Date.now();
      if (remaining > 0) {
        setTimeout(checkResume, remaining + 50);
        return;
      }
      pauseLogActive = false;
      console.log(`[ESI] ▶ Rate-limit pause cleared — resuming (${pauseHits - hitsAtStart + 1} request(s) hit the limit during it).`);
    };
    setTimeout(checkResume, backoff + 50);
  }
}

/** fetch() wrapper: caps concurrency AND honours the global rate-limit pause. */
async function gatedFetch(target: string, extraHeaders?: Record<string, string>): Promise<Response> {
  await acquire();
  try {
    // If we're in a pushback window, wait it out before firing (re-check in case
    // the window was extended by another request while we slept).
    for (let wait = gatePausedUntil - Date.now(); wait > 0; wait = gatePausedUntil - Date.now()) {
      await new Promise((r) => setTimeout(r, wait));
    }
    return await fetch(target, { headers: { Accept: 'application/json', ...extraHeaders } });
  } finally {
    release();
  }
}

/** Parse an HTTP `Expires` header to an epoch-ms timestamp, or null if absent/invalid. */
function parseExpires(res: Response): number | null {
  const exp = res.headers.get('expires');
  if (!exp) return null;
  const t = Date.parse(exp);
  return Number.isFinite(t) ? t : null;
}

// --- Error telemetry -----------------------------------------------------
// Counts every failed ESI request attempt (including ones that later succeed on
// retry) so the crawler can report exactly what's failing and why.
const httpErrorCounts = new Map<number, number>();
let networkErrorCount = 0;

/** Tally a thrown request error by HTTP status, or as a network-level failure. */
function noteThrown(err: unknown): void {
  if (err instanceof EsiError) {
    httpErrorCounts.set(err.status, (httpErrorCounts.get(err.status) ?? 0) + 1);
  } else {
    networkErrorCount++;
  }
}

export interface EsiErrorStats {
  byStatus: Record<number, number>;
  network: number;
  total: number;
}

/** Cumulative ESI request-failure counts since process start. */
export function getEsiErrorStats(): EsiErrorStats {
  const byStatus: Record<number, number> = {};
  let total = networkErrorCount;
  for (const [status, n] of httpErrorCounts) {
    byStatus[status] = n;
    total += n;
  }
  return { byStatus, network: networkErrorCount, total };
}

/** Human-readable one-line summary of failures, e.g. "429×12, 503×2, network×1". */
export function formatEsiErrorStats(): string {
  const parts: string[] = [];
  for (const [status, n] of [...httpErrorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    parts.push(`${status}×${n}`);
  }
  if (networkErrorCount > 0) parts.push(`network×${networkErrorCount}`);
  return parts.length ? parts.join(', ') : 'none';
}

/** Build an EsiError from a non-ok response, capturing how long to back off (420/429). */
function esiErrorFrom(res: Response, message: string): EsiError {
  // 429 uses the standard `Retry-After`; 420 uses ESI's `x-esi-error-limit-reset`. Seconds either way.
  const retryAfter = Number(res.headers.get('retry-after'));
  const errReset = Number(res.headers.get('x-esi-error-limit-reset'));
  let retryAfterMs: number | undefined;
  if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
  else if (Number.isFinite(errReset) && errReset > 0) retryAfterMs = errReset * 1000;
  // Rate-limited → trip the global breaker so the whole crawler backs off, not
  // just this one request (which would otherwise retry into the same wall).
  if (res.status === 429 || res.status === 420) notePushback(retryAfterMs);
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
    noteThrown(err);
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
    noteThrown(err);
    if (retries > 0 && shouldRetry(err)) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(err)));
      return esiGetPaged(path, page, params, retries - 1);
    }
    throw err;
  }
}

/** One conditional page fetch: 304 (unchanged) carries no body but still has meta. */
export interface ConditionalPage<T> {
  /** HTTP status — 200 (fresh body) or 304 (unchanged, `data` is null). */
  status: 200 | 304;
  /** Parsed body on 200, null on 304. */
  data: T | null;
  /** Total pages for this resource (X-Pages), defaulting to 1. */
  pages: number;
  /** Current ETag to store and replay on the next conditional request. */
  etag: string | null;
  lastModified: number | null;
  /** When ESI's cache for this resource expires (epoch ms), or null. */
  expiresAt: number | null;
}

/**
 * Fetch one page of a paginated ESI resource conditionally. Pass the ETag stored
 * from the previous fetch; if the page is unchanged ESI replies 304 with no body
 * (near-zero cost), otherwise 200 with the fresh body and a new ETag. Retries on
 * transient 5xx / rate-limit errors like the other helpers.
 */
export async function esiGetPageConditional<T>(
  path: string,
  page: number,
  etag: string | null,
  retries = 5,
): Promise<ConditionalPage<T>> {
  try {
    const headers = etag ? { 'If-None-Match': etag } : undefined;
    const res = await gatedFetch(url(path, { page }), headers);
    const pages = Number(res.headers.get('x-pages') ?? '1') || 1;
    const lm = res.headers.get('last-modified');
    const lastModified = lm ? Date.parse(lm) : null;
    const expiresAt = parseExpires(res);
    if (res.status === 304) {
      return { status: 304, data: null, pages, etag, lastModified: Number.isFinite(lastModified) ? lastModified : null, expiresAt };
    }
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path} (page ${page})`);
    return {
      status: 200,
      data: (await res.json()) as T,
      pages,
      etag: res.headers.get('etag'),
      lastModified: Number.isFinite(lastModified) ? lastModified : null,
      expiresAt,
    };
  } catch (err) {
    noteThrown(err);
    if (retries > 0 && shouldRetry(err)) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(err)));
      return esiGetPageConditional(path, page, etag, retries - 1);
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
