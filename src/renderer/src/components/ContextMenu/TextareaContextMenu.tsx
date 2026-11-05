// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ContextMenu } from './ContextMenu'
import { clipboardMenuItems } from './clipboardMenuItems'

interface TextareaContextMenuProps {
  x: number
  y: number
  /** Whether the field has selected text when the menu opens */
  hasSelection: boolean
  /** A read-only field offers Copy only: Cut, Paste and Delete are disabled */
  readOnly?: boolean
  /** A password field never lets its text out: Cut and Copy are disabled */
  concealed?: boolean
  onCut: () => void | Promise<void>
  onCopy: () => void | Promise<void>
  onPaste: () => void | Promise<void>
  /** Deletes the selection, like the Delete key (#463) */
  onDelete: () => void | Promise<void>
  onClose: () => void
}

/**
 * Context menu for a text field (textarea or input): Cut, Copy, Paste and
 * Delete, with their shortcut hints. Cut, Copy and Delete are disabled when no
 * text is selected.
 */
export function TextareaContextMenu({
  x,
  y,
  hasSelection,
  readOnly = false,
  concealed = false,
  onCut,
  onCopy,
  onPaste,
  onDelete,
  onClose
}: TextareaContextMenuProps): JSX.Element {
  const items = clipboardMenuItems([
    { action: 'cut', run: onCut, disabled: !hasSelection || readOnly || concealed },
    { action: 'copy', run: onCopy, disabled: !hasSelection || concealed },
    { action: 'paste', run: onPaste, disabled: readOnly },
    { action: 'delete', run: onDelete, disabled: !hasSelection || readOnly }
  ])

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
