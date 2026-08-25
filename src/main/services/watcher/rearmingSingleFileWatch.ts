// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * rearmingSingleFileWatch - a single-file watch that survives an atomic save.
 *
 * `createSingleFileWatcher` binds a chokidar watcher to the inode it opens. An
 * editor's atomic save (write temp, rename over the target) destroys that inode,
 * so the raw watcher goes permanently deaf and every later edit is invisible -
 * defect D2, the same one `FileWatcherService` re-arms around (issue #70).
 *
 * The HTML preview watches the entry file and each subresource with the raw
 * factory, so it inherits that defect: live-reload dies after the first atomic
 * save. This adapter closes the gap by reusing the SAME re-arm branch
 * (`resolveDeletedWatch`) and atomic-save detector the file-watcher service uses,
 * wrapped around one path with a single-slot watch record. On an unlink it:
 *
 *   - waits the detector's window; if the file reappears (atomic save) it closes
 *     the dead watcher, opens a fresh one on the replacement inode, re-checks
 *     realpath confinement (the TOCTOU window the raw factory left open), and
 *     re-enters the change path so the consumer reloads;
 *   - otherwise treats it as a genuine delete and calls `onDeleted`.
 *
 * A watched path is DATA: its confinement is re-verified, never followed.
 */
import type { FSWatcher, WatchOptions } from 'chokidar'
import { AtomicSaveDetector, createAtomicSaveDetector } from './AtomicSaveDetector'
import { createSingleFileWatcher } from './singleFileWatch'
import { AtomicRearmDeps, RearmableWatch, resolveDeletedWatch } from './atomicRearm'

/** What the consumer is told about the watched file. */
export interface RearmingSingleFileWatchHandlers {
  /** The file changed, or was rewritten by an atomic save and re-armed. */
  onChange(): void
  /** The file was genuinely deleted (not an atomic-save rename). */
  onDeleted(): void
  /** A chokidar-level watcher error. */
  onError(error: unknown): void
  /** The watch could not be re-armed and has ended (rare). */
  onWatchDead?(reason: string): void
}

export interface RearmingSingleFileWatchDeps {
  /** The low-level chokidar factory; defaults to `createSingleFileWatcher`. */
  readonly createWatcher?: (
    filePath: string,
    handlers: { onChange: () => void; onUnlink: () => void; onError: (error: unknown) => void },
    overrides?: Partial<WatchOptions>
  ) => FSWatcher
  /**
   * Re-check that the path still resolves inside its boundary before re-arming,
   * because an external writer just replaced it (TOCTOU). Defaults to always
   * confined - callers that own a project root should pass a real check.
   */
  readonly isPathConfined?: (filePath: string) => Promise<boolean>
  /** The atomic-save detector; defaults to a fresh `createAtomicSaveDetector`. */
  readonly createDetector?: () => AtomicSaveDetector
  /** chokidar options forwarded to the low-level factory. */
  readonly overrides?: Partial<WatchOptions>
}

/** The disposable a caller holds; matches `PreviewFileWatcherHandle`. */
export interface RearmingSingleFileWatchHandle {
  close(): Promise<void>
}

/**
 * Watch one file, re-arming across atomic saves. `onChange` fires on a change
 * and after a re-arm; `onDeleted` fires only on a genuine delete.
 */
export function createRearmingSingleFileWatcher(
  filePath: string,
  handlers: RearmingSingleFileWatchHandlers,
  deps: RearmingSingleFileWatchDeps = {}
): RearmingSingleFileWatchHandle {
  const build = deps.createWatcher ?? createSingleFileWatcher
  const isPathConfined = deps.isPathConfined ?? (async (): Promise<boolean> => true)
  const detector = (deps.createDetector ?? createAtomicSaveDetector)()

  let disposed = false

  // A single-slot watch record: this adapter owns exactly one path, so the
  // service-shaped `getWatch(path) === slot` identity checks in atomicRearm
  // collapse to "is this our path and are we still live". `version` never
  // advances within one watcher's life, so the session-change branch is inert.
  const slot: RearmableWatch = {
    filePath,
    watcher: undefined as unknown as FSWatcher,
    version: 0,
    debounceTimer: null
  }

  const onUnlink = (): void => {
    if (disposed) return
    detector.registerDelete(filePath, (path, wasAtomicSave) => {
      void resolveDeletedWatch(path, wasAtomicSave, rearmDeps)
    })
  }

  const createWatcher = (): FSWatcher =>
    build(
      filePath,
      {
        onChange: () => {
          if (!disposed) handlers.onChange()
        },
        onUnlink,
        onError: (error) => {
          if (!disposed) handlers.onError(error)
        }
      },
      deps.overrides
    )

  const rearmDeps: AtomicRearmDeps = {
    isDisposing: () => disposed,
    currentVersion: () => 0,
    getWatch: (path) => (path === filePath && !disposed ? slot : undefined),
    isPathConfined,
    createWatcher: () => createWatcher(),
    replaceWatcher: (path, watcher) => {
      if (path !== filePath || disposed) return false
      slot.watcher = watcher
      return true
    },
    // On a genuine delete the branch closes the dead watcher for us; there is no
    // service map to prune here.
    discardWatch: (_path, watched) => {
      void watched.watcher.close().catch(() => {})
    },
    notifyDeleted: () => {
      if (!disposed) handlers.onDeleted()
    },
    notifyWatchDead: (_path, reason) => {
      if (!disposed) handlers.onWatchDead?.(reason)
    },
    // Re-enter the change path after a re-arm so the consumer reloads the file
    // the atomic save just rewrote.
    emitChange: () => {
      if (!disposed) handlers.onChange()
    },
    log: () => {}
  }

  slot.watcher = createWatcher()

  return {
    async close(): Promise<void> {
      disposed = true
      detector.cancelPending(filePath)
      detector.dispose()
      try {
        await slot.watcher.close()
      } catch {
        // A watcher that refuses to close is already gone for our purposes.
      }
    }
  }
}
