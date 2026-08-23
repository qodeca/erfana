// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Read-only file-watch subscription.
 *
 * A surface that only *displays* a file – the image viewer today, any binary or
 * read-only preview tomorrow – needs three things from the watcher: "the bytes
 * changed", "the file is gone", and "this watch is dead". It needs none of the
 * Markdown editor's conflict, echo-detection or save-guard machinery, and it
 * must never pause the watch.
 *
 * Why not `useFileWatcher({ mode: 'binary' })`: that hook is structurally
 * text-coupled. `handleExternalChange` reads the file as UTF-8 and hands the
 * resulting `string` to `onContentUpdate`; there is no mode flag that makes a
 * `string`-typed reload path serve a binary surface.
 *
 * @module useFileChangeSubscription
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { INDICATOR_DURATION_MS } from '../constants/fileWatch'
import {
  acquireFileWatch,
  createFileWatchSlot,
  releaseFileWatch,
  type FileWatchSlot
} from './fileWatchSlot'
import { logger } from '../utils/logger'

/**
 * Why auto-refresh stopped working for a path.
 *
 * Mirrors `WatchUnavailableReason` in the image viewer's status logic; kept
 * structurally identical (a string union) so consumers can pass it straight
 * through without a mapping layer.
 */
export type FileWatchUnavailableReason = 'limit' | 'watcher-error'

/**
 * Marker substring of the main process's watched-files cap error.
 *
 * `FileWatcherService.watchFile` throws
 * `Maximum watched files limit reached (100)` when the app-wide cap is full,
 * and `file-watch:start` passes `error.message` back verbatim, so this is the
 * only evidence the renderer has that the cap – rather than some other watcher
 * fault – refused the watch.
 *
 * NOTE: coupled to that message by string. It is asserted in
 * `FileWatcherService.test.ts` main-side and in the tests for this module, so a
 * reworded throw fails a test instead of silently mis-blaming the user.
 */
const WATCH_LIMIT_ERROR_MARKER = 'Maximum watched files limit reached'

/**
 * Attributes a failed `fileWatch.start` to a cause the UI can state honestly.
 *
 * `start` has more than one way to fail: the cap, an atomic-save re-arm that
 * ended the watch while we were joining it (`File watch ended while joining:
 * …`), a rejected IPC call. Only the first is "too many files are open", and
 * telling a user that when it was not sends them closing tabs for nothing – so
 * every unrecognised failure is reported as a watcher fault instead.
 *
 * @param error - The bridge's error string, when the main process refused
 * @returns `'limit'` only for the watched-files cap, `'watcher-error'` otherwise
 *
 * @example
 * ```ts
 * classifyWatchStartFailure('Maximum watched files limit reached (100)') // 'limit'
 * classifyWatchStartFailure('File watch ended while joining: /a.png')    // 'watcher-error'
 * classifyWatchStartFailure(undefined)                                   // 'watcher-error'
 * ```
 */
export function classifyWatchStartFailure(error?: string): FileWatchUnavailableReason {
  return error?.includes(WATCH_LIMIT_ERROR_MARKER) ? 'limit' : 'watcher-error'
}

/** Options for {@link useFileChangeSubscription}. */
export interface UseFileChangeSubscriptionOptions {
  /**
   * Called when the watched file changed on disk.
   *
   * Held in a ref, so an inline arrow function is fine: changing its identity
   * never restarts the watch.
   */
  onExternalChange: () => void
}

/** State and actions returned by {@link useFileChangeSubscription}. */
export interface UseFileChangeSubscriptionResult {
  /** True for `INDICATOR_DURATION_MS` after the consumer calls `markReloaded`. */
  isReloading: boolean
  /** The file was deleted on disk and was still gone when we re-checked. */
  isFileDeleted: boolean
  /** Auto-refresh is dead: the watch never started, errored, or the session ended. */
  isWatchUnavailable: boolean
  /** Why auto-refresh is unavailable, or `null` when it is fine. */
  unavailableReason: FileWatchUnavailableReason | null
  /** Consumer signals "the refresh landed" – raises the transient indicator. */
  markReloaded: () => void
  /** Re-check the file and restart the watch. Resolves `true` when the watch is live again. */
  recover: () => Promise<boolean>
}

