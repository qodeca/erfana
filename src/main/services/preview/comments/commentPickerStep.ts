// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, for the comment window's live
 * region (docs/designs/html-preview-comments.md §10.2, §10.8, §10.10
 * "Announce"; test E-022).
 *
 * The page holds no screen-reader text: anything in the page DOM is counted
 * by Find in page. The preload sends a `step` pick – what the picker reached,
 * and for an element the overlay's label – and main passes it on in
 * `commentModeChanged` (reason `picker`); the renderer words the sentence.
 * The label is page text (ids and classes), so it crosses with nothing hidden
 * (`visibleInline`) and cut to the event's bound.
 */
import { visibleInline } from '../../../../shared/htmlComments'
import {
  COMMENT_PICKER_LABEL_MAX_CHARS,
  type CommentModeChanged,
  type CommentPick
} from '../../../../shared/ipc/preview-comment-schema'

/** What a `step` pick reached (the pick schema requires it on every step). */
export type PickerSay = NonNullable<CommentPick['say']>

/** A picker event's step: what it reached, and the element's label when it reached one. */
export type PickerStep = Required<Pick<CommentModeChanged, 'say'>> & Pick<CommentModeChanged, 'label'>

/** The step to pass on for `say`; `label` – present with `showing` only, by the schema – shown and bounded. */
export function pickerStepOf(say: PickerSay, label: string | undefined): PickerStep {
  return label === undefined ? { say } : { say, label: visibleInline(label).slice(0, COMMENT_PICKER_LABEL_MAX_CHARS) }
}
