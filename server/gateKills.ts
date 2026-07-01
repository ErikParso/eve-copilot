// Live per-STARGATE ship-kill counts over a rolling 60-minute window, fed by the
// zKillboard RedisQ firehose. A kill is counted only if it happened AT a stargate
// (its zkb.locationID resolves to a gate in the SDE) — station, belt, plex and
// mission kills are dropped, which is the whole point: a hauler is threatened at
// gates, not by a busy trade hub's station games.
//
// No boot backfill: RedisQ streams forward-only, so the window fills over the
// first hour (warm-up). getGateKills() returns the current gateId -> count
// snapshot; danger/enrich resolve each route system's inbound/outbound gate ids
// against it.
import { isStargate, getGateConnection, getSystem, securityBand, type SecurityBand } from './sde.js';

const WINDOW_MS = 60 * 60 * 1000;
// Server start ≈ feed start: the in-memory window is empty on boot and fills over
// the first hour. Used to report warm-up progress ("collecting for last N min").
const startedAt = Date.now();
const UA = 'eve-multitool/1.0 (parsoerik@gmail.com)';
// RedisQ long-poll endpoint. Overridable if the hosted instance moves (zKill has
// relocated it before). A stable queueID resumes the stream across restarts.
const REDISQ_URL = process.env.REDISQ_URL ?? 'https://redisq.zkillboard.com/listen.php';
const QUEUE_ID = process.env.REDISQ_QUEUE_ID ?? 'eve-multitool';
const TTW = 10; // seconds the server holds the long-poll open before returning null

// gateId -> ascending kill timestamps (ms). Pruned to the window on read & insert.
const hits = new Map<number, number[]>();

// --- Test override for E2E tests (merged on top of live data) ---
let testOverride: Map<number, number> | null = null;
/** Inject test gate-kill counts (keyed by stargate itemId). */
export function setTestKills(kills: Map<number, number>): void {
  testOverride = kills;
}
/** Clear the test override. */
export function clearTestKills(): void {
  testOverride = null;
}

function record(gateId: number, tsMs: number): void {
  let arr = hits.get(gateId);
  if (!arr) {
    arr = [];
    hits.set(gateId, arr);
  }
  arr.push(tsMs);
}

/** Drop timestamps older than the window; forget gates that fall empty. */
function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [gate, arr] of hits) {
    let i = 0;
    while (i < arr.length && arr[i] < cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length === 0) hits.delete(gate);
  }
}

/** Current snapshot: stargate itemId -> kills in the last 60 minutes. */
export async function getGateKills(): Promise<Map<number, number>> {
  const now = Date.now();
  prune(now);
  const out = new Map<number, number>();
  for (const [gate, arr] of hits) out.set(gate, arr.length);
  if (testOverride) for (const [k, v] of testOverride) out.set(k, v);
  return out;
}

/** One outbound gate from a system, with recent kill count. */
export interface GateKillEntry {
  destSystemId: number;
  destName: string;
  kills: number;
}
/** A system with recent gate kills, and the per-gate breakdown. */
export interface SystemGateKills {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  totalKills: number;
  gates: GateKillEntry[];
}
/** The "Kill Data" report: systems with gate kills (desc), plus warm-up status. */
export interface GateKillReport {
  /** Window the data covers: 60 once warm, else minutes elapsed since boot. */
  windowMinutes: number;
  /** True while the window is still filling (elapsed < 60 min). */
  warmingUp: boolean;
  /** Whole minutes since the feed started collecting. */
  elapsedMinutes: number;
  /** Σ kills across every gate in the window. */
  totalGateKills: number;
  systems: SystemGateKills[];
}

/**
 * Group the current window's gate kills by system for the Kill Data page: only
 * systems with kills, each with its per-gate ("to destination") breakdown, both
 * the systems and their gates sorted by kill count descending.
 */
