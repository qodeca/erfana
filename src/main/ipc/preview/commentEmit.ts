// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' main → renderer events
 * (docs/designs/html-preview-comments.md §8; tests I-005, SEC-07).
 *
 * The comment events carry comment text, authors and paths in project space,
 * so unlike most preview events they are never broadcast: each goes to the
 * ONE window that owns the view, and a target without a window id receives
 * none. Every payload is re-validated against its strict schema first – main
 * composed it, so a miss is a wiring bug, logged with the schema's issue codes
 * only (never a value: a message could quote a comment).
 */
import type { ZodType } from 'zod'
import { PreviewCommentEvents } from '../../../shared/ipc/preview-comment-channels'
import {
  CommentAnchorStatusSchema,
  CommentDraftOpenedSchema,
  CommentModeChangedSchema,
  CommentSaveSettledSchema,
  CommentsChangedSchema
} from '../../../shared/ipc/preview-comment-schema'
import type { PreviewCommentEmitters } from '../../services/preview/comments/commentServiceTypes'
import { logger } from '../../services/LoggingService'
import type { PreviewEmitTarget } from './emit'

/** What the comment emitters send through. */
export interface PreviewCommentEmitterDeps {
  /** The live renderer targets, each with its window id. */
  readonly resolveTargets: () => readonly PreviewEmitTarget[]
}

/** The issue codes of a failed parse – never the values that failed. */
export function issueCodesOf(error: { readonly issues: ReadonlyArray<{ readonly code: string }> }): string[] {
  return [...new Set(error.issues.map(issue => issue.code))].slice(0, 8)
}

/** Build the comment emitters. */
export function createPreviewCommentEmitters(deps: PreviewCommentEmitterDeps): PreviewCommentEmitters {
  function send(channel: string, schema: ZodType, windowId: number, payload: unknown): void {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      logger.warn('Preview comments: an event failed its schema and was not sent', {
        channel,
        issues: issueCodesOf(parsed.error)
      })
      return
    }
    for (const target of deps.resolveTargets()) {
      if (target.windowId !== windowId || target.isDestroyed()) continue
      try {
        target.send(channel, parsed.data)
      } catch {
        // The window closed between the check and the send.
      }
    }
  }

  return {
    draftOpened: (windowId, payload) =>
      send(PreviewCommentEvents.DRAFT_OPENED, CommentDraftOpenedSchema, windowId, payload),
    commentsChanged: (windowId, payload) =>
      send(PreviewCommentEvents.COMMENTS_CHANGED, CommentsChangedSchema, windowId, payload),
    anchorStatus: (windowId, payload) =>
      send(PreviewCommentEvents.ANCHOR_STATUS, CommentAnchorStatusSchema, windowId, payload),
    modeChanged: (windowId, payload) =>
      send(PreviewCommentEvents.MODE_CHANGED, CommentModeChangedSchema, windowId, payload),
    saveSettled: (windowId, payload) =>
      send(PreviewCommentEvents.SAVE_SETTLED, CommentSaveSettledSchema, windowId, payload)
  }
}
