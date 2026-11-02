// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "New comment" in a window that has no pin's draft: one opened from a drawer
 * row or a step key, or moved by a step (comments-v2 C-22; owner decision,
 * 2026-11-01). Main builds the draft for the thread's element when asked, and
 * sends it as any other `open` draft; a refusal is said here, and the window
 * stays as it is.
 *
 * @module HtmlPreviewPanel/comments/previewNewOnThread
 */
import { commentGateway } from '../../../../services/preview/commentGateway'
import type { CommentListState } from '../../../../stores/usePreviewCommentStore'
import { HTML_WORDS } from '../../../Comments/commentCopyWords'

/**
 * What "New comment" does for a thread.
 *
 * @param panelId - The panel.
 * @param list - The list the window shows.
 * @param threadKey - The thread shown.
 * @param alert - Says a refusal.
 * @returns The action, or `null` when the list no longer holds the thread (removed outside, W-04).
 */
export function newOnThreadAction(panelId: string, list: CommentListState, threadKey: string, alert: (text: string) => void): (() => void) | null {
  const file = list.files.find(one => one.threads.some(thread => thread.threadKey === threadKey))
  if (file === undefined) return null
  return () => {
    void commentGateway.newOnThread(panelId, threadKey).then(answer => {
      if (!answer.ok) alert(HTML_WORDS.saveFailure(answer.code, file.displayPath).text)
    })
  }
}