/**
 * Subscribes to file-watch events for a single path, read-only.
 *
 * Invariants (asserted in `useFileChangeSubscription.test.ts`):
 *
 * 1. **It never calls `fileWatch.pause` / `fileWatch.resume`.** Pause is global
 *    per path with no safety timeout, so a stuck pause would deafen every other
 *    consumer of that path – including the Markdown editor. A surface that
 *    never writes has nothing to pause for.
 * 2. **The subscription effect depends on `[filePath]` only.** Callbacks live in
 *    refs, so a re-render with a new inline callback cannot tear the watch down
 *    and start it again.
 * 3. **A `deleted` event is re-checked before it is believed.** A tmp→rename
 *    slower than the main process's 100 ms atomic-save window arrives here as a
 *    delete for a file that exists; we re-stat, and if the file is back we
 *    recover and report a change instead of showing a "deleted" banner.
 * 4. **`isWatchUnavailable` and `isReloading` cannot both be true in practice** –
 *    `watchFile` throws before adding the caller to the subscriber set, so a
 *    failed start can never receive a change event. Consumers still resolve the
 *    two with explicit precedence rather than relying on that.
 * 5. **Exactly one subscription is held at a time.** `fileWatch.start` is a
 *    counting acquire main-side, so `recover()` releases before it re-starts
 *    and teardown only releases what was actually acquired. See
 *    {@link FileWatchSlot} for what each imbalance costs.
 *
 * @param filePath - Absolute path to watch. An empty string subscribes to nothing.
 * @param options - Change callback
 * @returns Watch state plus the `markReloaded` / `recover` actions
 *
 * @example
 * ```tsx
 * const { isReloading, isFileDeleted, markReloaded, recover } =
 *   useFileChangeSubscription(filePath, {
 *     onExternalChange: () => refresh()
 *   })
 * ```
 */
