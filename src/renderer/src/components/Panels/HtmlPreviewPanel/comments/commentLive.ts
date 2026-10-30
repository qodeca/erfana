// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what the page's keyboard picker says
 * (docs/designs/comments/html-preview-comments.md §10.8, §10.10 "Announce").
 *
 * The live region, the inner steps and the draft keys every preview shares
 * live in `components/Comments/commentLive.ts` (spec 024 architecture note 001
 * § 8 C22); only the picker, which runs inside the HTML page, is here.
 *
 * @module HtmlPreviewPanel/comments/commentLive
 */
import type { CommentModeChanged } from '../../../../../../shared/ipc/preview-comment-schema'
import { ANNOUNCE } from '../../../Comments/commentCopy'

/**
 * §10.10 "Announce" – where the page's keyboard picker moved (§10.8, E-022).
 * The page holds no live region (Find in page would count its text), so main
 * passes each step on and the window's polite region says it.
 *
 * @returns The sentence, or `undefined` for an event that is not a picker step.
 */
export function pickerAnnouncement(event: Pick<CommentModeChanged, 'say' | 'element'>): string | undefined {
  if (event.say === 'top') return ANNOUNCE.pickerTop
  if (event.say === 'no-child') return ANNOUNCE.pickerNoChild
  return event.say === 'showing' && event.element !== undefined ? ANNOUNCE.pickerShowing(event.element) : undefined
}
