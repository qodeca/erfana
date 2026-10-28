// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments' main → renderer events
 * (docs/designs/comments/html-preview-comments.md §8; tests I-005, SEC-07).
 *
 * The comment events carry comment text, authors and paths in project space,
 * so unlike most preview events they are never broadcast: each goes to the
 * ONE window that owns the view, and a target without a window id receives
 * none. Every payload is re-validated against its strict schema first – main
 * composed it, so a miss is a wiring bug, logged with the schema's issue codes
 * only (never a value: a message could quote a comment).
 *
 * `draftOpened` first hands native keyboard focus to that window's own
 * contents (`target.focusHost`, only while the window is the OS key window):
 * the pick that opened the menu or window was a click or key inside the page,
 * which still holds focus, and the renderer's DOM focus alone cannot take it
 * back – the reader's typing and Cmd/Ctrl+Enter would land in the page (§19
 * "Rev 4 – owner test: comment window focus and save key").
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
  function send(channel: string, schema: ZodType, windowId: number, payload: unknown, focusHost = false): void {
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
      // Before the send: the renderer focuses the field as soon as the event
      // lands. A focus that fails still lets the event through.
      if (focusHost) {
        try {
          target.focusHost?.()
        } catch {
          // The window closed between the check and the focus.
        }
      }
      try {
        target.send(channel, parsed.data)
      } catch {
        // The window closed between the check and the send.
      }
    }
  }

  return {
    draftOpened: (windowId, payload) =>
      send(PreviewCommentEvents.DRAFT_OPENED, CommentDraftOpenedSchema, windowId, payload, true),
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
