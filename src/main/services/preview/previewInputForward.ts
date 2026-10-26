// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview keyboard forwarding (Issue #74, work item 36).
 *
 * A ONE-WAY DOOR on what the sealed preview box lets through to Erfana. The
 * previewed page owns its own keyboard, EXCEPT for a closed, frozen list of keys
 * that Erfana needs for its own chrome: four accelerators (find, save, close,
 * escape) and, since issue #124, Back and Forward.
 * `before-input-event` is Chromium's pre-dispatch input pipeline — NOT a
 * page-callable API — so the page cannot forge or observe this channel.
 *
 * `accel` is Cmd on macOS and Ctrl elsewhere. Back and Forward are bound
 * differently – Cmd+[ / Cmd+] on macOS, Alt+Left / Alt+Right elsewhere, on the
 * PHYSICAL key – by the one table in `previewNavKeys`, which the panel root
 * reads too, so the two can never disagree about which key is Back. Nothing
 * outside the frozen list is ever forwarded (design §1.9): Cmd+R, Cmd+P and
 * plain typing all stay with the page.
 *
 * HTML Preview comments add one row of their own, `PREVIEW_COMMENT_TOGGLE`,
 * taken only while comments are on for the view – and, while comment mode is
 * on, leave Esc with the page, whose preload leaves the mode
 * (html-preview-comments.md §3, §7.1, §10.1; M-052).
 *
 * @see docs/designs/sd-074-html-preview.md §1.9, §0 (Enumerated keystrokes)
 * @see docs/designs/design-issue-124-part3.md §3.7
 */

import { matchPreviewNavKey, type PreviewNavAction } from '../../../shared/previewNavKeys'

/** A forwarded key. `accel` true ⇒ requires Cmd (macOS) / Ctrl (else). */
export interface ForwardedShortcut {
  readonly key: string
  readonly accel: boolean
  /**
   * A history step (issue #124). Matched on the physical key through the
   * shared table in `previewNavKeys`, never on `key`, which names the action;
   * `accel` is always `false` on such a row.
   */
  readonly nav?: true
}

/**
 * The complete, frozen set of accelerators the sealed box forwards. Adding a key
 * here is the ONLY way to widen the input bridge, by design.
 */
export const PREVIEW_FORWARDED_SHORTCUTS = Object.freeze([
  { key: 'f', accel: true },
  { key: 's', accel: true },
  { key: 'w', accel: true },
  // NO zoom keys. Cmd/Ctrl +/-/0 reach a focused preview through the View menu
  // instead (`menu.ts` -> `zoomFocused` -> `wc.setZoomLevel`), which is a real
  // PAGE zoom and is what satisfies WCAG 2.2 SC 1.4.4 here.
  //
  // They were briefly listed here as well, which was dead weight in one
  // direction and a hazard in the other: `PreviewForwardedShortcutSchema` never
  // enumerated them, so every one was dropped at the IPC boundary and the
  // renderer's zoom branch never ran. Widening that enum to "fix" it would have
  // made a single keypress zoom TWICE — once from the accelerator and once from
  // the forward — which is the collision `menu.ts` replaced the built-in zoom
  // roles to avoid.
  { key: 'Escape', accel: false },
  // Back and Forward (issue #124, part 3 §3.7). Their binding is not the
  // Cmd/Ctrl rule – it is Alt on Windows and Linux – so `accel` is `false` for
  // both, and the renderer routes them on `key` alone.
  { key: 'back', accel: false, nav: true },
  { key: 'forward', accel: false, nav: true }
] as const satisfies readonly ForwardedShortcut[])

/**
 * The comment-mode toggle: Ctrl+Alt+M, Cmd+Option+M on macOS. Its own frozen
 * row, outside the list above, because it is taken only while comments are on
 * for the view – off, the chord stays with the page. Matched on the TYPED key,
 * never the physical one: AltGr is Ctrl+Alt on Windows, and AltGr+M types µ on
 * a German layout, which must go on typing µ. On macOS Option+M itself types µ,
 * and with Cmd down that is still this chord (AltGr does not exist there).
 */
export const PREVIEW_COMMENT_TOGGLE = Object.freeze({
  key: 'comment-mode',
  typed: 'm',
  darwinTyped: Object.freeze(['m', 'µ'])
} as const)

