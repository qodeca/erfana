// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Confining, diffing watch-set coordinator (Issue #74, work item 31; design
 * §1.4, §5(a)).
 *
 * After each rate-limited post-load pipeline, the preview extracts the static
 * links a page declares and hands them here as candidate paths to watch. This
 * coordinator turns that candidate set into the pool's live watch set:
 *
 *   1. Every candidate is realpath-CONFINED through `confinePath` (item 11) —
 *      the same gate the protocol handler uses. A candidate that resolves
 *      outside the project root, into an excluded directory, or does not exist
 *      is DROPPED, counted into the result's `dropped` list, and left for the
 *      consumer to badge. No watch is acquired for it. Files are DATA: an
 *      out-of-root path is reported, never followed. One exception (#478
 *      QG-11a V2): a candidate that is now `missing` but resolved last time to
 *      a target still watched KEEPS that watch, so the pool tracker that saw
 *      the delete (whose reload brought us here) also sees the file come back
 *      – a `git checkout` that deletes and restores a stylesheet reloads the
 *      page again. The target already passed `confinePath`, and the watch layer
 *      re-checks it on every arm and probe.
 *   2. The confined targets are deduplicated and capped at
 *      `PREVIEW.MAX_WATCHED_FILES` PER PREVIEW (the `preview` watch bucket's
 *      per-owner cap); candidates past it are dropped in input priority order.
 *      Past the bucket's app-wide total a watch is queued by the watch layer,
 *      not dropped, and started when a slot frees (#478, G9).
 *   3. The desired set is diffed against the currently-watched set. Removed
 *      watches are RELEASED and AWAITED BEFORE new watches are acquired, so a
 *      reload storm cannot transiently stack file descriptors (chokidar
 *      `close()` is async).
 *
 * A change on any watched file is coalesced over the `preview` timing
 * profile's `poolCoalesceMs` into a single "reload needed" signal carrying the
 * changed paths, which the consumer (the view service) feeds to
 * `PreviewReloadPolicy`. That coalesce is the preview's only burst control
 * (#478, F21). `recheck()` is the safety net: every watched file is compared
 * with the version last seen (the view shown again; focus and wake reach the
 * pool by themselves).
 *
 * The candidates arrive only after the page has loaded its files, so a file
 * can change before its watch exists. `options.changedSince` – when the page's
 * load began – goes to each watch this call ADDS, and the pool reports such a
 * change once the watch is listening (`PreviewWatchPool.ts`), through the same
 * coalescing as any other.
 */
import { confinePath, type ConfineVerdict } from './previewPathResolve'
import type { IPreviewWatchPool, PreviewWatchStartOptions } from './PreviewWatchPool'
import { PREVIEW } from '../../../shared/constants'
import { TIMING_PROFILES } from '../../../shared/freshness/timingProfiles'

/** Why a candidate was not watched. */
export type WatchDropReason = 'out-of-root' | 'over-cap' | 'watch-failed'

/** A candidate that was dropped rather than watched. */
export interface DroppedCandidate {
  /** The original candidate path as supplied to `setWatchSet`. */
  readonly candidate: string
  readonly reason: WatchDropReason
}

/** The outcome of applying a candidate set. */
export interface WatchSetResult {
  /** The confined, absolute paths now watched by the pool. */
  readonly watched: readonly string[]
  /** Candidates that were not watched, in input priority order. */
  readonly dropped: readonly DroppedCandidate[]
}

/** The realpath-confining gate; injectable so tests need no real filesystem. */
export type ConfineFn = (realRoot: string, candidate: string) => Promise<ConfineVerdict>

export interface PreviewWatchCoordinatorDeps {
  /** The realpath of the project root; every candidate confines against it. */
  readonly realRoot: string
  /** The watch pool this coordinator drives. */
  readonly pool: IPreviewWatchPool
  /** Called once per coalesced burst with the changed (confined) paths. */
  readonly onChanged: (changedPaths: readonly string[]) => void
  /** Confining gate; defaults to `confinePath`. */
  readonly confine?: ConfineFn
  /** Per-preview watch cap; defaults to `PREVIEW.MAX_WATCHED_FILES`. */
  readonly maxWatched?: number
  /** Coalesce window in ms; defaults to the `preview` profile's `poolCoalesceMs`. */
  readonly coalesceMs?: number
  /** Timer scheduler; defaults to `setTimeout`. Injected for tests. */
  readonly setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** Timer canceller; defaults to `clearTimeout`. Injected for tests. */
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface IPreviewWatchCoordinator {
  /**
   * Replace the watch set with the confined subset of `candidatePaths`.
   * Releases removed watches (awaited) before acquiring added ones, and returns
   * the confined paths now watched plus the dropped candidates. `options`
   * reaches each added watch (see the module comment).
   */
  setWatchSet(
    candidatePaths: readonly string[],
    options?: PreviewWatchStartOptions
  ): Promise<WatchSetResult>
  /** Compare every watched file with the version last seen; a change goes through the coalesce (S1). */
  recheck(): void
  /** Release every watch and cancel the pending coalesce timer. */
  dispose(): Promise<void>
}

/**
 * Create a watch coordinator bound to one preview's project root and pool.
 */
export function createPreviewWatchCoordinator(
  deps: PreviewWatchCoordinatorDeps
): IPreviewWatchCoordinator {
  const confine = deps.confine ?? confinePath
  const maxWatched = deps.maxWatched ?? PREVIEW.MAX_WATCHED_FILES
  const coalesceMs = deps.coalesceMs ?? TIMING_PROFILES.preview.poolCoalesceMs
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout

  /** Confined absolute paths currently watched. */
  let watched = new Set<string>()
  /** Each candidate of the current set → the confined target it was watched as (V2). */
  let targetOf = new Map<string, string>()

  // Once disposed, no `setWatchSet` may acquire a watch this coordinator would
  // never release. In-flight calls are tracked so `dispose` can await them.
  let disposed = false
  const inFlight = new Set<Promise<unknown>>()

  const pendingChanges = new Set<string>()
  let coalesceHandle: ReturnType<typeof setTimeout> | null = null

  const clearCoalesce = (): void => {
    if (coalesceHandle !== null) {
      clearTimer(coalesceHandle)
      coalesceHandle = null
    }
  }

  const flushChanges = (): void => {
    clearCoalesce()
    if (pendingChanges.size === 0) return
    const burst = [...pendingChanges]
    pendingChanges.clear()
    deps.onChanged(burst)
  }

  const recordChange = (target: string): void => {
    pendingChanges.add(target)
    if (coalesceHandle === null) {
      coalesceHandle = setTimer(flushChanges, coalesceMs)
    }
  }

  /**
   * A candidate deleted for now keeps the watch it had, so its pool tracker
   * sees the file come back (V2); one that never resolved stays dropped.
   */
  const keptWhileMissing = (candidate: string, verdict: ConfineVerdict): string | null => {
    if (verdict.ok || verdict.reason !== 'missing') return null
    const target = targetOf.get(candidate)
    return target !== undefined && watched.has(target) ? target : null
  }

  /**
   * Confine + dedupe + cap the candidate set into a desired watch set plus the
   * dropped candidates, all preserving input priority order.
   */
  const resolveDesired = async (
    candidatePaths: readonly string[]
  ): Promise<{ desired: string[]; dropped: DroppedCandidate[]; targets: Map<string, string> }> => {
    const desired: string[] = []
    const seen = new Set<string>()
    const rawSeen = new Set<string>()
    const dropped: DroppedCandidate[] = []
    const targets = new Map<string, string>()

    for (const candidate of candidatePaths) {
      // Cheap syntactic dedup first, so a repeated literal costs no realpath.
      if (rawSeen.has(candidate)) continue
      rawSeen.add(candidate)

      // Once the watch set is full, drop the rest as over-cap WITHOUT paying for
      // their realpath confinement — a page with hundreds of links no longer
      // runs hundreds of realpath syscalls on every reload just to discard them.
      if (desired.length >= maxWatched) {
        dropped.push({ candidate, reason: 'over-cap' })
        continue
      }

      const verdict = await confine(deps.realRoot, candidate)
      const target = verdict.ok ? verdict.realTarget : keptWhileMissing(candidate, verdict)
      if (target === null) {
        dropped.push({ candidate, reason: 'out-of-root' })
        continue
      }
      targets.set(candidate, target)
      if (seen.has(target)) continue
      seen.add(target)
      desired.push(target)
    }

    return { desired, dropped, targets }
  }

  const doSetWatchSet = async (
    candidatePaths: readonly string[],
    options: PreviewWatchStartOptions | undefined
  ): Promise<WatchSetResult> => {
    if (disposed) return { watched: [], dropped: [] }
    const { desired, dropped, targets } = await resolveDesired(candidatePaths)
    // A dispose can land on either side of the awaits below. Bailing here (and
    // before the acquire loop) stops a disposed coordinator from acquiring a
    // watch nothing will ever release.
    if (disposed) return { watched: [], dropped }
    const desiredSet = new Set(desired)

    // Release removed watches and AWAIT them before acquiring new ones, so a
    // reload storm cannot transiently stack file descriptors.
    for (const target of watched) {
      if (!desiredSet.has(target)) {
        await deps.pool.release(target)
      }
    }
    if (disposed) return { watched: [], dropped }

    // Acquire the added watches. A watch already held is a no-op refcount bump.
    // `watched` is assigned only on success, so a throw partway through this
    // loop (chokidar on EMFILE — the pool rethrows on purpose) used to strand
    // every watch acquired before it: absent from `watched`, unreachable by
    // `dispose()`, holding its slot in the shared budget for the life of the
    // process (#112). Release what THIS call acquired before rethrowing.
    const acquired: string[] = []
    try {
      for (const target of desired) {
        if (!watched.has(target)) {
          deps.pool.acquire(target, () => recordChange(target), options)
          acquired.push(target)
        }
      }
    } catch (error) {
      for (const target of acquired) {
        await deps.pool.release(target)
      }
      throw error
    }

    watched = desiredSet
    targetOf = targets
    return { watched: desired, dropped }
  }

  return {
    setWatchSet(
      candidatePaths: readonly string[],
      options?: PreviewWatchStartOptions
    ): Promise<WatchSetResult> {
      const op = doSetWatchSet(candidatePaths, options)
      inFlight.add(op)
      void op.catch(() => {}).finally(() => inFlight.delete(op))
      return op
    },

    recheck(): void {
      if (!disposed) deps.pool.recheck()
    },

    async dispose(): Promise<void> {
      disposed = true
      // Let any in-flight setWatchSet observe `disposed` and unwind before we
      // release, so a late acquire cannot outlive this dispose.
      await Promise.allSettled([...inFlight])
      clearCoalesce()
      pendingChanges.clear()
      for (const target of watched) {
        await deps.pool.release(target)
      }
      watched = new Set<string>()
      targetOf = new Map<string, string>()
      // The pool is this view's own (built per coordinator at the composition
      // root) and had no production caller for `close()` at all (#112): anything
      // it still holds would outlive the view.
      await deps.pool.close()
    }
  }
}
