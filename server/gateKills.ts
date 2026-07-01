// Live per-STARGATE ship-kill counts over a rolling 60-minute window, fed by
// zKillboard's R2Z2 killmail feed. A kill is counted only if it happened AT a
// stargate (its zkb.locationID resolves to a gate in the SDE) — station, belt,
// plex and mission kills are dropped, which is the whole point: a hauler is
// threatened at gates, not by a busy trade hub's station games.
//
// R2Z2 is the successor to RedisQ (RedisQ's zkillredisq.stream host is on the
// `.stream` TLD, which some DNS ad/malware blockers sinkhole to 127.0.0.1). R2Z2
// lives on zkillboard.com and is a sequence-poll feed: read the current sequence,
// then fetch ephemeral/{seq}.json, advancing on 200 and waiting on 404 (caught
// up). We start at the current sequence → forward-only, so the window fills over
// the first hour (warm-up). getGateKills() returns the current gateId -> count
// snapshot; danger/enrich resolve each route system's inbound/outbound gate ids
// against it.
import { isStargate, getGateConnection, getSystem, securityBand, type SecurityBand } from './sde.js';
import type { GateKillData } from './types.js';

// Two horizons off the same per-gate timestamp list: a reactive 60-min count
// ("camp right now") and a 24-hour average kills/hour ("habitual chokepoint").
const RECENT_WINDOW_MS = 60 * 60 * 1000;
const LONG_WINDOW_MS = 24 * 60 * 60 * 1000;
// Server start ≈ feed start: the in-memory window is empty on boot and fills over
// the first hour (recent) / 24h (baseline). Used for warm-up progress + to keep
// the baseline average from being inflated by a near-empty early window.
const startedAt = Date.now();
const UA = 'eve-multitool/1.0 (parsoerik@gmail.com)';
// R2Z2 base URL. Overridable if the host moves. Endpoints:
//   /ephemeral/sequence.json  → { sequence } (latest)
//   /ephemeral/{seq}.json     → one killmail (404 once you've caught up)
const R2Z2_BASE = process.env.R2Z2_URL ?? 'https://r2z2.zkillboard.com';
const POLL_MS = 6000; // R2Z2's minimum interval between attempts after a 404

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

/** Drop timestamps older than the long (24h) window; forget gates that fall empty. */
function prune(now: number): void {
  const cutoff = now - LONG_WINDOW_MS;
  for (const [gate, arr] of hits) {
    let i = 0;
    while (i < arr.length && arr[i] < cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length === 0) hits.delete(gate);
  }
}

/** Hours to divide the 24h count by for the baseline average, clamped to [1,24]
 *  so a near-empty early window doesn't inflate the per-hour rate during warm-up. */
function baselineHours(now: number): number {
  return Math.min(24, Math.max(1, (now - startedAt) / 3_600_000));
}

/** Recent count (last 60 min) for one gate's ascending timestamp list. */
function recentCount(arr: number[], now: number): number {
  const cutoff = now - RECENT_WINDOW_MS;
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && arr[i] >= cutoff; i--) n++;
  return n;
}

/**
 * Current snapshot: per stargate itemId, kills in the last 60 min (`recent`) and
 * the average kills/hour over the last 24h (`baseline`), both derived from the
 * one pruned timestamp list.
 */
export async function getGateKills(): Promise<GateKillData> {
  const now = Date.now();
  prune(now);
  const denomHours = baselineHours(now);
  const recent = new Map<number, number>();
  const baseline = new Map<number, number>();
  for (const [gate, arr] of hits) {
    const rc = recentCount(arr, now);
    if (rc > 0) recent.set(gate, rc);
    baseline.set(gate, arr.length / denomHours);
  }
  if (testOverride) for (const [k, v] of testOverride) recent.set(k, v);
  return { recent, baseline };
}

/** Cap on how many systems the Kill Data page returns (busiest first). */
const REPORT_SYSTEM_CAP = 200;

/** One outbound gate from a system: recent (60m) kills and 24h average kills/h. */
export interface GateKillEntry {
  destSystemId: number;
  destName: string;
  recentKills: number;
  baselineRate: number;
}
/** A system with gate kills, and the per-gate breakdown. */
export interface SystemGateKills {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  /** Σ recent (60m) kills across the system's gates. */
  recentKills: number;
  /** Σ 24h average kills/h across the system's gates. */
  baselineRate: number;
  gates: GateKillEntry[];
}
/** The "Kill Data" report: systems with gate activity (busiest first) + warm-up status. */
export interface GateKillReport {
  /** Recent window the headline covers: 60 once warm, else minutes elapsed since boot. */
  windowMinutes: number;
  /** True while the recent window is still filling (elapsed < 60 min). */
  warmingUp: boolean;
  /** Whole minutes since the feed started collecting. */
  elapsedMinutes: number;
  /** Σ recent (60m) kills across every gate. */
  totalGateKills: number;
  systems: SystemGateKills[];
}

