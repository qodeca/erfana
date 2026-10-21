// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Whether a Cmd/Ctrl+C / X / V keystroke belongs to the project tree ([27]).
 *
 * The tree listens on `window`, and a clicked folder stays selected
 * indefinitely, so without this check the shortcut fired from anywhere that
 * was not a text field: select a dialog message or preview text, press Cmd+C,
 * and the FOLDER was copied while `preventDefault()` swallowed the native copy
 * (verified in `e2e/tree-clipboard-scope.e2e.ts`).
 *
 * The keystroke is the tree's only when BOTH hold:
 * - focus is inside the tree (clicking a row focuses it – dnd-kit gives every
 *   row `tabIndex: 0`), and
 * - no text is selected, so a user who selected text and pressed Cmd+C always
 *   gets the text.
 *
 * Text fields need no separate rule: none lives inside the tree container
 * (rename and create are portal dialogs), so focus in one already fails the
 * first condition.
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
  // A collapsed selection is just a caret position, not selected text.
  return selection === null || selection.isCollapsed || selection.toString() === ''
}
