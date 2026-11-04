// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one source of the Cut, Copy, Paste and Delete menu items (#463), so
 * every right-click menu – editor, preview, text fields, project tree – shows
 * the same labels, icons and shortcut hints in the same order.
 *
 * Hints come from `formatShortcut`, so they read `⌘C` on macOS and `Ctrl+C`
 * elsewhere. Delete is the one key that differs by target:
 *
 * | Target | macOS | Windows / Linux |
 * | --- | --- | --- |
 * | Selected text | `⌫` | `Delete` |
 * | A project item | `⌘⌫` (as in Finder) | `Delete` |
 *
 * The terminal keeps its own menu: its paste key differs per platform
 * (`terminalPasteShortcut`), and it has no Cut or Delete.
 *
 * @module clipboardMenuItems
 */
import { ClipboardPaste, Copy, Scissors, Trash } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ContextMenuItem } from './ContextMenu'
import { formatShortcut } from '../../utils/shortcutLabel'
import { isMacOS } from '../../utils/platform'
import { DEFAULT_ICON_PROPS } from '../../utils/iconRegistry'
import { logger } from '../../utils/logger'

/** A clipboard command a menu offers. */
export type ClipboardAction = 'cut' | 'copy' | 'paste' | 'delete'

/** What a Delete removes: the selected text, or a file or folder in the tree. */
export type DeleteTarget = 'text' | 'item'

/** The visible label of each command – identical on every surface. */
export const CLIPBOARD_LABELS: Readonly<Record<ClipboardAction, string>> = {
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  delete: 'Delete'
}

/** Shortcut letter of the commands that have one. */
const LETTERS: Readonly<Record<Exclude<ClipboardAction, 'delete'>, string>> = { cut: 'X', copy: 'C', paste: 'V' }

/**
 * The shortcut hint a menu shows next to a clipboard command.
 *
 * @param action - The command
 * @param target - For Delete: text (the plain key) or a project item (⌘⌫ on macOS)
 * @returns The hint, e.g. `'⌘X'` on macOS or `'Ctrl+X'` elsewhere
 *
 * @example
 * ```ts
 * clipboardShortcut('copy')             // macOS '⌘C', Windows 'Ctrl+C'
 * clipboardShortcut('delete', 'item')   // macOS '⌘⌫', Windows 'Delete'
 * ```
 */
export function clipboardShortcut(action: ClipboardAction, target: DeleteTarget = 'text'): string {
  if (action !== 'delete') return formatShortcut(LETTERS[action], { mod: true })
  // A Mac keyboard's "delete" is Backspace; Finder deletes an item with ⌘⌫.
  return isMacOS() ? formatShortcut('⌫', { mod: target === 'item' }) : formatShortcut('Delete')
}

/**
 * The icon of a clipboard command, at the menu's icon size.
 *
 * @param action - The command
 * @returns A decorative lucide icon
 */
export function clipboardIcon(action: ClipboardAction): ReactNode {
  switch (action) {
    case 'cut':
      return <Scissors {...DEFAULT_ICON_PROPS} />
    case 'copy':
      return <Copy {...DEFAULT_ICON_PROPS} />
    case 'paste':
      return <ClipboardPaste {...DEFAULT_ICON_PROPS} />
    case 'delete':
      return <Trash {...DEFAULT_ICON_PROPS} />
  }
}

/** One clipboard item a menu wants. */
export interface ClipboardItemSpec {
  /** Which command */
  action: ClipboardAction
  /** Runs the command; a rejection is logged, never left unhandled */
  run: () => void | Promise<void>
  /** Greyed out and inert (e.g. Copy with nothing selected) */
  disabled?: boolean
  /** Optional test id for the item */
  testId?: string
}

/**
 * Build the menu items for a set of clipboard commands, in the order given.
 *
 * The menu closes itself after an item runs (`ContextMenu`), so `run` only
 * does the work.
 *
 * @param specs - The commands, usually Cut, Copy, Paste, Delete
 * @returns Items for `ContextMenu`
 *
 * @example
 * ```tsx
 * const items = clipboardMenuItems([
 *   { action: 'cut', run: onCut, disabled: !hasSelection },
 *   { action: 'paste', run: onPaste }
 * ])
 * ```
 */
export function clipboardMenuItems(specs: readonly ClipboardItemSpec[]): ContextMenuItem[] {
  return specs.map(({ action, run, disabled, testId }) => ({
    label: CLIPBOARD_LABELS[action],
    shortcut: clipboardShortcut(action),
    icon: clipboardIcon(action),
    disabled,
    testId,
    action: () => {
      // Started synchronously, while the menu is still open, so the command
      // reads the selection its menu was opened for.
      void Promise.resolve(run()).catch((error: unknown) => {
        logger.error(`Clipboard ${action} failed`, error instanceof Error ? error : undefined)
      })
    }
  }))
}
