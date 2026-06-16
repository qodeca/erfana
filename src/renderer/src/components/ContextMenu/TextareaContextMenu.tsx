// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Scissors, Copy, ClipboardPaste } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { isMacOS } from '../../utils/platform'

interface TextareaContextMenuProps {
  x: number
  y: number
  hasSelection: boolean
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

/**
 * Context menu for textarea elements with Cut, Copy, and Paste operations.
 * Cut and Copy are disabled when no text is selected.
 */
export function TextareaContextMenu({
  x,
  y,
  hasSelection,
  onCut,
  onCopy,
  onPaste,
  onClose
}: TextareaContextMenuProps): JSX.Element {
  const isMac = isMacOS()
  const cutShortcut = isMac ? '⌘X' : 'Ctrl+X'
  const copyShortcut = isMac ? '⌘C' : 'Ctrl+C'
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V'

  // Standard order: Cut, Copy, Paste
  const items: ContextMenuItem[] = [
    {
      label: 'Cut',
      shortcut: cutShortcut,
      icon: <Scissors size={14} />,
      action: () => {
        onCut()
        onClose()
      },
      disabled: !hasSelection
    },
    {
      label: 'Copy',
      shortcut: copyShortcut,
      icon: <Copy size={14} />,
      action: () => {
        onCopy()
        onClose()
      },
      disabled: !hasSelection
    },
    {
      label: 'Paste',
      shortcut: pasteShortcut,
      icon: <ClipboardPaste size={14} />,
      action: () => {
        onPaste()
        onClose()
      }
    }
  ]

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
