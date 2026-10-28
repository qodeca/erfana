// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, for the comment window's live
 * region (docs/designs/comments/html-preview-comments.md §10.2, §10.8, §10.10
 * "Announce"; test E-022; security review S-L-A).
 *
 * The page holds no screen-reader text: anything in the page DOM is counted
 * by Find in page. The preload sends a `step` pick – what the picker reached,
 * and for an element its token – and main passes it on in
 * `commentModeChanged` (reason `picker`); the renderer words the sentence.
 *
 * What it says about the element is main's own: the tag main parsed for the
 * token and the line of its start tag in the file served – never the page's
 * ids or classes, which would let a page put any sentence it likes into the
 * reader's screen reader, in Erfana's voice.
 */
import type { CommentModeChanged, CommentPickerElement } from '../../../../shared/ipc/preview-comment-schema'
import { CommentTagNameSchema } from '../../../../shared/ipc/preview-comment-page-schema'
import type { ElementTokenEntry } from './ElementTokenTable'

/** What a checked `step` pick reached: the top, a leaf, or an element of the frame's own load. */
export type PickerStepInput =
  | { readonly say: 'top' | 'no-child' }
  | {
      readonly say: 'showing'
      readonly entry: Pick<ElementTokenEntry, 'tagName' | 'line'>
      /** The element reached lies below the tokened one (a script built it). */
      readonly added?: true
    }

/** A picker event's step: what it reached, and for an element main's facts about it. */
export type PickerStep = Required<Pick<CommentModeChanged, 'say'>> & Pick<CommentModeChanged, 'element'>

/**
 * The step to pass on. A tag that no tag name can spell (parse5 keeps
 * whatever a start tag says) is left out rather than passed on.
 *
 * @param step - The checked step.
 * @returns The `say` and `element` fields of the event.
 */
export function pickerStepOf(step: PickerStepInput): PickerStep {
  if (step.say !== 'showing') return { say: step.say }
  const { tagName, line } = step.entry
  const element: CommentPickerElement = {
    ...(CommentTagNameSchema.safeParse(tagName).success ? { tag: tagName } : {}),
    line: Math.max(1, line),
    ...(step.added ? { added: true as const } : {})
  }
  return { say: 'showing', element }
}