/**
 * Group the 24h window's gate kills by system for the Kill Data page: every
 * system with gate activity, each with its per-gate ("to destination") breakdown
 * of recent (60m) kills and 24h average kills/h. Systems and gates are sorted by
 * recent kills first, then baseline. Capped to the busiest REPORT_SYSTEM_CAP.
 */
export function getGateKillReport(): GateKillReport {
  const now = Date.now();
  prune(now);
  const recent = new Map<number, number>();
  const baseline = new Map<number, number>();
  const denomHours = baselineHours(now);
  for (const [gate, arr] of hits) {
    const rc = recentCount(arr, now);
    if (rc > 0) recent.set(gate, rc);
    baseline.set(gate, arr.length / denomHours);
  }
  if (testOverride) for (const [gate, c] of testOverride) recent.set(gate, c);

  const bySystem = new Map<number, SystemGateKills>();
  let totalGateKills = 0;
  // Union of gates seen recently or over 24h (recent may include test overrides).
  const gateIds = new Set<number>([...recent.keys(), ...baseline.keys()]);
  for (const gateId of gateIds) {
    const conn = getGateConnection(gateId);
    if (!conn) continue;
    const recentKills = recent.get(gateId) ?? 0;
    const baselineRate = baseline.get(gateId) ?? 0;
    if (recentKills <= 0 && baselineRate <= 0) continue;
    totalGateKills += recentKills;
    let entry = bySystem.get(conn.sys);
    if (!entry) {
      const sys = getSystem(conn.sys);
      const security = sys?.security ?? 0;
      entry = {
        systemId: conn.sys,
        name: sys?.name ?? `System ${conn.sys}`,
        security,
        securityBand: securityBand(security),
        recentKills: 0,
        baselineRate: 0,
        gates: [],
      };
      bySystem.set(conn.sys, entry);
    }
    entry.recentKills += recentKills;
    entry.baselineRate += baselineRate;
    entry.gates.push({
      destSystemId: conn.dest,
      destName: getSystem(conn.dest)?.name ?? `System ${conn.dest}`,
      recentKills,
      baselineRate,
    });
  }

  const byActivity = (a: { recentKills: number; baselineRate: number }, b: typeof a) =>
    b.recentKills - a.recentKills || b.baselineRate - a.baselineRate;
  const systems = [...bySystem.values()].sort(byActivity).slice(0, REPORT_SYSTEM_CAP);
  for (const s of systems) s.gates.sort(byActivity);

  const elapsedMs = now - startedAt;
  const warmingUp = elapsedMs < RECENT_WINDOW_MS;
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  return {
    windowMinutes: warmingUp ? elapsedMinutes : 60,
    warmingUp,
    elapsedMinutes,
    totalGateKills,
    systems,
  };
}

/** One R2Z2 ephemeral killmail file. The ESI killmail sits under `esi`. */
interface R2Z2Killmail {
  killmail_id?: number;
  esi?: { killmail_time?: string };
  zkb?: { locationID?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOG = '[gate-kills]';
const HEARTBEAT_MS = 5 * 60 * 1000; // periodic "still alive" summary during quiet spells
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60000; // cap: a dead endpoint retries once a minute, not every 3s
let recordedTotal = 0; // gate kills recorded since boot (across the whole feed)
let consecutiveFailures = 0;
let lastHeartbeatAt = Date.now();

/** Exponential backoff (2s → 4s → … → 60s cap) so a persistent outage doesn't spam. */
function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(Math.max(0, failures - 1), 5));
}

/** Unwrap fetch's generic "fetch failed" to the underlying cause (ENOTFOUND, ECONNREFUSED, TLS…). */
function errDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause: unknown = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return `${err.message}: ${cause.message}${code ? ` (${code})` : ''}`;
  }
  return cause ? `${err.message}: ${String(cause)}` : err.message;
}

/** Log a periodic summary so the feed is visibly alive even with no recent kills. */
function maybeHeartbeat(now: number): void {
  if (now - lastHeartbeatAt < HEARTBEAT_MS) return;
  lastHeartbeatAt = now;
  prune(now);
  console.log(
    `${LOG} heartbeat: ${hits.size} gate(s) active in the 24h window, ${recordedTotal} kill(s) recorded since boot.`,
  );
}

