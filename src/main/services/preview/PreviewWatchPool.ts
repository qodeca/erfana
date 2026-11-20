// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview-owned single-file watch pool (Issue #74, work item 30; design §1.4).
 *
 * The files a previewed page loads (CSS, JS, images) are watched through the
 * one watch layer, `FileWatcherService` (#478 plan S17, F2): the pool is one
 * **in-process owner** there, subscribing with the `preview` profile, so the
 * preview keeps its 50 ms write-finish gate and draws from the `preview`
 * bucket – 16 files per owner (this view) and 64 across every view, the
 * process-wide ceiling the old `previewWatchBudget` kept. Past the bucket a
 * file is queued, not refused: the layer starts it when a slot frees (G9),
 * and until then the safety net ({@link IPreviewWatchPool.recheck}) covers it.
 * The layer also suspends and restores the watches across a project switch
 * (G1), re-arms them after a wake (G8) and re-checks their identity in its
 * health round (G4) – nothing of that lives here.
 *
 * Each watched file is followed by a freshness tracker – the same
 * `createTrackedFileWatch` the page file uses (#478 decision 48) – on a view
 * of the pool's one source, so ids, the one automatic restart, the queued
 * path, catch-up after `started` / `restarted`, the delete confirmation and
 * the settled reads are the tracker's, not the pool's. Its version is a
 * stat-only stamp (`statStamp.ts`): the page re-reads the file itself on a
 * reload, so a change costs one `stat` before the reload, no read or hash.
 * A change, a confirmed delete and the file back all fan out to the caller's
 * `onChange`; a watch that stops or cannot read its file has no badge of its
 * own. A watched file is DATA: its path only triggers a signal, it is never
 * executed here. The pool keeps no burst control of its own: the
 * coordinator's coalesce is the preview's only one (F21).
 *
 * The pool is refcounted: acquiring an already-watched path bumps a count and
 * reuses the one tracker; releasing decrements and ends it only when the count
 * reaches zero. `release`, `releaseAll` and `close` are async and must be
 * awaited – they resolve once the tracker's subscription is ended – so the
 * coordinator (item 31), which awaits releases before new acquires, cannot
 * stack watches transiently in a reload storm.
 *
 * A new watch can catch up on its page's load (`changedSince`). The preview
 * learns a page's files only after the page has loaded them, and no stamp of
 * the version the page loaded exists, so the tracker's baseline is chosen by
 * time: a file modified since the load began ({@link WATCH_CATCH_UP_SLACK_MS}
 * either side, so a file stamped in the future – an archive, a share with a
 * fast clock – is not taken as a save) starts with no baseline, and the
 * tracker's catch-up reports it once its watch is live. Any other file starts
 * from its stamp now, and from there on every comparison is by stamp.
 */
import { randomUUID } from 'node:crypto'
import { realClock, type Clock } from '../../../shared/clock'
import type { CheckReason, FileStamp, FreshnessState, ReadOutcome } from '../../../shared/freshness/freshnessTypes'
import type { Checkable } from '../../../shared/freshness/freshnessRegistry'
import { logger } from '../LoggingService'
import { registerMainTracker } from '../freshness/mainFreshnessRegistry'
import {
  createMainFreshnessSource,
  type MainFreshnessSource,
  type MainFreshnessSourceFactory
} from '../freshness/mainFreshnessSource'
import { createTrackedFileWatch, type TrackedWatchHandle } from '../freshness/mainTrackedWatch'
import { readStatStampOutcome } from '../freshness/statStamp'

/**
 * Tolerance either side of the clock when a new watch checks whether its file
 * changed since the page's load began (ms). A file's stamp comes from a
 * coarser clock than `Date.now()`: on the emulated Windows box a write was
 * stamped up to 19 ms before the clock read just ahead of it, and up to 3 ms
 * after the read just behind it (400 writes).
 */
export const WATCH_CATCH_UP_SLACK_MS = 50

/** How a new watch closes the gap before it was listening (module comment). */
export interface PreviewWatchStartOptions {
  /**
   * When the page's load began, in the pool clock's milliseconds. Once the
   * new watch is live, a file modified since then is reported as one change.
   * Absent: the file's stamp now is the baseline.
   */
  readonly changedSince?: number
}

export interface PreviewWatchPoolDeps {
  /** The watch layer, as this view's in-process owner; a main source on `FileWatcherService` by default. */
  readonly createSource?: MainFreshnessSourceFactory
  /** Mints a subscription id; a UUID by default. */
  readonly newId?: () => string
  /** Adds the pool to the main safety net (window focus); `registerMainTracker` by default. */
  readonly register?: (member: Checkable) => () => void
  /** Reads a file's version (and, for a new watch, its baseline); a stat-only stamp by default. */
  readonly read?: (realPath: string) => Promise<ReadOutcome<FileStamp>>
  /** The trackers' timers, and the clock `changedSince` is read on; the real clock by default. */
  readonly clock?: Clock
}

export interface IPreviewWatchPool {
  /**
   * Watch `filePath`, invoking `onChange` on every change, confirmed delete
   * and return. Refcounted: re-acquiring an already-watched path bumps the
   * count and keeps the original handler. Always `true`: a file past the
   * `preview` bucket is queued by the watch layer and started when a slot
   * frees (G9).
   *
   * `options.changedSince` applies to a NEW watch only: a watch already held
   * was listening all along, so it heard every write itself.
   */
  acquire(filePath: string, onChange: () => void, options?: PreviewWatchStartOptions): boolean
  /** Decrement the refcount; end the watch when it reaches zero. */
  release(filePath: string): Promise<void>
  /** End every watch regardless of refcount. Awaited. */
  releaseAll(): Promise<void>
  /** Release everything and end the pool's owner; the pool must not be used afterwards. */
  close(): Promise<void>
  /** Compare every watched file with the version last seen; a difference is one change (S1). */
  recheck(): void
  /** The tracker state of a watched file (tests, diagnostics); `undefined` when not watched. */
  state(filePath: string): FreshnessState | undefined
  /** Number of distinct watched paths. */
  readonly size: number
}

interface PoolEntry {
  refCount: number
  readonly handle: TrackedWatchHandle
}

/**
 * One tracker's view of the pool's shared source: the same owner and events,
 * but its `dispose` ends only what this tracker subscribed – it waits for the
 * tracker's own unsubscribes, so a release resolves once the watch is gone –
 * and leaves the owner to the pool.
 */
function trackerView(shared: MainFreshnessSource): MainFreshnessSource {
  const ending = new Set<Promise<void>>()
  return {
    ownerId: shared.ownerId,
    subscribe: (request) => shared.subscribe(request),
    unsubscribe: (watchId) => {
      const ended = shared.unsubscribe(watchId)
      ending.add(ended)
      return ended.finally(() => ending.delete(ended))
    },
    probe: (filePath, knownHash) => shared.probe(filePath, knownHash),
    readText: (filePath) => shared.readText(filePath),
    readStamp: (realPath) => shared.readStamp(realPath),
    onEvent: (listener) => shared.onEvent(listener),
    async dispose() {
      // A watch that fails to end is unusable already; one bad subscription must not stall a release
      await Promise.allSettled([...ending])
    }
  }
}

/** The file was modified since the page's load began, as far as its stamp's clock tells. */
function modifiedSince(stamp: FileStamp, changedSince: number, now: number): boolean {
  const slack = WATCH_CATCH_UP_SLACK_MS
  return stamp.mtimeMs >= changedSince - slack && stamp.mtimeMs <= now + slack
}

/**
 * Create a preview watch pool. `deps` are injectable so tests can substitute a
 * fake watch layer without touching chokidar.
 */
export function createPreviewWatchPool(deps: PreviewWatchPoolDeps = {}): IPreviewWatchPool {
  const newId = deps.newId ?? randomUUID
  const read = deps.read ?? ((realPath: string) => readStatStampOutcome(realPath))
  const clock = deps.clock ?? realClock

  const entries = new Map<string, PoolEntry>()
  const source: MainFreshnessSource = (deps.createSource ?? createMainFreshnessSource)({
    ownerName: 'preview-pool',
    onCheck: () => checkAll('resume')
  })

  function checkAll(reason: CheckReason): void {
    for (const entry of entries.values()) entry.handle.check(reason)
  }

  /** The version the page loaded, as far as it can be told (module comment). */
  const baselineOf = async (filePath: string, changedSince: number | undefined): Promise<FileStamp | undefined> => {
    const outcome = await read(filePath)
    if (outcome.status !== 'ok') return undefined
    if (changedSince !== undefined && modifiedSince(outcome.stamp, changedSince, clock.now())) return undefined
    return outcome.stamp
  }

  const follow = (filePath: string, onChange: () => void, changedSince: number | undefined): TrackedWatchHandle =>
    createTrackedFileWatch(
      filePath,
      {
        onChange,
        onDeleted: onChange,
        onProblem: (problem) => logger.debug('Preview sub-file watch problem', { problem })
      },
      {
        profile: 'preview',
        createSource: () => trackerView(source),
        read,
        clock,
        newId,
        baseline: () => baselineOf(filePath, changedSince),
        // The pool is the one safety-net member: it checks every tracker
        register: () => () => {}
      }
    )

  const unregister = (deps.register ?? registerMainTracker)({ check: (reason) => checkAll(reason) })

  return {
    acquire(filePath: string, onChange: () => void, options?: PreviewWatchStartOptions): boolean {
      const existing = entries.get(filePath)
      if (existing) {
        existing.refCount += 1
        return true
      }
      entries.set(filePath, { refCount: 1, handle: follow(filePath, onChange, options?.changedSince) })
      return true
    },

    async release(filePath: string): Promise<void> {
      const entry = entries.get(filePath)
      if (!entry) return
      entry.refCount -= 1
      if (entry.refCount > 0) return
      entries.delete(filePath)
      await entry.handle.close()
    },

    async releaseAll(): Promise<void> {
      const open = [...entries.values()]
      entries.clear()
      await Promise.all(open.map((entry) => entry.handle.close()))
    },

    async close(): Promise<void> {
      await this.releaseAll()
      unregister()
      await source.dispose()
    },

    recheck: () => checkAll('shown'),

    state: (filePath) => entries.get(filePath)?.handle.state(),

    get size(): number {
      return entries.size
    }
  }
}
