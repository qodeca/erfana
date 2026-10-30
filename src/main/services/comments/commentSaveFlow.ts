// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentSave` for one view (docs/designs/comments/html-preview-comments.md
 * §7.5, §7.6, §7.7, §9.1 S10, S23; tests M-051, M-053, M-056, M-057, SEC-08).
 *
 * The request names a draft token or main-minted keys, never a path or an
 * author. Here they are resolved against this view's binding – unknown,
 * foreign or stale ones are `COMMENT_KEY_INVALID`, an old draft
 * `COMMENT_DRAFT_EXPIRED` – the top frame's scroll is read, and the one write
 * runs through `CommentWriter`, which re-reads, re-locates and verifies.
 *
 * The answer comes within {@link SAVE_TIMEOUT_MS} even when the disk does not:
 * past it the save answers `COMMENT_SAVE_PENDING` – still being written, not
 * failed, so the window does not invite a second save of the same text. The
 * write itself keeps its per-file lock until it settles, and the draft stays
 * in flight until then, so a retry cannot write twice. However such a late
 * write ends, the window is told (`lateSettled`, sent on as
 * `preview:commentSaveSettled`): one that lands is handled as one that
 * answered in time – the reload and the reader's place – and reported `ok`;
 * one that is refused, or throws, is reported with its code, so the window can
 * turn "Still saving…" into the refusal and offer Save again. A draft is
 * consumed only by a write; a refusal leaves it for the next try, with the
 * window's text kept (M-056, M-057). A landed write is handed to the reload
 * coordinator, which restores the reader's place after the reload.
 */
import type { CommentAnchor, CommentView } from '../../../shared/comments/format'
import { ErrorCode } from '../../../shared/errors'
import type { CommentSaveRequest, CommentSaveResult, CommentSaveSettled } from '../../../shared/ipc/preview-comment-schema'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import { logger } from '../LoggingService'
import type { CommentWriter, CommentWriteResult, ThreadChange } from './CommentWriter'
import type { CommentBinding, CommentKeyStore } from './commentKeyStore'
import { samePathKey } from './commentUnsavedSources'

/** Longest a save waits for the writer before it answers `COMMENT_SAVE_PENDING`. */
export const SAVE_TIMEOUT_MS = 15_000

/** How a save that outlasted its answer ended, named by the request's own key (no panel: the service adds it). */
export type LateSettle = Omit<CommentSaveSettled, 'panelId'>

/** The request's own key: the draft token of an add, the block key of a block delete, else the thread key. */
type SaveRef = Pick<LateSettle, 'op' | 'draftToken' | 'threadKey' | 'blockKey'>

/** What a save reads of the draft an add claims; the view's own draft record carries at least this. */
export interface SaveDraft {
  /** The file, as main recorded it: the writer's target. */
  readonly realPath: string
  /** A frame's file rather than the page's own. */
  readonly frame: boolean
  /** UTF-16 offset of the target the block goes before. */
  readonly offset: number
  readonly fileHash: string
  readonly anchor: CommentAnchor
  /** The pick's computed `white-space-collapse` of the target's parent; missing → mid-line. */
  readonly ws?: string
  readonly view: CommentView
  /** The page's real path when the pick was made: a save restores only onto that page. */
  readonly pageRealPath?: string
}

/**
 * A write that landed, for the view to reload and restore the reader's place.
 *
 * @typeParam S - The view's own scroll snapshot.
 */
export interface LandedWrite<S> {
  /** The real path written. */
  readonly realPath: string
  /** SHA-256 of the bytes now on disk (`CommentWriteResult.fileHash`). */
  readonly fileHash: string
  /** The scroll before the write; absent: nothing to restore. */
  readonly scroll?: S
  /** The page the pick was made on: the scroll is restored only onto it. */
  readonly page?: string
  /** A frame's file: that frame's own scroll, for its next hello. */
  readonly frameRestore?: { readonly realPath: string; readonly x: number; readonly y: number }
}

