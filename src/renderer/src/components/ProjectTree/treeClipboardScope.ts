// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/** A tree clipboard command, as named by its shortcut. */
export type TreeClipboardAction = 'cut' | 'copy' | 'paste'

/** Shortcut letter → command. */
const ACTIONS: Record<string, TreeClipboardAction> = { x: 'cut', c: 'copy', v: 'paste' }

/**
 * The tree clipboard command a keydown asks for, or `null`.
 *
 * Only the platform's own modifier counts – Cmd on macOS, Ctrl elsewhere – so
 * Ctrl+C on a Mac (which a terminal user may press out of habit) never copies a
 * folder. Shift and Alt variants are other shortcuts and are left alone. The
 * letter is matched case-insensitively, because Caps Lock makes `e.key` "C".
 *
 * @param event - The keydown's modifier flags and key
 * @param mac - Whether the app runs on macOS (`isMacOS()`)
 * @returns `'cut' | 'copy' | 'paste'`, or `null` for any other keystroke
 *
 * @example
 * ```ts
 * treeClipboardAction({ key: 'C', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, true) // 'copy'
 * treeClipboardAction({ key: 'c', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, true) // null
 * ```
 */
export function treeClipboardAction(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  mac: boolean
): TreeClipboardAction | null {
  const platformModifier = mac ? event.metaKey : event.ctrlKey
  if (!platformModifier || event.shiftKey || event.altKey) return null
  return ACTIONS[event.key.toLowerCase()] ?? null
}

/**
 * Whether a Cmd/Ctrl+C / X / V keystroke belongs to the project tree ([27]).
 *
 * The tree listens on `window`, and a clicked folder stays selected
 * indefinitely, so without this check the shortcut fired from anywhere that
 * was not a text field: select a dialog message or preview text, press Cmd+C,
 * and the FOLDER was copied while `preventDefault()` swallowed the native copy
 * (verified in `e2e/tree-clipboard-scope.e2e.ts`).
 *
 * The keystroke is the tree's when focus is inside the tree (clicking a row
 * focuses it – dnd-kit gives every row `tabIndex: 0`) – unless text INSIDE the
 * tree is selected, in which case native copy wins.
 *
 * A selection ELSEWHERE does not count. Tree rows are `user-select: none`, so
 * clicking a row leaves whatever was selected before (preview text, say) in
 * place; treating that stale selection as "the user is copying text" made
 * Cmd+C on a freshly clicked folder do nothing. Selecting text elsewhere and
 * then pressing Cmd+C is still covered by the focus rule: selecting text moves
 * focus out of the tree.
 *
 * Text fields need no separate rule: none lives inside the tree container
 * (rename and create are portal dialogs), so focus in one already fails the
 * focus rule.
 *
 * @param treeContainer - The tree's root element, or `null` before mount
 * @param activeElement - `document.activeElement`
 * @param selection - `window.getSelection()`
 * @returns True when the tree should handle the shortcut
 *
 * @example
 * ```ts
 * if (!isTreeClipboardKeystroke(treeRef.current, document.activeElement, window.getSelection())) return
 * ```
 */
export function isTreeClipboardKeystroke(
  treeContainer: Element | null,
  activeElement: Element | null,
  selection: Selection | null
): boolean {
  if (treeContainer === null || activeElement === null) return false
  if (!treeContainer.contains(activeElement)) return false
  return !hasTextSelectedInside(treeContainer, selection)
}

/**
 * Whether `selection` holds real (non-collapsed, non-empty) text that touches
 * `container`.
 *
 * @param container - Element the selection is tested against
 * @param selection - `window.getSelection()`
 * @returns True when text inside `container` is selected
 */
function hasTextSelectedInside(container: Element, selection: Selection | null): boolean {
  // A collapsed selection is a caret position, not selected text.
  if (selection === null || selection.isCollapsed || selection.toString() === '') return false
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    if (container.contains(range.startContainer) || container.contains(range.endContainer)) return true
  }
  return false
}
