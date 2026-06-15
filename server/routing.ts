// Local route computation over the SDE jump graph — no ESI /route calls.
//   - shortest: fewest jumps (BFS)
//   - safest:   Dijkstra minimising low/null-sec systems first, then jumps
// Results are cached in memory for the process lifetime.
import { getSystem, neighbors, securityBand } from './sde.js';

export type RouteType = 'safest' | 'shortest';

// Cost of entering a non-high-sec system; dwarfs jump count so the safest
// route minimises low/null exposure, then total jumps.
const NON_HIGH_PENALTY = 1_000_000;

const routeCache = new Map<string, number[] | null>();

function key(origin: number, dest: number, type: RouteType): string {
  return `${origin}:${dest}:${type}`;
}

function reconstruct(prev: Map<number, number>, origin: number, dest: number): number[] {
  const path = [dest];
  let cur = dest;
  while (cur !== origin) {
    const p = prev.get(cur);
    if (p === undefined) return [];
    path.push(p);
    cur = p;
  }
  return path.reverse();
}

function bfs(origin: number, dest: number): number[] | null {
  const queue = [origin];
  const prev = new Map<number, number>();
  const seen = new Set<number>([origin]);
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    if (node === dest) return reconstruct(prev, origin, dest);
    for (const n of neighbors(node)) {
      if (!seen.has(n)) {
        seen.add(n);
        prev.set(n, node);
        queue.push(n);
      }
    }
  }
  return null;
}

// Minimal binary min-heap of [cost, node].
class MinHeap {
  private h: Array<[number, number]> = [];
  get size() {
    return this.h.length;
  }
  push(item: [number, number]) {
    const h = this.h;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] <= h[i][0]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const h = this.h;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < h.length && h[l][0] < h[s][0]) s = l;
        if (r < h.length && h[r][0] < h[s][0]) s = r;
        if (s === i) break;
        [h[s], h[i]] = [h[i], h[s]];
        i = s;
      }
    }
    return top;
  }
}

function dijkstraSafest(origin: number, dest: number): number[] | null {
  const dist = new Map<number, number>([[origin, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const heap = new MinHeap();
  heap.push([0, origin]);

  while (heap.size > 0) {
    const [cost, node] = heap.pop()!;
    if (done.has(node)) continue;
    done.add(node);
    if (node === dest) return reconstruct(prev, origin, dest);
    for (const n of neighbors(node)) {
      if (done.has(n)) continue;
      const sys = getSystem(n);
      const hopCost = 1 + (sys && securityBand(sys.security) !== 'high' ? NON_HIGH_PENALTY : 0);
      const nd = cost + hopCost;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, node);
        heap.push([nd, n]);
      }
    }
  }
  return null;
}

/** Ordered system ids for the route, or null if unreachable. [origin] if same. */
export function getRoute(origin: number, dest: number, type: RouteType): number[] | null {
  if (origin === dest) return [origin];
  const k = key(origin, dest, type);
  const cached = routeCache.get(k);
  if (cached !== undefined) return cached;
  const route = type === 'shortest' ? bfs(origin, dest) : dijkstraSafest(origin, dest);
  routeCache.set(k, route);
  return route;
}

export function jumpsFromRoute(route: number[] | null): number | null {
  return route === null ? null : Math.max(0, route.length - 1);
}