export function useFileChangeSubscription(
  filePath: string,
  options: UseFileChangeSubscriptionOptions
): UseFileChangeSubscriptionResult {
  const [isReloading, setIsReloading] = useState(false)
  const [isFileDeleted, setIsFileDeleted] = useState(false)
  const [unavailableReason, setUnavailableReason] =
    useState<FileWatchUnavailableReason | null>(null)

  // Held in a ref so the subscription effect can depend on [filePath] alone.
  const onExternalChangeRef = useRef(options.onExternalChange)
  useEffect(() => {
    onExternalChangeRef.current = options.onExternalChange
  }, [options.onExternalChange])

  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  // This consumer's single hold on the main-process watch. One slot per hook
  // instance, created lazily so every mount starts from "holds nothing".
  const slotRef = useRef<FileWatchSlot | null>(null)
  if (slotRef.current === null) slotRef.current = createFileWatchSlot()
  const slot = slotRef.current

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  /**
   * Raises the transient indicator and schedules its own teardown.
   *
   * Unlike `useFileWatcher.reloadFromDisk`, the timer is cleared on unmount, so
   * a tab closed inside the 1 s window cannot produce a post-teardown update.
   */
  const markReloaded = useCallback(() => {
    if (!isMountedRef.current) return

    setIsReloading(true)
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    indicatorTimerRef.current = setTimeout(() => {
      indicatorTimerRef.current = null
      if (isMountedRef.current) setIsReloading(false)
    }, INDICATOR_DURATION_MS)
  }, [])

  useEffect(
    () => () => {
      if (indicatorTimerRef.current) {
        clearTimeout(indicatorTimerRef.current)
        indicatorTimerRef.current = null
      }
    },
    []
  )

  /**
   * Re-checks the file and restarts the watch.
   *
   * Backs the banner's Reload button and the automatic recovery from a
   * misreported delete – the latter fires with no user action at all, on every
   * slow tmp→rename, so it must be exactly as leak-free as mount/unmount.
   *
   * Both degraded states clear together: one affordance, one outcome.
   */
  const recover = useCallback(async (): Promise<boolean> => {
    if (!filePath) return false

    try {
      await window.api.file.getStats(filePath)
    } catch {
      // Still gone – keep the deleted banner up rather than claiming recovery.
      if (isMountedRef.current) setIsFileDeleted(true)
      return false
    }

    // Release before re-acquiring, rather than starting a second subscription.
    // `start` increments a per-window subscriber count, so a bare re-`start`
    // would leave this consumer holding two counts against one teardown `stop`,
    // and the watcher would outlive the panel (see {@link FileWatchSlot}).
    // Releasing first is also what makes Reload work after a *genuine* delete,
    // where the main process dropped the whole entry and the count has to be
    // rebuilt from zero – skipping the start on a still-held slot would leave
    // the user with a Reload button that never restores auto-refresh.
    await releaseFileWatch(slot, filePath)
    const { started, error, cause } = await acquireFileWatch(slot, filePath)

    if (!started) {
      logger.error('Failed to restart file watch', cause, { filePath, error })
      // L4: a watcher fault must not be reported as "too many files are open".
      // The failure itself decides the reason - same rule as the mount path -
      // so a restart refused by a watcher fault never re-blames the cap, and a
      // restart genuinely refused by the cap says so even after a watcher error.
      if (isMountedRef.current) setUnavailableReason(classifyWatchStartFailure(error))
      return false
    }

    if (isMountedRef.current) {
      setIsFileDeleted(false)
      setUnavailableReason(null)
    }
    return true
  }, [filePath, slot])

  // `recover` is stable per path, but the subscription must depend on
  // [filePath] alone (invariant 2), so it is reached through a ref.
  const recoverRef = useRef(recover)
  useEffect(() => {
    recoverRef.current = recover
  }, [recover])

  // Subscription. [filePath] only – see invariant 2.
  useEffect(() => {
    if (!filePath) return

    let isActive = true

    setIsFileDeleted(false)
    setUnavailableReason(null)

    void acquireFileWatch(slot, filePath).then(({ started, error, cause }) => {
      if (!isActive || started) return
      // Honest degradation: the tab is stale from here on, and the UI says so -
      // with the cause the failure actually carries, not an assumed one.
      logger.error('Failed to start read-only file watch', cause, { filePath, error })
      setUnavailableReason(classifyWatchStartFailure(error))
    })

    const unsubscribeChanged = window.api.fileWatch.onFileChanged((data) => {
      if (!isActive || data.filePath !== filePath) return
      // A change proves the file is back; clear a stale deleted banner.
      setIsFileDeleted(false)
      onExternalChangeRef.current()
    })

    const unsubscribeDeleted = window.api.fileWatch.onFileDeleted((data) => {
      if (!isActive || data.filePath !== filePath) return

      // Invariant 3: never believe a delete without re-checking the disk.
      window.api.file
        .getStats(filePath)
        .then(async () => {
          if (!isActive) return
          logger.info('Delete event for a file that still exists; recovering the watch', {
            filePath
          })
          await recoverRef.current()
          if (isActive) onExternalChangeRef.current()
        })
        .catch(() => {
          if (!isActive) return
          logger.warn('Watched file deleted on disk', { filePath })
          setIsFileDeleted(true)
        })
    })

    const unsubscribeError = window.api.fileWatch.onFileError((data) => {
      if (!isActive || data.filePath !== filePath) return
      logger.error('Read-only file watch error', undefined, {
        filePath,
        error: data.error
      })
      setUnavailableReason('watcher-error')
    })

    return () => {
      isActive = false
      // Queued behind the acquire above, so a mount→unmount faster than the
      // IPC round trip can never deliver `stop` first; and a start that was
      // refused or rejected releases nothing, so we never decrement a count
      // this consumer does not hold.
      void releaseFileWatch(slot, filePath)
      unsubscribeChanged()
      unsubscribeDeleted()
      unsubscribeError()
    }
  }, [filePath, slot])

  return {
    isReloading,
    isFileDeleted,
    isWatchUnavailable: unavailableReason !== null,
    unavailableReason,
    markReloaded,
    recover
  }
}
