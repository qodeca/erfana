// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * singleFileWatch - the one place a single-file chokidar watcher is created.
 *
 * `FileWatcherService` creates a watcher twice: once when a renderer starts
 * watching a path, and once when it re-arms after an atomic save (write temp +
 * rename) destroyed the inode the original watcher was bound to (issue #70,
 * defect D2). Both must use the same options and register the same handlers,
 * so the option object and the three registrations live here rather than being
 * duplicated at the two call sites.
 *
 * chokidar 4+ treats every path literally (globbing was removed), so a file
 * whose name contains glob characters is watched like any other. chokidar is
 * pinned to an exact version: a single-file watcher costs one file handle,
 * which is fine; the project tree is watched natively on macOS and Windows
 * instead (see `directoryWatchBackend`).
 */
import chokidar, { FSWatcher, ChokidarOptions } from 'chokidar'
import { createWriteFinishGate, type WriteFinishOptions } from './writeFinishGate'

/**
 * Production chokidar options for a single-file watch.
 *
 * `awaitWriteFinish` here is read by this module, not by chokidar: chokidar
 * is always given `awaitWriteFinish: false` and the change goes through
 * `writeFinishGate` instead, because chokidar 5.0.0's own wait can get stuck
 * after a failed stat and swallow every later change (#464).
 *
 * Exported so the real-chokidar rename integration test can pin the actual
 * event sequence this exact configuration produces, rather than trusting a
 * mock that encodes the assumption it is meant to verify.
 */
export const SINGLE_FILE_WATCH_OPTIONS: ChokidarOptions = {
  persistent: true,
  ignoreInitial: true, // Don't fire events on initial add
  awaitWriteFinish: {
    stabilityThreshold: 300, // Wait 300ms for file writes to finish
    pollInterval: 100
  },
  usePolling: false, // Use native fs events (faster)
  // Watch the path itself, never what a symlink at that path points at. A link
  // planted inside the project would otherwise make the watcher (and the
  // automatic re-read behind it) follow an out-of-project target; chokidar
  // defaults this to true (issue #70, security).
  followSymlinks: false,
  interval: 100,
  binaryInterval: 300
}

export interface SingleFileWatchHandlers {
  onChange: () => void
  onUnlink: () => void
  onError: (error: unknown) => void
  /**
   * The watcher is listening: a write from now on is reported (chokidar's
   * `ready`, emitted once its file watch is open). A write before it is not.
   */
  onReady?: () => void
}

/**
 * Create a chokidar watcher for exactly one file with the production options.
 *
 * The options object is copied (including the nested `awaitWriteFinish`) so a
 * chokidar-internal default fill-in can never mutate the shared constant.
 *
 * `overrides` shallow-merges over the base options after the copy, so a caller
 * (the HTML preview watch pool) can lower `awaitWriteFinish` timings without
 * touching the security-load-bearing `followSymlinks: false` invariant, which
 * remains in the base. Omitted ⇒ behaviour is byte-identical.
 */
export function createSingleFileWatcher(
  filePath: string,
  handlers: SingleFileWatchHandlers,
  overrides?: Partial<ChokidarOptions>
): FSWatcher {
  const options: ChokidarOptions = {
    ...SINGLE_FILE_WATCH_OPTIONS,
    awaitWriteFinish: { ...(SINGLE_FILE_WATCH_OPTIONS.awaitWriteFinish as object) },
    ...overrides
  }
  const writeFinish = options.awaitWriteFinish
  const watcher = chokidar.watch(filePath, { ...options, awaitWriteFinish: false })

  // A change is held until its writes settle, by our gate rather than
  // chokidar's (see SINGLE_FILE_WATCH_OPTIONS); `awaitWriteFinish: false` in
  // the options passes every change straight through
  let onChange = handlers.onChange
  let cancelWait = (): void => {}
  if (writeFinish) {
    const timings: WriteFinishOptions =
      typeof writeFinish === 'object'
        ? { stabilityThreshold: writeFinish.stabilityThreshold ?? 2000, pollInterval: writeFinish.pollInterval ?? 100 }
        : { stabilityThreshold: 2000, pollInterval: 100 }
    const gate = createWriteFinishGate(filePath, timings, handlers.onChange, { isClosed: () => watcher.closed })
    onChange = () => gate.trigger()
    cancelWait = () => gate.cancel()
  }

  watcher.on('change', onChange)
  watcher.on('unlink', () => {
    // As chokidar did: an unlink drops the wait for the writes before it
    cancelWait()
    handlers.onUnlink()
  })
  watcher.on('error', handlers.onError)
  // chokidar emits `ready` on a later tick, so a listener added here hears it.
  if (handlers.onReady !== undefined) {
    watcher.once('ready', handlers.onReady)
  }

  return watcher
}