export function getGateKillReport(): GateKillReport {
  const now = Date.now();
  prune(now);

  // gateId -> count (live window + any test override), same basis as getGateKills.
  const counts = new Map<number, number>();
  for (const [gate, arr] of hits) counts.set(gate, arr.length);
  if (testOverride) for (const [gate, c] of testOverride) counts.set(gate, c);

  const bySystem = new Map<number, SystemGateKills>();
  let totalGateKills = 0;
  for (const [gateId, kills] of counts) {
    if (kills <= 0) continue;
    const conn = getGateConnection(gateId);
    if (!conn) continue;
    totalGateKills += kills;
    let entry = bySystem.get(conn.sys);
    if (!entry) {
      const sys = getSystem(conn.sys);
      const security = sys?.security ?? 0;
      entry = {
        systemId: conn.sys,
        name: sys?.name ?? `System ${conn.sys}`,
        security,
        securityBand: securityBand(security),
        totalKills: 0,
        gates: [],
      };
      bySystem.set(conn.sys, entry);
    }
    entry.totalKills += kills;
    entry.gates.push({
      destSystemId: conn.dest,
      destName: getSystem(conn.dest)?.name ?? `System ${conn.dest}`,
      kills,
    });
  }

  const systems = [...bySystem.values()].sort((a, b) => b.totalKills - a.totalKills);
  for (const s of systems) s.gates.sort((a, b) => b.kills - a.kills);

  const elapsedMs = now - startedAt;
  const warmingUp = elapsedMs < WINDOW_MS;
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  return {
    windowMinutes: warmingUp ? elapsedMinutes : 60,
    warmingUp,
    elapsedMinutes,
    totalGateKills,
    systems,
  };
}

interface RedisQPackage {
  killID?: number;
  killmail?: { killmail_time?: string };
  zkb?: { locationID?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOG = '[gate-kills]';
const HEARTBEAT_MS = 5 * 60 * 1000; // periodic "still alive" summary during quiet spells
let recordedTotal = 0; // gate kills recorded since boot (across the whole feed)
let consecutiveFailures = 0;
let lastHeartbeatAt = Date.now();

/** Log a periodic summary so the feed is visibly alive even with no recent kills. */
function maybeHeartbeat(now: number): void {
  if (now - lastHeartbeatAt < HEARTBEAT_MS) return;
  lastHeartbeatAt = now;
  prune(now);
  console.log(
    `${LOG} heartbeat: ${hits.size} gate(s) active in the 60m window, ${recordedTotal} kill(s) recorded since boot.`,
  );
}

/** Long-poll RedisQ forever, recording each gate kill into the rolling window. */
async function pollLoop(): Promise<void> {
  const url = `${REDISQ_URL}?queueID=${encodeURIComponent(QUEUE_ID)}&ttw=${TTW}`;
  for (;;) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        consecutiveFailures++;
        console.warn(`${LOG} RedisQ HTTP ${res.status} ${res.statusText} (failure #${consecutiveFailures}); retrying in 2s.`);
        await sleep(2000);
        continue;
      }
      const body = (await res.json()) as { package: RedisQPackage | null };
      if (consecutiveFailures > 0) {
        console.log(`${LOG} RedisQ recovered after ${consecutiveFailures} failure(s).`);
        consecutiveFailures = 0;
      }
      const pkg = body?.package;
      if (pkg) {
        const loc = pkg.zkb?.locationID;
        if (typeof loc === 'number' && isStargate(loc)) {
          const parsed = pkg.killmail?.killmail_time ? Date.parse(pkg.killmail.killmail_time) : NaN;
          record(loc, Number.isFinite(parsed) ? parsed : Date.now());
          recordedTotal++;
          const conn = getGateConnection(loc);
          const from = conn ? (getSystem(conn.sys)?.name ?? `System ${conn.sys}`) : `gate ${loc}`;
          const to = conn ? (getSystem(conn.dest)?.name ?? `System ${conn.dest}`) : '?';
          const atGate = hits.get(loc)?.length ?? 1;
          console.log(
            `${LOG} recorded kill at ${from} → ${to} gate (killID ${pkg.killID ?? '?'}); ${atGate} at this gate, ${recordedTotal} total since boot.`,
          );
        }
      }
      // package === null → the long-poll timed out with no kill; reconnect at once.
      maybeHeartbeat(Date.now());
    } catch (err) {
      consecutiveFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG} RedisQ poll failed (failure #${consecutiveFailures}): ${msg}; retrying in 3s.`);
      await sleep(3000);
    }
  }
}

/** Start the background RedisQ feed. No-op under OFFLINE (tests use the override). */
export function startGateKillFeed(): void {
  if (process.env.OFFLINE === 'true') {
    console.log(`${LOG} OFFLINE mode — RedisQ feed disabled (danger uses injected test kills).`);
    return;
  }
  console.log(
    `${LOG} starting RedisQ feed at ${REDISQ_URL} (queue "${QUEUE_ID}", ${WINDOW_MS / 60000}m rolling window; warms up over the first hour).`,
  );
  pollLoop().catch((err) => {
    // The inner loop swallows all per-request failures, so reaching here is
    // unexpected — log loudly and restart the loop rather than going dark.
    console.error(`${LOG} feed loop crashed unexpectedly; restarting in 5s:`, err);
    setTimeout(startGateKillFeed, 5000);
  });
}
