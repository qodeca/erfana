// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview keyboard forwarding (Issue #74, work item 36).
 *
 * A ONE-WAY DOOR on what the sealed preview box lets through to Erfana. The
 * previewed page owns its own keyboard, EXCEPT for a closed, frozen list of four
 * accelerators that Erfana needs for its own chrome (find, save, close, escape).
 * `before-input-event` is Chromium's pre-dispatch input pipeline — NOT a
 * page-callable API — so the page cannot forge or observe this channel.
 *
 * `accel` is Cmd on macOS and Ctrl elsewhere. Nothing outside the frozen list is
 * ever forwarded (design §1.9): Cmd+R, Cmd+P and plain typing all stay with the
 * page.
 *
 * @see docs/designs/sd-074-html-preview.md §1.9, §0 (Enumerated keystrokes)
 */

/** A forwarded accelerator. `accel` true ⇒ requires Cmd (macOS) / Ctrl (else). */
export interface ForwardedShortcut {
  readonly key: string
  readonly accel: boolean
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
  { key: 'Escape', accel: false }
] as const satisfies readonly ForwardedShortcut[])

/**
 * The slice of Electron's `Input` this module reads. Declared locally so the
 * module needs no `electron` import; Electron's `Input` is structurally
 * assignable to it.
 */
export interface ForwardableInput {
  type: string
  key: string
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
 * are not forwarded.
 */
export function matchForwardedShortcut(
  input: ForwardableInput,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (input.type !== 'keyDown') {
    return null
  }

  const accelDown = platform === 'darwin' ? input.meta : input.control

  for (const shortcut of PREVIEW_FORWARDED_SHORTCUTS) {
    if (input.key.toLowerCase() !== shortcut.key.toLowerCase()) {
      continue
    }
    if (shortcut.accel) {
      if (accelDown) {
        return shortcut.key
      }
    } else if (!input.meta && !input.control && !input.alt) {
      return shortcut.key
    }
  }

  return null
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
  platform: NodeJS.Platform = process.platform
): () => void {
  const listener = (event: InputForwardEvent, input: ForwardableInput): void => {
    const key = matchForwardedShortcut(input, platform)
    if (key !== null) {
      event.preventDefault()
      onShortcut(key)
    }
  }

  target.on('before-input-event', listener)
  return () => target.removeListener('before-input-event', listener)
}