/** What the forwarder asks about the view's comments, per key press. */
export interface CommentKeyState {
  /** Comments are on for the view: the toggle is the view's to take. */
  readonly enabled: () => boolean
  /** Comment mode is on: Esc stays with the page, whose preload leaves the mode. */
  readonly modeOn: () => boolean
}

/**
 * The slice of Electron's `Input` this module reads. Declared locally so the
 * module needs no `electron` import; Electron's `Input` is structurally
 * assignable to it.
 */
export interface ForwardableInput {
  type: string
  key: string
  /** The physical key (`KeyboardEvent.code`); Back and Forward match on it (spike S8). */
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** The slice of the `before-input-event` event object this module uses. */
export interface InputForwardEvent {
  preventDefault(): void
}

/**
 * The slice of `WebContents` this module attaches to. Electron's `WebContents`
 * is structurally assignable to it.
 */
export interface InputForwardTarget {
  on(
    event: 'before-input-event',
    listener: (event: InputForwardEvent, input: ForwardableInput) => void
  ): void
  removeListener(
    event: 'before-input-event',
    listener: (event: InputForwardEvent, input: ForwardableInput) => void
  ): void
}

/**
 * Match an input event against the frozen shortcut list.
 *
 * @returns the matched shortcut's `key`, or `null`.
 *
 * Only `keyDown` is considered. For an `accel` shortcut the platform accelerator
 * (Cmd on `darwin`, Ctrl elsewhere) must be down. For a non-`accel` shortcut
 * (Escape) NO accelerator, meta or alt may be down, so Cmd+Escape or Alt+Escape
 * are not forwarded. A `nav` row (Back, Forward) matches when the shared table
 * in `previewNavKeys` names its action: the physical key, its one modifier, and
 * nothing else down.
 */
export function matchForwardedShortcut(
  input: ForwardableInput,
  platform: NodeJS.Platform = process.platform,
  comments?: CommentKeyState
): string | null {
  if (input.type !== 'keyDown') {
    return null
  }

  if (comments !== undefined && comments.enabled() && matchCommentToggle(input, platform)) {
    return PREVIEW_COMMENT_TOGGLE.key
  }

  const accelDown = platform === 'darwin' ? input.meta : input.control
  const navAction = matchPreviewNavKey(input, platform)

  for (const shortcut of PREVIEW_FORWARDED_SHORTCUTS) {
    if (matchesShortcut(shortcut, input, accelDown, navAction)) {
      // In comment mode the page's preload takes Esc: it leaves the mode first.
      return shortcut.key === 'Escape' && comments?.modeOn() === true ? null : shortcut.key
    }
  }

  return null
}

/**
 * Whether a key press is the comment-mode toggle: the typed `m` (µ too on
 * macOS) with exactly Ctrl+Alt, or Cmd+Option on macOS – Shift never.
 */
export function matchCommentToggle(
  input: ForwardableInput,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (input.type !== 'keyDown' || input.shift) {
    return false
  }
  const typed = input.key.toLowerCase()
  if (platform === 'darwin') {
    return input.meta && input.alt && !input.control && PREVIEW_COMMENT_TOGGLE.darwinTyped.some((key) => key === typed)
  }
  return input.control && input.alt && !input.meta && typed === PREVIEW_COMMENT_TOGGLE.typed
}

/** One row of the frozen list against one key press. */
function matchesShortcut(
  shortcut: ForwardedShortcut,
  input: ForwardableInput,
  accelDown: boolean,
  navAction: PreviewNavAction | null
): boolean {
  if (shortcut.nav === true) {
    return navAction === shortcut.key
  }
  if (input.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false
  }
  return shortcut.accel ? accelDown : !input.meta && !input.control && !input.alt
}

/**
 * Attach forwarding to a preview `WebContents`.
 *
 * On a matched shortcut the event's default (page handling) is prevented and
 * `onShortcut(key)` is invoked with the canonical key from the frozen list.
 *
 * @returns a detach function that removes the listener.
 */
export function attachInputForwarding(
  target: InputForwardTarget,
  onShortcut: (key: string) => void,
  platform: NodeJS.Platform = process.platform,
  comments?: CommentKeyState
): () => void {
  const listener = (event: InputForwardEvent, input: ForwardableInput): void => {
    const key = matchForwardedShortcut(input, platform, comments)
    if (key !== null) {
      event.preventDefault()
      onShortcut(key)
    }
  }

  target.on('before-input-event', listener)
  return () => target.removeListener('before-input-event', listener)
}
