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
 *      out-of-root path is reported, never followed.
 *   2. The confined targets are deduplicated and capped at
 *      `PREVIEW.MAX_WATCHED_FILES` PER PREVIEW (additive to the app-wide cap);
 *      candidates past the cap are dropped in input priority order.
 *   3. The desired set is diffed against the currently-watched set. Removed
 *      watches are RELEASED and AWAITED BEFORE new watches are acquired, so a
 *      reload storm cannot transiently stack file descriptors (chokidar
 *      `close()` is async).
 *
 * A change on any watched file is coalesced over `PREVIEW.WATCH_COALESCE_MS`
 * into a single "reload needed" signal carrying the changed paths, which the
 * consumer (the view service) feeds to `PreviewReloadPolicy`.
 */
import type { ConfineVerdict } from '../../../shared/ipc/preview-types'
import { confinePath } from './previewPathResolve'
import type { IPreviewWatchPool } from './PreviewWatchPool'
import { PREVIEW } from '../../../shared/constants'

/** Why a candidate was not watched. */
export type WatchDropReason = 'out-of-root' | 'over-cap'

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
  /** Coalesce window in ms; defaults to `PREVIEW.WATCH_COALESCE_MS`. */
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
   * the confined paths now watched plus the dropped candidates.
   */
  setWatchSet(candidatePaths: readonly string[]): Promise<WatchSetResult>
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
  const coalesceMs = deps.coalesceMs ?? PREVIEW.WATCH_COALESCE_MS
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout

  /** Confined absolute paths currently watched. */
  let watched = new Set<string>()

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
   * Confine + dedupe + cap the candidate set into a desired watch set plus the
   * dropped candidates, all preserving input priority order.
   */
  const resolveDesired = async (
    candidatePaths: readonly string[]
  ): Promise<{ desired: string[]; dropped: DroppedCandidate[] }> => {
    const desired: string[] = []
    const seen = new Set<string>()
    const dropped: DroppedCandidate[] = []

    for (const candidate of candidatePaths) {
      const verdict = await confine(deps.realRoot, candidate)
      if (!verdict.ok) {
        dropped.push({ candidate, reason: 'out-of-root' })
        continue
      }
      const target = verdict.realTarget
      if (seen.has(target)) continue
      seen.add(target)
      if (desired.length >= maxWatched) {
        dropped.push({ candidate, reason: 'over-cap' })
        continue
      }
      desired.push(target)
    }

    return { desired, dropped }
  }

  return {
    async setWatchSet(candidatePaths: readonly string[]): Promise<WatchSetResult> {
      const { desired, dropped } = await resolveDesired(candidatePaths)
      const desiredSet = new Set(desired)

      // Release removed watches and AWAIT them before acquiring new ones, so a
      // reload storm cannot transiently stack file descriptors.
      for (const target of watched) {
        if (!desiredSet.has(target)) {
          await deps.pool.release(target)
        }
      }

      // Acquire the added watches. A watch already held is a no-op refcount bump.
      for (const target of desired) {
        if (!watched.has(target)) {
          deps.pool.acquire(target, () => recordChange(target))
        }
      }

      watched = desiredSet
      return { watched: desired, dropped }
    },

    async dispose(): Promise<void> {
      clearCoalesce()
      pendingChanges.clear()
      for (const target of watched) {
        await deps.pool.release(target)
      }
      watched = new Set<string>()
    }
  }
}
