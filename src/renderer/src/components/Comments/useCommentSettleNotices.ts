// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what the panel says when a write that was answered
 * "still saving" settles (docs/designs/comments/html-preview-comments.md §8 Rev 3
 * note, §19 "Save pending settles").
 *
 * - **Landed**: the announcement a write answered in time gets ("Comment saved
 *   to {file}.", "Comment resolved.", …), and the new-comment window that sent
 *   it closes, as after a normal save. Main re-sends the counts, so the list
 *   is read again without being asked here.
 * - **Refused**, and no window shows that draft or thread: the refusal's
 *   §10.10 sentence from the panel's assertive region – the window that sent
 *   it may be long closed, and the text is still in the session drafts. An
 *   open window words its own refusal and offers Save again.
 *
 * @module HtmlPreviewPanel/comments/useCommentSettleNotices
 */
import { useEffect } from 'react'
import { ErrorCode } from '../../../../shared/errors'
import { useLatestRef } from '../../hooks/useLatestRef'
import { saveFailureCopy, writtenAnnouncement } from './commentCopy'
import { onCommentWriteSettled, writeKeyOf, type SettledCommentWrite } from './commentPendingWrites'
import { draftKeyOf, type CommentWindowRequest } from './commentWindowTypes'

/** Options for {@link useCommentSettleNotices}. */
export interface CommentSettleNoticeOptions {
  readonly panelId: string
  /** The window the tab shows now, if any. */
  readonly request: CommentWindowRequest | null
  /** The page's name, for a write that named no file. */
  readonly pageName: string
  readonly announce: (text: string) => void
  readonly alert: (text: string) => void
  /** Close the window, returning focus as Cancel would. */
  readonly closeWindow: () => void
}

/**
 * Whether `request`'s window shows the draft or thread a settled write was about.
 *
 * @param request - The tab's window.
 * @param settled - The settled write.
 * @returns Whether that window words the outcome itself.
 */
export function windowShows(request: CommentWindowRequest | null, settled: SettledCommentWrite): boolean {
  if (request === null || request.panelId !== settled.request.panelId) return false
  if (request.kind === 'new') return settled.draftKey !== undefined && settled.draftKey === draftKeyOf(request)
  const key = writeKeyOf(settled.request)
  return request.threadKeys.includes(key) || request.blockKeys.includes(key)
}

/**
 * Says how a tab's pending writes ended (see the module comment).
 *
 * @param options - {@link CommentSettleNoticeOptions}
 */
export function useCommentSettleNotices(options: CommentSettleNoticeOptions): void {
  const latest = useLatestRef(options)
  useEffect(
    () =>
      onCommentWriteSettled(settled => {
        const { panelId, request, pageName, announce, alert, closeWindow } = latest.current
        if (settled.request.panelId !== panelId) return
        const file = settled.file || pageName
        if (settled.event.ok) {
          announce(writtenAnnouncement(settled.request, file))
          const sentByThisWindow =
            request?.kind === 'new' &&
            settled.request.op === 'add' &&
            request.draftToken === settled.request.draftToken
          if (sentByThisWindow) closeWindow()
          return
        }
        if (!windowShows(request, settled)) {
          alert(saveFailureCopy(settled.event.code ?? ErrorCode.COMMENT_WRITE_FAILED, file).text)
        }
      }),
    [latest]
  )
}
