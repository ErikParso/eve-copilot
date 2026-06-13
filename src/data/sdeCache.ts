// Tiny IndexedDB-backed cache for the parsed SDE codelists, so the ~3 MB CSV
// download only happens periodically (or when offline-stale) rather than on
// every app load. No external dependency — uses the native IndexedDB API.

const DB_NAME = 'eve-multitool';
const DB_VERSION = 1;
const STORE = 'sde';
const KEY = 'codelists';

export interface CachedSde {
  /** Trimmed station list: { id, name, systemId }. */
  stations: { id: number; name: string; systemId: number }[];
  /** Compact system map: { [systemId]: [name, security] }. */
  systems: Record<string, [string, number]>;
  /** Epoch ms when this snapshot was fetched. */
  fetchedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSdeCache(): Promise<CachedSde | null> {
  try {
    const db = await openDb();
    return await new Promise<CachedSde | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as CachedSde) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Private mode / unsupported / blocked — treat as "no cache".
    return null;
  }
}

export async function writeSdeCache(data: CachedSde): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Caching is best-effort; failing to persist is non-fatal.
  }
}
