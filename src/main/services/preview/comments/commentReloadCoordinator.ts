// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One reload per comment write, and the reader put back where they were
 * (docs/designs/html-preview-comments.md §7.5 steps 3, 5–6, §19; spike S2;
 * tests M-013, M-040, M-041, M-042, M-058).
 *
 * A save does not reload the view itself. Before the write, the top frame's
 * scroll and hash are read (world 996). After it, the write is ARMED here:
 * - the normal watcher path reloads the page – the page's own file watch, or
 *   the frame watch for a frame's file – and every other preview of the file
 *   reloads through its own watcher, as for any outside edit;
 * - if no reload of this view has started 300 ms later, this view reloads
 *   once (`pipeline.reload(false)`, which waits out a pending navigation);
 * - once a reload started, a watcher change to the written file whose bytes
 *   still hash to what was written is the write's own echo and is dropped for
 *   two seconds – so one write is exactly one reload of this view (M-058);
 * - when the reload commits the same page, its next `did-finish-load` restores
 *   the scroll and hash (M-040, M-041); when another page commits first – the
 *   reader went Back – the restore is dropped (M-042);
 * - the `<details>` that were open come back with the top frame's first hello
 *   after that commit (`commentState.openSections`, §19 Rev 4 "folded
 *   sections"): the preload opens them before it draws or reports a pin, so a
 *   comment inside one keeps its pin. Once only – a later load of the page,
 *   an ordinary reload included, reopens nothing;
 * - a frame's own scroll comes back through `commentState.restore` at that
 *   frame's next hello (best effort, S3). A frame's own sections are not kept.
 *
 * `reloadKeepingPlace()` is the same reload and restore without a write:
 * comment mode turned on over a page that was served without tokens
 * reloads it once, so it can be commented, and the reader keeps their place.
 */
import { webcrypto } from 'node:crypto'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { withTimeout } from '../../../utils/withTimeout'
import { readFileNoFollow } from '../../../utils/atomicWriteBytesStrict'
import { logger } from '../../LoggingService'
import {
  COMMENT_SCRIPT_TIMEOUT_MS,
  COMMENT_WORLD_ID,
  parseTopScroll,
  READ_SCROLL_SCRIPT,
  RESTORE_BUDGET_MS,
  restoreScrollScript,
  type TopScroll
} from './commentScripts'
import { samePathKey } from './commentUnsavedSources'
import type { PaintContents } from './commentStillCapture'

/** How long a write waits for the watcher's reload before reloading itself (S2: never needed). */
export const FALLBACK_RELOAD_MS = 300
/** How long after its reload started a write's own watcher echo is dropped. */
export const ECHO_WINDOW_MS = 2_000
/** How long a frame's scroll waits for that frame's next hello. */
export const FRAME_RESTORE_WINDOW_MS = 5_000

/** A write that just landed. */
export interface ArmedWrite {
  /** The real path written. */
  readonly realPath: string
  /** SHA-256 of the bytes now on disk (`CommentWriteResult.fileHash`). */
  readonly fileHash: string
  /** The top frame's scroll before the write; absent: nothing to restore. */
  readonly scroll?: TopScroll
  /** The page the pick was made on: the scroll is restored only onto it. */
  readonly page?: string
  /** A frame's file: that frame's own scroll, for its next hello. */
  readonly frameRestore?: { readonly realPath: string; readonly x: number; readonly y: number }
}

/** How the last restore went (the e2e hook reads it). */
export type RestoreOutcome = 'restored' | 'unreached' | 'dropped' | 'failed'

/** What the coordinator is built from. */
export interface ReloadCoordinatorDeps {
  readonly contents: PaintContents
  /** The page on screen (`page.currentPage()`): a real path. */
  readonly currentPage: () => string
  /** Reload this view (`pipeline.reload(false)`). */
  readonly reload: () => void
  /**
   * SHA-256 of a file's bytes now; `undefined` when unreadable. Defaults to
   * the writer's own bounded no-follow read: at most `COMMENT_FILE_MAX_BYTES`
   * (25 MB), never through a link, a regular file with one link only.
   */
  readonly hashOf?: (path: string) => Promise<string | undefined>
  readonly now: () => number
  readonly setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  readonly platform?: NodeJS.Platform
}

/** One view's coordinator. */
export interface CommentReloadCoordinator {
  /** The top frame's scroll and hash now, for a save about to write. */
  captureScroll(): Promise<TopScroll | undefined>
  /** A write landed. */
  arm(write: ArmedWrite): void
  /**
   * Reload this view now and put the reader back after it, with no write to
   * wait for: comment mode came on over a page served without tokens.
   */
  reloadKeepingPlace(): Promise<void>
  /** This view is starting a reload (the wiring's `reloadPage`). */
  reloadStarting(): void
  /** A load of this view ended (`previewLivePage`'s outcome). */
  pageLoadEnded(end: { readonly reason: string; readonly load: { readonly filePath: string } }): void
  /** The page fired `did-finish-load`. */
  didFinishLoad(): void
  /** A frame of `realPath` said hello: its own scroll to restore, once. */
  frameRestoreFor(realPath: string): { x: number; y: number } | undefined
  /**
   * The top frame of `realPath` said hello: the sections to open again, once,
   * when this is the write's reload of the page the scroll was read on.
   */
  sectionsFor(realPath: string): readonly number[] | undefined
  /** A watcher change to `path`: `record` it, unless it is a write's own echo. */
  filterChange(path: string, record: () => void): void
  /** What the e2e hook reports. */
  stats(): { readonly reloads: number; readonly echoes: number; readonly lastRestore?: RestoreOutcome }
  dispose(): void
}

interface Armed extends ArmedWrite {
  readonly armedAt: number
  reloadStartedAt?: number
  /** The reload committed the same page: restore at its `did-finish-load`. */
  restoreDue: boolean
  /** A load committed since the write: any later commit is another load. */
  committed: boolean
  /** The reload committed the same page: its top frame's next hello reopens the sections. */
  sectionsDue: boolean
  frameRestoreLeft: boolean
}

/**
 * The echo filter's read: what the writer reads, so a file it would not write
 * never counts as its echo. Hashed with WebCrypto, which digests on the thread
 * pool: a 25 MB SHA-256 holds the main thread about 50 ms on the slowest box
 * measured, the asynchronous digest about 10 ms (§19 Rev 4).
 */
export async function defaultHashOf(path: string): Promise<string | undefined> {
  const read = await readFileNoFollow(path, PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)
  if (!read.ok) return undefined
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', read.bytes)).toString('hex')
}

/** Build one view's coordinator. */
export function createCommentReloadCoordinator(deps: ReloadCoordinatorDeps): CommentReloadCoordinator {
  const hashOf = deps.hashOf ?? defaultHashOf
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer))
  const key = (path: string): string => samePathKey(path, deps.platform)
  let armed: Armed | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined
  let reloads = 0
  let echoes = 0
  let lastRestore: RestoreOutcome | undefined
  let disposed = false

  function cancelFallback(): void {
    if (fallback !== undefined) clearTimer(fallback)
    fallback = undefined
  }

  async function restore(write: Armed): Promise<void> {
    const scroll = write.scroll
    if (scroll === undefined) return
    try {
      const reached = await withTimeout(
        deps.contents.executeJavaScriptInIsolatedWorld(COMMENT_WORLD_ID, [{ code: restoreScrollScript(scroll) }]),
        RESTORE_BUDGET_MS + COMMENT_SCRIPT_TIMEOUT_MS,
        'Preview comments: scroll restore'
      )
      lastRestore = reached === true ? 'restored' : 'unreached'
    } catch {
      lastRestore = 'failed'
    }
  }

  async function captureScroll(): Promise<TopScroll | undefined> {
    try {
      const raw = await withTimeout(
        deps.contents.executeJavaScriptInIsolatedWorld(COMMENT_WORLD_ID, [{ code: READ_SCROLL_SCRIPT }]),
        COMMENT_SCRIPT_TIMEOUT_MS,
        'Preview comments: scroll read'
      )
      return parseTopScroll(raw)
    } catch {
      return undefined
    }
  }

  return {
    captureScroll,

    arm(write) {
      if (disposed) return
      cancelFallback()
      const samePage = write.page === undefined || key(write.page) === key(deps.currentPage())
      armed = {
        ...write,
        ...(samePage ? {} : { scroll: undefined }),
        armedAt: deps.now(),
        restoreDue: false,
        committed: false,
        sectionsDue: false,
        frameRestoreLeft: write.frameRestore !== undefined
      }
      if (!samePage) lastRestore = 'dropped'
      fallback = setTimer(() => {
        fallback = undefined
        if (!disposed && armed !== undefined && armed.reloadStartedAt === undefined) {
          logger.debug('Preview comments: no watcher reload after a write; reloading')
          deps.reload()
        }
      }, FALLBACK_RELOAD_MS)
    },

    async reloadKeepingPlace() {
      const scroll = await captureScroll()
      if (disposed) return
      cancelFallback()
      // No file was written: nothing to drop as an echo, and no fallback to arm.
      armed = {
        realPath: '',
        fileHash: '',
        ...(scroll === undefined ? {} : { scroll }),
        page: deps.currentPage(),
        armedAt: deps.now(),
        restoreDue: false,
        committed: false,
        sectionsDue: false,
        frameRestoreLeft: false
      }
      deps.reload()
    },

    reloadStarting() {
      reloads += 1
      if (armed !== undefined && armed.reloadStartedAt === undefined) {
        armed.reloadStartedAt = deps.now()
        cancelFallback()
      }
    },

    pageLoadEnded(end) {
      if (armed === undefined || end.reason !== 'committed') return
      const first = !armed.committed
      armed.committed = true
      if (armed.reloadStartedAt === undefined || key(end.load.filePath) !== key(armed.page ?? end.load.filePath)) {
        // Another page is on screen: nothing is restored onto it (M-042).
        if (armed.scroll !== undefined) lastRestore = 'dropped'
        armed = { ...armed, scroll: undefined, restoreDue: false, sectionsDue: false }
        return
      }
      armed.restoreDue = armed.scroll !== undefined
      // Only the write's own reload: a later commit of the page is an ordinary load.
      armed.sectionsDue = first && armed.scroll?.openSections !== undefined
    },

    didFinishLoad() {
      if (armed === undefined || !armed.restoreDue) return
      armed.restoreDue = false
      void restore(armed)
    },

    frameRestoreFor(realPath) {
      const write = armed
      if (write === undefined || !write.frameRestoreLeft || write.frameRestore === undefined) return undefined
      if (deps.now() - write.armedAt > FRAME_RESTORE_WINDOW_MS || key(write.frameRestore.realPath) !== key(realPath)) {
        return undefined
      }
      write.frameRestoreLeft = false
      return { x: write.frameRestore.x, y: write.frameRestore.y }
    },

    sectionsFor(realPath) {
      const write = armed
      if (write === undefined || !write.sectionsDue) return undefined
      write.sectionsDue = false
      return key(realPath) === key(write.page ?? realPath) ? write.scroll?.openSections : undefined
    },

    filterChange(path, record) {
      const write = armed
      const started = write?.reloadStartedAt
      if (write === undefined || started === undefined || deps.now() - started > ECHO_WINDOW_MS || key(path) !== key(write.realPath)) {
        record()
        return
      }
      void hashOf(path).then(hash => {
        if (disposed) return
        if (hash === write.fileHash) {
          echoes += 1
          return
        }
        record()
      })
    },

    stats: () => ({ reloads, echoes, ...(lastRestore === undefined ? {} : { lastRestore }) }),

    dispose() {
      disposed = true
      cancelFallback()
      armed = undefined
    }
  }
}
