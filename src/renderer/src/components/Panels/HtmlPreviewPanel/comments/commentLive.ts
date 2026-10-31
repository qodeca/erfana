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
import { MD_SPOKEN_COPY } from '../../../Comments/commentCopyWords'
import { WINDOW_COPY } from '../../../Comments/commentWindowCopy'

/** Steps after the mode turns on that add the keys to use (C-10 "the first three steps"). */
export const PICKER_HINT_STEPS = 3

/**
 * §10.10 "Announce" – where the page's keyboard picker moved (§10.8, E-022).
 * The page holds no live region (Find in page would count its text), so main
 * passes each step on and the window's polite region says it.
 *
 * C-10: an element of the file is named by main's kind, line, first words
 * and open comments – "Paragraph, line 42: “We ship the beta…”. 2 comments."
 * (the words come from main's own parse of the file, never from the page:
 * `commentPickerSpeaker.ts`) – the same sentence as the Markdown picker; the first
 * {@link PICKER_HINT_STEPS} steps add the keys. A script-built element keeps
 * "Showing an element added by a script, inside …".
 *
 * @param step - Steps said since the mode turned on (0 for the first).
 * @returns The sentence, or `undefined` for an event that is not a picker step.
 */
export function pickerAnnouncement(event: Pick<CommentModeChanged, 'say' | 'element'>, step = PICKER_HINT_STEPS): string | undefined {
  if (event.say === 'top') return ANNOUNCE.pickerTop
  if (event.say === 'no-child') return ANNOUNCE.pickerNoChild
  // C-10: Tab or Shift+Tab with nowhere further to go.
  if (event.say === 'last') return WINDOW_COPY.pickerLast
  if (event.say === 'first') return WINDOW_COPY.pickerFirst
  const element = event.say === 'showing' ? event.element : undefined
  if (element === undefined) return undefined
  if (element.added === true || element.role === undefined) return ANNOUNCE.pickerShowing(element)
  const sentence = MD_SPOKEN_COPY.target(element.role, element.line, element.excerpt ?? '', element.comments ?? 0)
  return step < PICKER_HINT_STEPS ? `${sentence}${MD_SPOKEN_COPY.hint}` : sentence
}