/**
 * What the flow is built from.
 *
 * @typeParam D - The view's draft record.
 * @typeParam S - The view's scroll snapshot.
 */
export interface SaveFlowDeps<D extends SaveDraft, S> {
  readonly binding: CommentBinding
  readonly realRoot: string
  readonly keys: CommentKeyStore<D>
  readonly writer: Pick<CommentWriter, 'add' | 'changeThread' | 'deleteDamagedBlock'>
  /** The view's scroll before a write (the reload coordinator). */
  readonly captureScroll: () => Promise<S | undefined>
  /** The page on screen, where a thread change's restore lands. */
  readonly currentPage: () => string
  /** A write landed. */
  readonly landed: (write: LandedWrite<S>) => void
  /** A write that outlasted its answer settled after all – landed or not: tell the window how. */
  readonly lateSettled?: (settled: LateSettle) => void
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}

type Refused = Extract<CommentSaveResult, { ok: false }>
type Written = Extract<CommentWriteResult, { ok: true }>

const refused = (code: ErrorCode): Refused => ({ ok: false, code })
const INVALID = refused(ErrorCode.COMMENT_KEY_INVALID)

/** The thread change a non-add request asks for. */
export function changeOf(request: Exclude<CommentSaveRequest, { op: 'add' | 'deleteBlock' }>): ThreadChange {
  switch (request.op) {
    case 'reply':
      return { op: 'reply', text: request.text }
    case 'editMessage':
      return { op: 'editMessage', messageId: request.messageId, text: request.text }
    case 'deleteMessage':
      return { op: 'deleteMessage', messageId: request.messageId }
    case 'setStatus':
      return { op: 'setStatus', status: request.status }
    case 'deleteThread':
      return { op: 'deleteThread' }
  }
}