/** Record one killmail if it happened at a stargate. */
function ingest(km: R2Z2Killmail): void {
  const loc = km.zkb?.locationID;
  if (typeof loc !== 'number' || !isStargate(loc)) return;
  const parsed = km.esi?.killmail_time ? Date.parse(km.esi.killmail_time) : NaN;
  record(loc, Number.isFinite(parsed) ? parsed : Date.now());
  recordedTotal++;
  const conn = getGateConnection(loc);
  const from = conn ? (getSystem(conn.sys)?.name ?? `System ${conn.sys}`) : `gate ${loc}`;
  const to = conn ? (getSystem(conn.dest)?.name ?? `System ${conn.dest}`) : '?';
  const atGate = hits.get(loc)?.length ?? 1;
  console.log(
    `${LOG} recorded kill at ${from} → ${to} gate (killID ${km.killmail_id ?? '?'}); ${atGate} at this gate, ${recordedTotal} total since boot.`,
  );
}

/** Fetch R2Z2's current sequence number (latest killmail id). */
async function fetchCurrentSequence(): Promise<number> {
  const res = await fetch(`${R2Z2_BASE}/ephemeral/sequence.json`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`sequence.json HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { sequence?: number };
  if (typeof body.sequence !== 'number') throw new Error('sequence.json missing a numeric sequence');
  return body.sequence;
}

/** Poll R2Z2 forever from the current sequence, recording gate kills as they arrive. */
async function pollLoop(): Promise<void> {
  // Start at the current sequence → forward-only (the window warms over the hour).
  let seq = -1;
  while (seq < 0) {
    try {
      seq = await fetchCurrentSequence();
    } catch (err) {
      consecutiveFailures++;
      const wait = backoffMs(consecutiveFailures);
      console.warn(
        `${LOG} could not read start sequence (failure #${consecutiveFailures}): ${errDetail(err)}; retrying in ${wait / 1000}s.`,
      );
      await sleep(wait);
    }
  }
  consecutiveFailures = 0;
  console.log(`${LOG} streaming from sequence ${seq}.`);

  for (;;) {
    try {
      const res = await fetch(`${R2Z2_BASE}/ephemeral/${seq}.json`, { headers: { 'User-Agent': UA } });
      if (res.status === 404) {
        // Caught up — no killmail at this sequence yet. Wait the min interval, retry same seq.
        if (consecutiveFailures > 0) {
          console.log(`${LOG} R2Z2 recovered after ${consecutiveFailures} failure(s).`);
          consecutiveFailures = 0;
        }
        maybeHeartbeat(Date.now());
        await sleep(POLL_MS);
        continue;
      }
      if (!res.ok) {
        consecutiveFailures++;
        const wait = backoffMs(consecutiveFailures);
        console.warn(
          `${LOG} R2Z2 HTTP ${res.status} ${res.statusText} at seq ${seq} (failure #${consecutiveFailures}); retrying in ${wait / 1000}s.`,
        );
        await sleep(wait);
        continue;
      }
      const km = (await res.json()) as R2Z2Killmail;
      if (consecutiveFailures > 0) {
        console.log(`${LOG} R2Z2 recovered after ${consecutiveFailures} failure(s).`);
        consecutiveFailures = 0;
      }
      ingest(km);
      seq++; // advance to the next killmail
      maybeHeartbeat(Date.now());
    } catch (err) {
      consecutiveFailures++;
      const wait = backoffMs(consecutiveFailures);
      console.warn(
        `${LOG} R2Z2 poll failed at seq ${seq} (failure #${consecutiveFailures}): ${errDetail(err)}; retrying in ${wait / 1000}s.`,
      );
      await sleep(wait);
    }
  }
}

/** Start the background R2Z2 feed. No-op under OFFLINE (tests use the override). */
export function startGateKillFeed(): void {
  if (process.env.OFFLINE === 'true') {
    console.log(`${LOG} OFFLINE mode — killmail feed disabled (danger uses injected test kills).`);
    return;
  }
  console.log(
    `${LOG} starting R2Z2 feed at ${R2Z2_BASE} (60m recent + 24h baseline windows; warms up over the first hour/day).`,
  );
  pollLoop().catch((err) => {
    // The inner loop swallows all per-request failures, so reaching here is
    // unexpected — log loudly and restart the loop rather than going dark.
    console.error(`${LOG} feed loop crashed unexpectedly; restarting in 5s:`, err);
    setTimeout(startGateKillFeed, 5000);
  });
}
