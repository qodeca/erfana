// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard's way back OUT of a previewed page (issue #124, QG-11a H1).
 *
 * `preview:focusPage` gives OS keyboard focus to the preview's own
 * `WebContents`. A forwarded key whose renderer action puts focus in Erfana's
 * chrome – Escape focusing the band chip, Find focusing the find input – then
 * runs `element.focus()` in the HOST renderer. That is a DOM focus only: it
 * cannot take native focus back from a `WebContentsView` (Electron #18859), so
 * the keys would keep landing in the page and the reader would be trapped in it
 * (WCAG SC 2.1.2).
 *
 * So main hands native focus back to the host window's own `WebContents` – the
 * window that owns the view – BEFORE it tells the renderer about the key. The
 * renderer's DOM focus then lands in a contents that holds the keyboard. No
 * channel is involved and nothing is trusted from the renderer: the key was
 * matched in Chromium's pre-dispatch input pipeline, which the page cannot
 * forge, and the window is the one main attached the view to.
 */

import { logger } from '../LoggingService'

/**
 * The forwarded keys whose renderer action moves keyboard focus out of the page
 * (`usePreviewFindShortcuts`):
 *
 * - `f` opens the find bar and focuses its input;
 * - `w` closes the panel, destroying the page that holds focus – without this
 *   focus would go with it, to nothing;
 * - `Escape` closes the find bar and restores focus to the chrome, or with the
 *   bar closed focuses the band chip. Either way focus lands in the host.
 *
 * NOT listed, because their renderer action moves no focus and the reader is
 * still in the page: `s` (export to PDF, whose save dialog main opens) and
 * `back` / `forward` (a history step inside the page the reader is in).
 */
export const PREVIEW_HOST_FOCUS_KEYS = Object.freeze(['f', 'w', 'Escape'] as const)

/** The slice of the host `BrowserWindow` this module reads. Structural for tests. */
export interface PreviewHostFocusWindow {
  isDestroyed(): boolean
  /**
   * The host window's own page. Both members are optional so an older test
   * double reads as "cannot focus" rather than throwing; a `BrowserWindow`
   * always has both.
   */
  readonly webContents: { focus?(): void; isDestroyed?(): boolean }
}

/** Whether a forwarded key's renderer action moves focus into Erfana's chrome. */
export function movesFocusToHost(key: string): boolean {
  return (PREVIEW_HOST_FOCUS_KEYS as readonly string[]).includes(key)
}

/**
 * Give native keyboard focus to the host window's own `WebContents`.
 *
 * Never throws: a window or contents that is gone – closed between the key
 * press and this call – is skipped, and a failing `focus()` is logged with fixed
 * fields only.
 *
 * @returns `true` when focus was handed to the host contents.
 */
export function focusHostContents(window: PreviewHostFocusWindow): boolean {
  if (window.isDestroyed()) {
    return false
  }
  const contents = window.webContents
  if (typeof contents.focus !== 'function' || contents.isDestroyed?.() === true) {
    return false
  }
  try {
    contents.focus()
    return true
  } catch (error) {
    logger.warn('Preview could not return keyboard focus to the host window', {
      error: error instanceof Error ? error.name : typeof error
    })
    return false
  }
}

/** A host window that can also say whether it is the OS key window. Structural for tests. */
export interface PreviewHostKeyWindow extends PreviewHostFocusWindow {
  isFocused(): boolean
}

/**
 * Give native keyboard focus to the host contents for an Erfana surface main
 * is about to open over the page – the comment menu or window
 * (docs/designs/comments/html-preview-comments.md §19 "Rev 4 – owner test: comment
 * window focus and save key").
 *
 * A comment pick is a click or a key INSIDE the page, so the page holds native
 * focus when the menu or window opens, and the renderer's `textarea.focus()`
 * alone cannot take it back (Electron #18859): the reader's typing and
 * Cmd/Ctrl+Enter would keep landing in the page.
 *
 * Only while the window is the OS key window: building a draft reads the file
 * from disk (up to 25 MB), and `webContents.focus()` also raises its window –
 * a reader who switched to another app meanwhile must not be pulled back.
 * Then the renderer's DOM focus is still set, and nothing else changes.
 *
 * @param window - The window that owns the view.
 * @returns `true` when focus was handed to the host contents.
 */
export function focusHostWhileKey(window: PreviewHostKeyWindow): boolean {
  if (window.isDestroyed() || !window.isFocused()) {
    return false
  }
  return focusHostContents(window)
}

/**
 * Forward one matched key to the renderer, first returning native focus to the
 * host when the key's action moves focus there.
 *
 * The order is the point: the renderer acts on the key as soon as the event
 * arrives, and its DOM focus only takes the keyboard in a contents that already
 * holds native focus. The key is forwarded whatever the focus step answers.
 *
 * @param window - The window that owns the preview view.
 * @param key - The canonical key from `PREVIEW_FORWARDED_SHORTCUTS`.
 * @param forward - Sends the key to the renderer.
 */
export function forwardWithHostFocus(
  window: PreviewHostFocusWindow,
  key: string,
  forward: (key: string) => void
): void {
  if (movesFocusToHost(key)) {
    focusHostContents(window)
  }
  forward(key)
}