/** One view's save path. */
export function createCommentSaveFlow<D extends SaveDraft, S>(
  deps: SaveFlowDeps<D, S>
): (request: CommentSaveRequest) => Promise<CommentSaveResult> {
  const timeoutMs = deps.timeoutMs ?? SAVE_TIMEOUT_MS
  const same = (a: string, b: string): boolean => samePathKey(a, deps.platform) === samePathKey(b, deps.platform)

  /**
   * A write that outlasted its answer settled: hand a landed one to `land`,
   * then tell the window how it ended – whatever that was.
   */
  function settleLate(write: Promise<CommentWriteResult>, land: (result: Written) => void, ref: SaveRef): void {
    void write.then(
      result => {
        if (result.ok) {
          logger.info('Preview comments: a save that outlasted its time limit landed')
          land(result)
          deps.lateSettled?.({ ...ref, ok: true })
          return
        }
        logger.info('Preview comments: a save that outlasted its time limit was refused', { code: result.code })
        deps.lateSettled?.({ ...ref, ok: false, code: result.code })
      },
      () => {
        logger.warn('Preview comments: a save that outlasted its time limit failed')
        deps.lateSettled?.({ ...ref, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED })
      }
    )
  }

  /**
   * Wait for `write`. At the time limit answer `pending` – still being
   * written – and report how it ends later (`settleLate`). A write that threw
   * is `failed`.
   */
  async function bounded(
    write: Promise<CommentWriteResult>,
    land: (result: Written) => void,
    ref: SaveRef
  ): Promise<CommentWriteResult | 'pending' | 'failed'> {
    try {
      return await withTimeout(write, timeoutMs, 'Preview comments: save')
    } catch (error) {
      if (!(error instanceof TimeoutError)) return 'failed'
      logger.warn('Preview comments: a save outlasted its time limit', { ms: timeoutMs })
      settleLate(write, land, ref)
      return 'pending'
    }
  }

  /** The answer for a write that is still running, refused or landed; `land` runs for a landed one. */
  async function answer(
    write: Promise<CommentWriteResult>,
    land: (result: Written) => void,
    ref: SaveRef
  ): Promise<{ readonly ok: true; readonly result: Written } | Refused> {
    const result = await bounded(write, land, ref)
    if (result === 'pending') return refused(ErrorCode.COMMENT_SAVE_PENDING)
    if (result === 'failed') return refused(ErrorCode.COMMENT_WRITE_FAILED)
    if (!result.ok) return refused(result.code)
    land(result)
    return { ok: true, result }
  }

  async function add(request: Extract<CommentSaveRequest, { op: 'add' }>): Promise<CommentSaveResult> {
    const claim = deps.keys.claimDraft(request.draftToken, deps.binding)
    if (!claim.ok) return refused(claim.code)
    const draft = claim.value
    const scroll = await deps.captureScroll()
    const write = deps.writer.add({
      file: { realRoot: deps.realRoot, filePath: draft.realPath },
      draft: { offset: draft.offset, fileHash: draft.fileHash, anchor: draft.anchor, ...(draft.ws === undefined ? {} : { ws: draft.ws }) },
      view: draft.view,
      text: request.text
    })
    // Settled when the WRITE settles, not when the answer goes: no second write while one runs.
    void write.then(
      result => deps.keys.settleDraft(request.draftToken, result.ok),
      () => deps.keys.settleDraft(request.draftToken, false)
    )
    const done = await answer(
      write,
      result =>
        deps.landed({
          realPath: result.realPath,
          fileHash: result.fileHash,
          ...(scroll === undefined ? {} : { scroll }),
          ...(draft.pageRealPath === undefined ? {} : { page: draft.pageRealPath }),
          ...(draft.frame ? { frameRestore: { realPath: draft.realPath, x: draft.view.x, y: draft.view.y } } : {})
        }),
      { op: 'add', draftToken: request.draftToken }
    )
    if (!done.ok) return done
    const threadId = done.result.threadId as string
    return { ok: true, threadKey: deps.keys.keyFor(deps.binding, { kind: 'thread', realPath: draft.realPath, threadId }) }
  }

  async function change(request: Exclude<CommentSaveRequest, { op: 'add' }>): Promise<CommentSaveResult> {
    const file = deps.keys.resolve(deps.binding, request.fileKey, 'file')
    if (!file.ok) return INVALID
    const realPath = file.value.realPath
    let write: Promise<CommentWriteResult>
    if (request.op === 'deleteBlock') {
      const block = deps.keys.resolve(deps.binding, request.blockKey, 'block')
      if (!block.ok || !same(block.value.realPath, realPath) || block.value.rawHash !== request.rawHash) return INVALID
      const scroll = await deps.captureScroll()
      write = deps.writer.deleteDamagedBlock({ file: { realRoot: deps.realRoot, filePath: realPath }, rawHash: request.rawHash, start: block.value.start })
      return finish(write, scroll, null, { op: 'deleteBlock', blockKey: request.blockKey })
    }
    const thread = deps.keys.resolve(deps.binding, request.threadKey, 'thread')
    if (!thread.ok || !same(thread.value.realPath, realPath)) return INVALID
    const scroll = await deps.captureScroll()
    write = deps.writer.changeThread({
      file: { realRoot: deps.realRoot, filePath: realPath },
      threadId: thread.value.threadId,
      rawHash: request.rawHash,
      change: changeOf(request)
    })
    return finish(write, scroll, request.threadKey, { op: request.op, threadKey: request.threadKey })
  }

  async function finish(
    write: Promise<CommentWriteResult>,
    scroll: S | undefined,
    threadKey: string | null,
    ref: SaveRef
  ): Promise<CommentSaveResult> {
    const done = await answer(
      write,
      result =>
        deps.landed({ realPath: result.realPath, fileHash: result.fileHash, ...(scroll === undefined ? {} : { scroll, page: deps.currentPage() }) }),
      ref
    )
    if (!done.ok) return done
    return { ok: true, threadKey: done.result.threadId === null ? null : threadKey }
  }

  return request => (request.op === 'add' ? add(request) : change(request))
}
