// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment-mode shortcut: one rule for both processes
 * (docs/designs/comments/html-preview-comments.md §3, §7.1, §10.1; M-052, L14).
 *
 * Main matches it in the page's `before-input-event` (`previewInputForward.ts`)
 * and the panel on its own chrome and its dockview group element
 * (`usePreviewComments`). Both ask {@link matchCommentModeKey}, so the two can
 * never disagree about which key press toggles the mode.
 *
 * - The TYPED key `m` with exactly Ctrl+Alt (Windows, Linux) or Cmd+Option
 *   (macOS) – no other modifier, Shift never, a press only.
 * - Typed, not physical: AltGr is Ctrl+Alt on Windows, and AltGr+M types µ on
 *   a German layout, which must go on typing µ.
 * - macOS only: Option changes the typed character with the layout (µ on ABC,
 *   Ķ on Polish), and with Cmd down that is still this chord – there is no
 *   AltGr there – so the physical KeyM stands in, but only when the typed key
 *   is not printable ASCII: a layout whose M position types another character
 *   (AZERTY's `,`) keeps its own chord.
 *
 * Nothing here reads the platform; callers pass `mac`
 * (`process.platform === 'darwin'` in main, `isMacOS()` in the renderer).
 */

/** The typed key, and the physical key that stands in for it on macOS. */
export const COMMENT_MODE_KEY = Object.freeze({ typed: 'm', macCode: 'KeyM' } as const)

/** A key press reduced to what the rule reads. Electron's `Input` already has this shape. */
export interface CommentModeKeyInput {
  /** `'keyDown'` for a press; anything else is ignored. */
  readonly type: string
  readonly key: string
  readonly code: string
  readonly meta: boolean
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
}

/** The slice of a DOM (or React) `KeyboardEvent` that {@link commentModeKeyFromDomEvent} reads. */
export interface DomCommentModeKeyLike {
  readonly type: string
  readonly key: string
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/** Reduces a DOM `keydown` to the shape the rule reads. */
export function commentModeKeyFromDomEvent(event: DomCommentModeKeyLike): CommentModeKeyInput {
  return {
    type: event.type === 'keydown' ? 'keyDown' : event.type,
    key: event.key,
    code: event.code,
    meta: event.metaKey,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey
  }
}

/** A single printable ASCII character: what a layout types for a letter or a punctuation key. */
function isPrintableAscii(key: string): boolean {
  return key.length === 1 && key >= ' ' && key <= '~'
}

/**
 * Whether a key press is the comment-mode shortcut.
 *
 * @param input - The key press.
 * @param mac - The platform is macOS.
 * @returns Whether it toggles comment mode.
 *
 * @example
 * ```ts
 * matchCommentModeKey({ type: 'keyDown', key: 'µ', code: 'KeyM', meta: false,
 *   control: true, alt: true, shift: false }, false) // false – AltGr+M types µ
 * ```
 */
export function matchCommentModeKey(input: CommentModeKeyInput, mac: boolean): boolean {
  if (input.type !== 'keyDown' || input.shift) return false
  const typedM = input.key.toLowerCase() === COMMENT_MODE_KEY.typed
  if (mac) {
    const physicalM = input.code === COMMENT_MODE_KEY.macCode && !isPrintableAscii(input.key)
    return input.meta && input.alt && !input.control && (typedM || physicalM)
  }
  return input.control && input.alt && !input.meta && typedM
}
