// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shapes and pure helpers shared by the layers of `DirectoryWatcherService`
 * (finding [65]): what one watched folder holds, a raw backend event, the
 * listener types and the batch classification rules.
 */
import type { PauseController } from '../../utils/PauseController'
import type { AtomicSaveDetector } from './AtomicSaveDetector'
import type { DirectoryWatchBackend, DirectoryWatchHandle } from './directoryWatchBackend'
import type { FileChangeEvent } from './EventCoalescer'
import type { KnownEntryKind } from './KnownEntries'
import type { PauseEpisode } from './PauseEpisode'
import type { ThrottledWorker } from './ThrottledWorker'

export interface WatchedDirectory {
  dirPath: string
  watcher: DirectoryWatchHandle
  /** Which backend built `watcher`; a native `unlink` is already confirmed by `lstat` (#211, D2). */
  backend: DirectoryWatchBackend
  webContentsIds: Set<number>
  pauseController: PauseController
  throttledWorker: ThrottledWorker<FileChangeEvent>
  atomicSaveDetector: AtomicSaveDetector
  version: number
  /** `directoryWatchDepth` the watch was built with (`undefined`: every level). */
  depth: number | undefined
  /**
   * What the current pause dropped and what re-read it (#210). Exists only
   * while paused: set when `pauseWatch` takes the count to 1, cleared at full
   * resume and on the safety timeout – so its presence is the paused guard.
   */
  pauseEpisode?: PauseEpisode
  /**
   * The next broadcast goes out structural whatever it holds: the throttled
   * worker dropped buffered events (they may have been structural), or an
   * entry was swapped between a file and a symlink in a way the coalescer
   * would show as a `change`.
   */
  forceStructural?: boolean
}

// Git index watching migrated to GitWatcherService (Issue #74)

export interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'
  path: string
  /** For `add` / `change`, what `lstat` says the entry is, when the backend says */
  kind?: KnownEntryKind
}

/**
 * Whether a delivered batch can change the project tree. Only `change` cannot:
 * a content edit leaves names and folders as they were, so the renderer
 * refreshes the repository status for it but does not re-read the tree.
 */
export function isStructuralBatch(events: readonly { type: string }[]): boolean {
  return events.some((event) => event.type !== 'change')
}

/**
 * Whether a batch is structural, judged on its RAW events as well as the
 * coalesced ones: a folder created or removed anywhere in the raw batch counts
 * even when coalescing hid it – cascade prevention drops every later event
 * under a removed folder, and `addDir` + `unlinkDir` of one path coalesces to
 * nothing. (Raw `add` / `unlink` need no such check: the coalescer keeps them
 * unless they cancel out or form a file-to-file `unlink` + `add`, which a
 * kind swap marks separately.)
 */
export function isStructuralRawBatch(
  raw: readonly { type: string }[],
  coalesced: readonly { type: string }[]
): boolean {
  return isStructuralBatch(coalesced) || raw.some((e) => e.type === 'addDir' || e.type === 'unlinkDir')
}

/**
 * The entry kind a backend passed with an `add` / `change`: the native watcher
 * passes `{ symbolicLink }`, chokidar (with `followSymlinks: false`) its
 * `lstat` result. `undefined` when it passed nothing usable.
 */
export function entryKindOf(info: unknown): KnownEntryKind | undefined {
  if (info === null || typeof info !== 'object') return undefined
  const value = info as { symbolicLink?: unknown; isSymbolicLink?: unknown }
  if (typeof value.symbolicLink === 'boolean') return value.symbolicLink ? 'symlink' : 'file'
  if (typeof value.isSymbolicLink === 'function') {
    return (value.isSymbolicLink as () => boolean)() ? 'symlink' : 'file'
  }
  return undefined
}

/** Receives the absolute paths one delivered batch removed. */
export type PathsRemovedListener = (removedPaths: readonly string[]) => void

/**
 * Told that a paused watch lost removals under `root` without their paths: a
 * resync swallowed them (`root` is then the watch root), or more removals than
 * it could remember were folded into this folder (#252). `isOwnRemoval` says
 * which paths the pausing operation removed itself.
 */
export type RemovalsLostListener = (root: string, isOwnRemoval: (filePath: string) => boolean) => void

/** Construction options for `DirectoryWatcherService`. */
export interface DirectoryWatcherServiceOptions {
  /**
   * Which backend watches a directory (#211, design D6). Defaults to
   * `selectDirectoryWatchBackend()`: the native recursive watcher on Windows,
   * chokidar elsewhere. Read once, here.
   */
  readonly backend?: DirectoryWatchBackend
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null
}
