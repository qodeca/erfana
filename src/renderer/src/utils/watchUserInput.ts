// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tells a delayed first focus whether the user pressed a pointer or a key
 * while it waited, so it can leave focus where the user put it.
 *
 * Why: a dialog's first focus lands on a timer (BaseDialog's 10 ms, the docked
 * comment window's next tick). On a slow machine a click into a field can come
 * first, and the timer then moved the next keystrokes onto another control
 * mid-word. A programmatic focus (a field focusing itself on mount) is not
 * user input, so it does not count.
 *
 * @module utils/watchUserInput
 */

/** A running watch: `acted()` reads it, `stop()` removes its listeners (idempotent). */
export interface UserInputWatch {
  readonly acted: () => boolean
  readonly stop: () => void
}

const EVENTS = ['pointerdown', 'mousedown', 'keydown'] as const

/**
 * Starts watching the document, in the capture phase, for a pointer or key press.
 *
 * @param doc - The document to watch.
 * @returns The watch.
 *
 * @example
 * ```ts
 * const input = watchUserInput()
 * const timer = setTimeout(() => {
 *   input.stop()
 *   if (input.acted() && dialog.contains(document.activeElement)) return
 *   target.focus()
 * }, 10)
 * ```
 */
export function watchUserInput(doc: Document = document): UserInputWatch {
  let acted = false
  let listening = true
  const mark = (): void => {
    acted = true
  }
  for (const type of EVENTS) doc.addEventListener(type, mark, true)
  return {
    acted: () => acted,
    stop: () => {
      if (!listening) return
      listening = false
      for (const type of EVENTS) doc.removeEventListener(type, mark, true)
    }
  }
}
