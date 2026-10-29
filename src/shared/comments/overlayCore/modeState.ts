// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment mode as a state machine (docs/designs/comments/html-preview-comments.md
 * §3 "Keyboard picker keys", §7.1; spec 024
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md § 2).
 *
 * Shared overlay core – pure, no imports, no globals, no DOM (see
 * `pinLayout.ts` and docs/adrs/0006-overlay-core-in-the-sealed-preload.md).
 *
 * The rules are the v0.23.1 preload's:
 *
 * - The window owns the mode. Its word (`set`) is taken as is.
 * - Esc while the mode is on is the overlay's: the key is kept from the page,
 *   the mode turns off at once, and the window is told the user left it (the
 *   preload's `exit` pick).
 * - Esc while the mode is off is the page's: nothing changes and the key
 *   passes through.
 *
 * Only the comment-mode step of spec 024's Esc order (menu → window → comment
 * mode → Find) lives here: the menu and the window are not the overlay's.
 */

/** Whether comment mode is on. */
export interface CommentModeState {
  readonly on: boolean
}

/** What can move comment mode. */
export type CommentModeEvent =
  /** The window says the mode is `on` (the preload: `commentState.mode`). */
  | { readonly type: 'set'; readonly on: boolean }
  /** A trusted Esc press reached the overlay. */
  | { readonly type: 'escape' }

/** The state after one event, and what the host must do about it. */
export interface CommentModeStep extends CommentModeState {
  /** The mode flipped: switch the cursor, and clear the picker when it turned off. */
  readonly changed: boolean
  /** Tell the window the user left comment mode. */
  readonly requestExit: boolean
  /** The key was the overlay's: keep it from the page. */
  readonly consumed: boolean
}

/** The one step `event` makes from `state`. */
export function reduceCommentMode(state: CommentModeState, event: CommentModeEvent): CommentModeStep {
  if (event.type === 'set') {
    return { on: event.on, changed: event.on !== state.on, requestExit: false, consumed: false }
  }
  if (!state.on) return { on: false, changed: false, requestExit: false, consumed: false }
  return { on: false, changed: true, requestExit: true, consumed: true }
}
