// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentSave` for one view (docs/designs/html-preview-comments.md
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
 * in flight until then, so a retry cannot write twice. When such a late write
 * lands it is handled as one that answered in time – the reload and the
 * reader's place – and the window is told the comments changed
 * (`lateLanded`). A draft is consumed only by a write; a refusal leaves it for
 * the next try, with the window's text kept (M-056, M-057). A landed write is
 * handed to the reload coordinator, which restores the reader's place after
 * the reload.
 */
import { ErrorCode } from '../../../../shared/errors'
import type { CommentSaveRequest, CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { TimeoutError, withTimeout } from '../../../utils/withTimeout'
import { logger } from '../../LoggingService'
import type { CommentWriter, CommentWriteResult, ThreadChange } from './CommentWriter'
import type { CommentBinding, CommentKeyStore } from './commentKeyStore'
import type { CommentDraft } from './commentDraftBuilder'
import type { ArmedWrite } from './commentReloadCoordinator'
import type { TopScroll } from './commentScripts'
import { samePathKey } from './commentUnsavedSources'

/** Longest a save waits for the writer before it answers `COMMENT_SAVE_PENDING`. */
export const SAVE_TIMEOUT_MS = 15_000

/** What the flow is built from. */
export interface SaveFlowDeps {
  readonly binding: CommentBinding
  readonly realRoot: string
  readonly keys: CommentKeyStore<CommentDraft>
  readonly writer: Pick<CommentWriter, 'add' | 'changeThread' | 'deleteDamagedBlock'>
  /** The top frame's scroll before a write (the reload coordinator). */
  readonly captureScroll: () => Promise<TopScroll | undefined>
  /** The page on screen, where a thread change's restore lands. */
  readonly currentPage: () => string
  /** A write landed. */
  readonly landed: (write: ArmedWrite) => void
  /** A write that outlasted its answer landed after all: tell the window its comments changed. */
  readonly lateLanded?: () => void
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}

type Refused = Extract<CommentSaveResult, { ok: false }>
type Written = Extract<CommentWriteResult, { ok: true }>

const refused = (code: ErrorCode): Refused => ({ ok: false, code })
const INVALID = refused(ErrorCode.COMMENT_KEY_INVALID)

/** The thread change a non-add request asks for. */
function changeOf(request: Exclude<CommentSaveRequest, { op: 'add' | 'deleteBlock' }>): ThreadChange {
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
export function createCommentSaveFlow(deps: SaveFlowDeps): (request: CommentSaveRequest) => Promise<CommentSaveResult> {
  const timeoutMs = deps.timeoutMs ?? SAVE_TIMEOUT_MS
  const same = (a: string, b: string): boolean => samePathKey(a, deps.platform) === samePathKey(b, deps.platform)

  /**
   * Wait for `write`. At the time limit answer `pending` – still being
   * written – and, should it land later, hand it to `land` then. A write that
   * threw is `failed`.
   */
  async function bounded(
    write: Promise<CommentWriteResult>,
    land: (result: Written) => void
  ): Promise<CommentWriteResult | 'pending' | 'failed'> {
    try {
      return await withTimeout(write, timeoutMs, 'Preview comments: save')
    } catch (error) {
      if (!(error instanceof TimeoutError)) return 'failed'
      logger.warn('Preview comments: a save outlasted its time limit', { ms: timeoutMs })
      void write.then(
        result => {
          if (!result.ok) return
          logger.info('Preview comments: a save that outlasted its time limit landed')
          land(result)
          deps.lateLanded?.()
        },
        () => undefined
      )
      return 'pending'
    }
  }

  /** The answer for a write that is still running, refused or landed; `land` runs for a landed one. */
  async function answer(
    write: Promise<CommentWriteResult>,
    land: (result: Written) => void
  ): Promise<{ readonly ok: true; readonly result: Written } | Refused> {
    const result = await bounded(write, land)
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
    const done = await answer(write, result =>
      deps.landed({
        realPath: result.realPath,
        fileHash: result.fileHash,
        ...(scroll === undefined ? {} : { scroll }),
        ...(draft.pageRealPath === undefined ? {} : { page: draft.pageRealPath }),
        ...(draft.frame ? { frameRestore: { realPath: draft.realPath, x: draft.view.x, y: draft.view.y } } : {})
      })
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
      return finish(write, scroll, null)
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
    return finish(write, scroll, request.threadKey)
  }

  async function finish(
    write: Promise<CommentWriteResult>,
    scroll: TopScroll | undefined,
    threadKey: string | null
  ): Promise<CommentSaveResult> {
    const done = await answer(write, result =>
      deps.landed({ realPath: result.realPath, fileHash: result.fileHash, ...(scroll === undefined ? {} : { scroll, page: deps.currentPage() }) })
    )
    if (!done.ok) return done
    return { ok: true, threadKey: done.result.threadId === null ? null : threadKey }
  }

  return request => (request.op === 'add' ? add(request) : change(request))
}
