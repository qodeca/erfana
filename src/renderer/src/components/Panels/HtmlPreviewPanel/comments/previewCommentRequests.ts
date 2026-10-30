// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the comment window a draft opens, and the save it
 * sends (spec 024 024-FR-004, 024-AC-004; comments-v2 C-07).
 *
 * A draft from main carries the target's text as main parsed it, and – when
 * the pick was made on a selection that main found in the file – the words'
 * range in it. "Comment on selection" opens the window on that range; "Comment
 * on the whole element", "Add comment" and "Comment on element" open it with
 * no words chosen, the Narrow to words field starting from the whole text.
 *
 * @module HtmlPreviewPanel/comments/previewCommentRequests
 */
import type { AnchorSelection } from '../../../../../../shared/comments/anchorSel'
import type { CommentSaveRequest } from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentWindowRequest, ElementDraft, NewCommentWords } from '../../../Comments/commentWindowTypes'

/** What a menu item or a pick comments on: the selected words, or the whole element. */
export type DraftScope = 'words' | 'whole'

/** The draft's words for `scope`; none when main sent no text. */
export function wordsOf(draft: ElementDraft, scope: DraftScope): NewCommentWords | undefined {
  const words = draft.words
  if (words === undefined) return undefined
  return scope === 'words' ? words : { ...words, start: 0, end: 0, cut: false }
}

/**
 * The new-comment window for `draft`, or `null` when main minted no draft
 * (the element cannot take a comment).
 */
export function newCommentRequest(
  panelId: string,
  draft: ElementDraft,
  scope: DraftScope
): Extract<CommentWindowRequest, { kind: 'new' }> | null {
  const { draftToken, draftKey, target } = draft
  if (draftToken === undefined || draftKey === undefined || target === undefined) return null
  const words = wordsOf(draft, scope)
  return {
    kind: 'new',
    panelId,
    draftToken,
    draftKey,
    target,
    file: draft,
    point: draft.point,
    opener: 'page',
    ...(words === undefined ? {} : { words }),
    // The words are not in the file as written: the window says the comment is on the whole element (024-FR-004).
    ...(scope === 'words' && draft.wordsMissing === true ? { wordsMissing: true as const } : {})
  }
}

/** A save with the words the window chose; a comment on the whole element sends none. */
export function withWords(request: CommentSaveRequest, sel: AnchorSelection | undefined): CommentSaveRequest {
  if (request.op !== 'add' || sel === undefined) return request
  return { ...request, sel: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } }
}
