// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML preview's Back and Forward keys: one table for both processes
 * (issue #124, part 3 §3.7).
 *
 * Main forwards these keys when focus is inside the page (`previewInputForward`),
 * and the panel root handles them when focus is in Erfana's own chrome. Both ask
 * {@link matchPreviewNavKey}, so the two can never disagree about which key is
 * Back.
 *
 * - macOS: Cmd+[ and Cmd+], as in Safari and Finder.
 * - Windows and Linux: Alt+Left Arrow and Alt+Right Arrow, as in Edge and File
 *   Explorer.
 * - No other modifier may be down, and only a key press counts, never a release.
 *
 * Matching reads the PHYSICAL key (`code`), never the typed character (`key`):
 * the key right of P is Back on every keyboard layout, including one where it
 * types something other than `[` (spike S8). One rule, and no second key is
 * taken from the page's text fields.
 *
 * Nothing here reads the platform itself; callers pass it in (`process.platform`
 * in main, `getRendererPlatform()` in the renderer).
 *
 * @see docs/design/design-issue-124-part3.md §3.7
 */

/** A history step a key can ask for. */
export type PreviewNavAction = 'back' | 'forward'

/** The one modifier a binding needs; every other modifier must be up. */
export type PreviewNavModifier = 'meta' | 'alt'

/** One key binding, with the strings the UI shows for it. */
export interface PreviewNavKeyRow {
  readonly action: PreviewNavAction
  /** The physical key: `KeyboardEvent.code`, which Electron's `Input.code` mirrors. */
  readonly code: string
  readonly modifier: PreviewNavModifier
  /** The shortcut as a tooltip writes it, for example `Cmd+[` or `Alt+Left Arrow`. */
  readonly label: string
  /** The `aria-keyshortcuts` value, for example `Meta+[` or `Alt+ArrowLeft`. */
  readonly ariaKeyShortcuts: string
}

/**
 * A key event reduced to what the table reads. Electron's `Input` (from
 * `before-input-event`) already has this shape; a DOM `KeyboardEvent` goes
 * through {@link navKeyFromDomEvent} first.
 */
export interface PreviewNavKeyInput {
  /** `'keyDown'` for a press; anything else is ignored. */
  type: string
  code: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

/** The slice of a DOM (or React) `KeyboardEvent` that {@link navKeyFromDomEvent} reads. */
export interface DomKeyEventLike {
  type: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Back first, then Forward. */
type PreviewNavKeyPair = readonly [back: PreviewNavKeyRow, forward: PreviewNavKeyRow]

const MAC_ROWS: PreviewNavKeyPair = Object.freeze([
  {
    action: 'back',
    code: 'BracketLeft',
    modifier: 'meta',
    label: 'Cmd+[',
    ariaKeyShortcuts: 'Meta+['
  },
  {
    action: 'forward',
    code: 'BracketRight',
    modifier: 'meta',
    label: 'Cmd+]',
    ariaKeyShortcuts: 'Meta+]'
  }
] as const)

const WINDOWS_AND_LINUX_ROWS: PreviewNavKeyPair = Object.freeze([
  {
    action: 'back',
    code: 'ArrowLeft',
    modifier: 'alt',
    label: 'Alt+Left Arrow',
    ariaKeyShortcuts: 'Alt+ArrowLeft'
  },
  {
    action: 'forward',
    code: 'ArrowRight',
    modifier: 'alt',
    label: 'Alt+Right Arrow',
    ariaKeyShortcuts: 'Alt+ArrowRight'
  }
] as const)

/** The Back and Forward rows for a platform, Back first. */
export function previewNavKeyRows(platform: NodeJS.Platform): PreviewNavKeyPair {
  return platform === 'darwin' ? MAC_ROWS : WINDOWS_AND_LINUX_ROWS
}

/** The row for one action – what a tooltip and `aria-keyshortcuts` show for it. */
export function previewNavKeyFor(
  action: PreviewNavAction,
  platform: NodeJS.Platform
): PreviewNavKeyRow {
  const [back, forward] = previewNavKeyRows(platform)
  return action === 'back' ? back : forward
}

/** Reduces a DOM `keydown` / `keyup` to the shape the table reads. */
export function navKeyFromDomEvent(event: DomKeyEventLike): PreviewNavKeyInput {
  return {
    type: event.type === 'keydown' ? 'keyDown' : event.type,
    code: event.code,
    meta: event.metaKey,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey
  }
}

/**
 * The history step a key press asks for on this platform, or `null`.
 *
 * @example
 * ```ts
 * matchPreviewNavKey({ type: 'keyDown', code: 'BracketLeft', meta: true,
 *   control: false, alt: false, shift: false }, 'darwin') // 'back'
 * ```
 */
export function matchPreviewNavKey(
  input: PreviewNavKeyInput,
  platform: NodeJS.Platform
): PreviewNavAction | null {
  if (input.type !== 'keyDown') return null
  for (const row of previewNavKeyRows(platform)) {
    if (input.code === row.code && onlyModifierDown(input, row.modifier)) return row.action
  }
  return null
}

/** `modifier` is down and every other modifier is up. */
function onlyModifierDown(input: PreviewNavKeyInput, modifier: PreviewNavModifier): boolean {
  if (input.shift || input.control) return false
  return modifier === 'meta' ? input.meta && !input.alt : input.alt && !input.meta
}
