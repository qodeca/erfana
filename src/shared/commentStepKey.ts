// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment stepper's keys: one rule for both processes (comments-v2 C-13,
 * STA-12; spec 024 differences table § 3 "the stepper and its keys").
 *
 * Alt+F9 is the next comment and Alt+Shift+F9 the previous one – ⌥F9 and
 * ⇧⌥F9 on macOS – VS Code's next-comment-thread pair. Matched on the PHYSICAL
 * key (`code`), so a layout or an F-key row that types something else still
 * steps; Ctrl and Cmd are never held.
 *
 * Asked by the comment window and the Markdown Preview's scroller in the
 * renderer, and by main in the HTML page's `before-input-event`
 * (`previewInputForward.ts`), so the three never disagree about which press
 * is a step.
 */

/** A step's direction. */
export type CommentStep = 'next' | 'previous'

/** The physical key of the pair. */
export const COMMENT_STEP_CODE = 'F9'

/** A key press reduced to what the rule reads: Electron's `Input` names, so main passes it as it is. */
export interface CommentStepKeyInput {
  readonly code: string
  readonly alt: boolean
  readonly shift: boolean
  readonly control: boolean
  readonly meta: boolean
}

/**
 * The step a key press asks for.
 *
 * @param input - {@link CommentStepKeyInput}
 * @returns `'next'` for Alt+F9, `'previous'` for Alt+Shift+F9, else `null`.
 *
 * @example
 * ```ts
 * commentStepOf({ code: 'F9', alt: true, shift: true, control: false, meta: false }) // 'previous'
 * ```
 */
export function commentStepOf(input: CommentStepKeyInput): CommentStep | null {
  if (input.code !== COMMENT_STEP_CODE || !input.alt || input.control || input.meta) return null
  return input.shift ? 'previous' : 'next'
}

/**
 * {@link commentStepOf} for a DOM keyboard event.
 *
 * @param event - The key event.
 * @returns The step, or `null`.
 */
export function commentStepFromDomEvent(
  event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>
): CommentStep | null {
  return commentStepOf({
    code: event.code,
    alt: event.altKey,
    shift: event.shiftKey,
    control: event.ctrlKey,
    meta: event.metaKey
  })
}
