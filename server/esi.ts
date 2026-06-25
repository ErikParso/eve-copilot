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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- Adaptive request-rate limiter ---------------------------------------
// ESI throttles by request RATE per IP, not just concurrency. A concurrency cap
// is bursty (N fast responses = a spike), and pausing-then-releasing requests
// together just re-bursts and re-trips the limit — a death spiral. Instead we
// space request STARTS evenly at an adaptive interval: nudge faster while
// healthy, back off multiplicatively on 429/420, recover gradually. Smooth and
// self-tuning, so the rate settles just under whatever this IP is allowed and
// never forms a thundering herd. In-flight count is naturally bounded by
// rate × latency (a few), so no separate concurrency gate is needed.
// Steady pace ≈ 7 req/s: comfortably above the ~5 req/s the workload needs (so it
// keeps up), and far below the rate that actually trips ESI for this IP (the
// server only broke at ~50 req/s bursts). The point is to AVOID the limit by
// staying under it, not to hit it and wait for a reset.
const MIN_INTERVAL_MS = 150; // floor ≈ 7 req/s when healthy
const MAX_INTERVAL_MS = 3000; // safety-net ceiling if ever rate-limited (≈ 0.3 req/s)
let intervalMs = MIN_INTERVAL_MS;
let nextSlotAt = 0;
let throttleLogged = false;

/** Adjust the rate after each response: back off on rate-limit, recover on success. */
function noteRateResult(status: number): void {
  if (status === 429 || status === 420) {
    intervalMs = Math.min(Math.round(intervalMs * 1.5), MAX_INTERVAL_MS);
    if (!throttleLogged && intervalMs >= MIN_INTERVAL_MS * 3) {
      throttleLogged = true;
      console.warn(`[ESI] Rate limited — throttling to ~${(1000 / intervalMs).toFixed(1)} req/s until it clears.`);
    }
  } else if (intervalMs > MIN_INTERVAL_MS) {
    intervalMs = Math.max(MIN_INTERVAL_MS, Math.round(intervalMs * 0.9));
    if (throttleLogged && intervalMs <= MIN_INTERVAL_MS * 1.5) {
      throttleLogged = false;
      console.log(`[ESI] Rate recovered — back to ~${(1000 / intervalMs).toFixed(1)} req/s.`);
    }
  }
}

/** fetch() wrapper that paces request STARTS to the current adaptive rate. */
async function gatedFetch(target: string, extraHeaders?: Record<string, string>): Promise<Response> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + intervalMs; // reserve this slot atomically (single-threaded)
  if (slot > now) await sleep(slot - now);
  const res = await fetch(target, { headers: { Accept: 'application/json', ...extraHeaders } });
  noteRateResult(res.status);
  return res;
}

/** Parse an HTTP date header to an epoch-ms timestamp, or null if absent/invalid. */
function parseDateHeader(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  if (!v) return null;
  const t = Date.parse(v);
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
}

/** ESI request-failure counts since process start (cumulative; deltas done by caller). */
export function getEsiErrorStats(): EsiErrorStats {
  return { byStatus: Object.fromEntries(httpErrorCounts), network: networkErrorCount };
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

// How long to wait before retrying: honour the server's reset window if it gave
// one. Rate-limit (420/429) backoff is otherwise handled globally by the circuit
// breaker (gatedFetch waits out the pause), so no special case is needed here.
function retryWaitMs(err: unknown): number {
  if (err instanceof EsiError && err.retryAfterMs && err.retryAfterMs > 0) {
    return Math.min(err.retryAfterMs, 30_000);
  }
  return 1000;
}

/** Run an ESI request with the shared policy: tally failures, retry transient ones. */
async function withRetry<T>(run: () => Promise<T>, retries = 5): Promise<T> {
  try {
    return await run();
  } catch (err) {
    noteThrown(err);
    if (retries > 0 && shouldRetry(err)) {
      await sleep(retryWaitMs(err));
      return withRetry(run, retries - 1);
    }
    throw err;
  }
}

/** Fetch JSON from ESI, with the shared retry/backoff policy. */
export function esiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  return withRetry(async () => {
    const res = await gatedFetch(url(path, params));
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path}`);
    return (await res.json()) as T;
  });
}

export interface PagedResponse<T> {
  data: T;
  pages: number;
  lastModified: number | null;
}

/** Fetch one page of a paginated ESI resource, with the shared retry/backoff policy. */
export function esiGetPaged<T>(path: string, page: number, params?: Record<string, string | number>): Promise<PagedResponse<T>> {
  return withRetry(async () => {
    const res = await gatedFetch(url(path, { ...params, page }));
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path} (page ${page})`);
    return {
      data: (await res.json()) as T,
      pages: Number(res.headers.get('x-pages') ?? '1'),
      lastModified: parseDateHeader(res, 'last-modified'),
    };
  });
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
export function esiGetPageConditional<T>(path: string, page: number, etag: string | null): Promise<ConditionalPage<T>> {
  return withRetry(async () => {
    const res = await gatedFetch(url(path, { page }), etag ? { 'If-None-Match': etag } : undefined);
    const pages = Number(res.headers.get('x-pages') ?? '1') || 1;
    const lastModified = parseDateHeader(res, 'last-modified');
    const expiresAt = parseDateHeader(res, 'expires');
    if (res.status === 304) return { status: 304, data: null, pages, etag, lastModified, expiresAt };
    if (!res.ok) throw esiErrorFrom(res, `ESI ${res.status} for ${path} (page ${page})`);
    return { status: 200, data: (await res.json()) as T, pages, etag: res.headers.get('etag'), lastModified, expiresAt };
  });
}

/** Run an async mapper with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
