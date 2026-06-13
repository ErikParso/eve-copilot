// Thin wrapper around the public EVE ESI REST API.
// Docs: https://esi.evetech.net/ui/  — no auth needed for the endpoints used.
export const ESI_BASE = 'https://esi.evetech.net/latest';
export const DATASOURCE = 'tranquility';

export class EsiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EsiError';
  }
}

function withParams(path: string, params: Record<string, string | number> = {}): string {
  const url = new URL(`${ESI_BASE}${path}`);
  url.searchParams.set('datasource', DATASOURCE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** GET a JSON resource, throwing EsiError on non-2xx responses. */
export async function esiGet<T>(
  path: string,
  params?: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(withParams(path, params), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new EsiError(`ESI ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

/**
 * GET the first page and report total pages via the `X-Pages` header so the
 * caller can fan out the remaining pages.
 */
export async function esiGetPaged<T>(
  path: string,
  page: number,
  params?: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<{ data: T; pages: number }> {
  const res = await fetch(withParams(path, { ...params, page }), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new EsiError(`ESI ${res.status} for ${path} (page ${page})`, res.status);
  }
  const pages = Number(res.headers.get('X-Pages') ?? '1');
  const data = (await res.json()) as T;
  return { data, pages };
}
