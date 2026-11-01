// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the comment window asks of a listed thread's target, by its opaque key
 * (`preview:commentCommand`): show it, or start a new comment on it.
 *
 * A window opened from a drawer row or a step key never had the pin's draft
 * (comments-v2 C-22; owner decision, 2026-11-01), so "New comment" asks for one
 * here. The element comes from main's own record of the load: the block the
 * thread was served from names its token, and the page is not asked anything.
 * The key is this view's (`resolve` refuses any other), so a renderer can name
 * only a thread main listed for it, and the draft is built from disk like any
 * other (`commentDraftBuilder.ts`).
 */
import { ErrorCode } from '../../../../shared/errors'
import { CommentPickViewSchema, type CommentAck, type CommentPickView } from '../../../../shared/ipc/preview-comment-schema'
import { logger } from '../../LoggingService'
import { samePathKey } from '../../comments/commentUnsavedSources'
import type { CommentBinding, CommentKeyStore } from '../../comments/commentKeyStore'
import { withTimeout } from '../../../utils/withTimeout'
import type { CommentDraft } from './commentDraftBuilder'
import type { CommentDraftOpener } from './commentDraftOpener'
import type { CommentFrameLike, CommentFrames, FrameRecord } from './commentFrames'
import { COMMENT_SCRIPT_TIMEOUT_MS, COMMENT_WORLD_ID, READ_VIEW_SCRIPT } from './commentScripts'
import type { ElementTokenTable } from './ElementTokenTable'

/** What stands for the reader's place when the page does not answer: a new comment is worth more than this note. */
const NO_VIEW: CommentPickView = { w: 0, h: 0, dpr: 1, x: 0, y: 0 }

/** The actions' collaborators. */
export interface ThreadActionDeps {
  readonly binding: CommentBinding
  readonly keys: Pick<CommentKeyStore<CommentDraft>, 'resolve'>
  readonly frames: Pick<CommentFrames, 'liveFrames' | 'get' | 'isCommentable'>
  readonly tokens: Pick<ElementTokenTable, 'view' | 'lookup'>
  readonly opener: Pick<CommentDraftOpener, 'onThread'>
  readonly contents: { executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown> }
  /** Ask `frame` to scroll to its pin. */
  readonly showPin: (frame: CommentFrameLike, pinKey: string) => void
  readonly platform?: NodeJS.Platform
}

/** What the window asks of a thread's target. */
export interface ThreadActions {
  reveal(threadKey: string): CommentAck
  newComment(threadKey: string): Promise<CommentAck>
}

/** Build one view's actions. */
export function createThreadActions(deps: ThreadActionDeps): ThreadActions {
  /** The frames showing `realPath`, each with its record. */
  function* framesOf(realPath: string): Generator<readonly [CommentFrameLike, FrameRecord]> {
    const wanted = samePathKey(realPath, deps.platform)
    for (const frame of deps.frames.liveFrames()) {
      const record = deps.frames.get(frame.frameTreeNodeId)
      if (record?.file !== undefined && samePathKey(record.file.realPath, deps.platform) === wanted) yield [frame, record]
    }
  }

  /** The top frame's view now, in the isolated world; the page cannot answer for it. */
  async function readView(): Promise<CommentPickView> {
    try {
      const raw = await withTimeout(deps.contents.executeJavaScriptInIsolatedWorld(COMMENT_WORLD_ID, [{ code: READ_VIEW_SCRIPT }]), COMMENT_SCRIPT_TIMEOUT_MS, 'Preview comments: view read')
      const parsed = CommentPickViewSchema.safeParse(raw)
      return parsed.success ? parsed.data : NO_VIEW
    } catch (error) {
      logger.warn('Preview comments: the view could not be read', { error: error instanceof Error ? error.name : typeof error })
      return NO_VIEW
    }
  }

  return {
    reveal(threadKey) {
      const thread = deps.keys.resolve(deps.binding, threadKey, 'thread')
      if (!thread.ok) return { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
      for (const [frame, record] of framesOf(thread.value.realPath)) {
        for (const [pinKey, pin] of record.pins) {
          if (!pin.threadIds.includes(thread.value.threadId)) continue
          deps.showPin(frame, pinKey)
          return { ok: true }
        }
      }
      // Resolved, orphaned or not on screen: there is no pin to scroll to.
      return { ok: false, code: ErrorCode.COMMENT_TARGET_MOVED }
    },

    async newComment(threadKey) {
      const thread = deps.keys.resolve(deps.binding, threadKey, 'thread')
      if (!thread.ok) return { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
      for (const [frame, record] of framesOf(thread.value.realPath)) {
        if (record.loadId === undefined || !deps.frames.isCommentable(record)) continue
        const block = deps.tokens.view(record.loadId)?.blocks.find(one => one.kind === 'ok' && one.id === thread.value.threadId)
        const entry = block?.token === undefined ? undefined : deps.tokens.lookup(record.loadId, block.token)
        if (block === undefined || entry === undefined) continue
        const runtime = block.kind === 'ok' ? block.runtime : undefined
        return deps.opener.onThread(frame, record, entry, runtime, await readView())
      }
      // Its target is not in any frame shown now: a list older than the page.
      return { ok: false, code: ErrorCode.COMMENT_TARGET_MOVED }
    }
  }
}
