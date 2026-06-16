// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared base for the per-OS Claude Code process detectors (#217 hardening).
 *
 * Owns the parts that were duplicated near-verbatim across the macOS and Windows
 * detectors: pid validation, the descendant BFS over a process snapshot, and the
 * short-TTL liveness cache. Subclasses supply only the OS-specific probe
 * ({@link computeDetection}), their cache TTL, and their cwd capability.
 *
 * Cache semantics (review findings #1/#2/#8):
 *  - single-flight: the in-flight Promise is cached BEFORE the await, so N
 *    concurrent callers on one rootPid share one probe rather than dog-piling the
 *    expensive process spawn.
 *  - definite results (a completed snapshot, claude found or not) are cached for
 *    the TTL; transient failures (spawn/timeout/ENOBUFS) are NOT cached — the
 *    entry is evicted on settle so the next call retries instead of blacking the
 *    bar out for a full TTL.
 *  - bounded growth: {@link forget} drops a retired PTY's entry, an expired entry
 *    is swept on read, and a size cap backstops a pathological pid leak.
 *
 * @see docs/designs/216-claude-status-bar.md §4, §10
 */
import type { ClaudeDetection, IClaudeProcessDetector } from './types'
import type { ExecLike } from './exec'

/** Minimum shape the descendant BFS needs from a process-snapshot row. */
export interface ProcRow {
  pid: number
  ppid: number
}

/** A cached liveness entry holding the in-flight-or-settled probe (single-flight). */
interface CacheEntry {
  promise: Promise<ClaudeDetection>
  expiresAt: number
}

/**
 * Hard cap on cached entries — a backstop against a pathological pid leak if a
 * caller never calls {@link forget}. Far above any realistic number of live
 * terminals; when exceeded, expired entries are swept.
 */
const MAX_CACHE_ENTRIES = 256

export abstract class AbstractClaudeProcessDetector implements IClaudeProcessDetector {
  /** Per-rootPid short-TTL liveness cache. Invalid pids are never cached. */
  private readonly cache = new Map<number, CacheEntry>()

  /**
   * @param exec Injected exec (each subclass passes its real `execFile` default;
   *   mocked in tests).
   * @param now Injected clock (defaults to `Date.now`) so tests control TTL
   *   expiry deterministically.
   */
  constructor(
    protected exec: ExecLike,
    protected now: () => number = Date.now
  ) {}

  /** Per-OS liveness cache TTL (ms). Win is higher to absorb PowerShell cold-start. */
  protected abstract readonly livenessTtlMs: number

  /**
   * Whether this detector resolves the matched process's *live* cwd. macOS does
   * (via lsof); Windows v1 does not, so callers must fall back to the spawn cwd.
   */
  abstract readonly resolvesLiveCwd: boolean

  /**
   * OS-specific liveness probe. MUST reject/throw on a TRANSIENT failure (spawn
   * error, timeout, ENOBUFS) so the base can avoid caching it; MUST resolve a
   * DEFINITE `ClaudeDetection` (running true/false) when the snapshot completed —
   * including the "ran but no claude descendant" case.
   */
  protected abstract computeDetection(rootPid: number): Promise<ClaudeDetection>

  async isClaudeRunning(rootPid: number): Promise<ClaudeDetection> {
    if (!isValidPid(rootPid)) return { running: false }

    const cached = this.cache.get(rootPid)
    if (cached !== undefined) {
      if (this.now() < cached.expiresAt) return cached.promise
      this.cache.delete(rootPid) // sweep this expired entry before recomputing
    }

    // Single-flight: tag the probe so a transient throw is distinguishable from a
    // definite result, cache the in-flight promise BEFORE awaiting (so concurrent
    // callers coalesce), then evict on a transient failure so it is never served
    // stale for the full TTL.
    const tagged = this.computeDetection(rootPid).then(
      (value) => ({ value, transient: false }),
      () => ({ value: { running: false } as ClaudeDetection, transient: true })
    )
    const entry: CacheEntry = {
      promise: tagged.then((r) => r.value),
      expiresAt: this.now() + this.livenessTtlMs,
    }
    this.evictIfFull()
    this.cache.set(rootPid, entry)
    void tagged.then((r) => {
      if (r.transient && this.cache.get(rootPid) === entry) this.cache.delete(rootPid)
    })
    return entry.promise
  }

  /** Drop a retired pid's cache entry (call on PTY unregister to bound growth). */
  forget(rootPid: number): void {
    this.cache.delete(rootPid)
  }

  /** Clear the liveness cache (test helper; entries also expire naturally). */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * BFS the descendants of `rootPid` and return the first row whose `matches`
   * predicate is true, or undefined. Returning the ROW (not just the pid) lets a
   * subclass read snapshot-resident fields (e.g. the Windows start time) off the
   * same row. Cycle-safe via a `visited` set; short-circuits on the first match.
   */
  protected findClaudeDescendant<R extends ProcRow>(
    rows: R[],
    rootPid: number,
    matches: (row: R) => boolean
  ): R | undefined {
    const childrenByPpid = new Map<number, R[]>()
    for (const row of rows) {
      const siblings = childrenByPpid.get(row.ppid)
      if (siblings) siblings.push(row)
      else childrenByPpid.set(row.ppid, [row])
    }

    const queue: number[] = [rootPid]
    const visited = new Set<number>([rootPid])
    while (queue.length > 0) {
      const ppid = queue.shift() as number
      const children = childrenByPpid.get(ppid)
      if (!children) continue
      for (const child of children) {
        if (matches(child)) return child
        if (!visited.has(child.pid)) {
          visited.add(child.pid)
          queue.push(child.pid)
        }
      }
    }
    return undefined
  }

  /** Sweep expired entries when the map exceeds the cap (cheap leak backstop). */
  private evictIfFull(): void {
    if (this.cache.size < MAX_CACHE_ENTRIES) return
    const nowMs = this.now()
    for (const [pid, entry] of this.cache) {
      if (nowMs >= entry.expiresAt) this.cache.delete(pid)
    }
  }
}

/** Integer, strictly positive — guards the public arg and any per-pid probe. */
export function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0
}
