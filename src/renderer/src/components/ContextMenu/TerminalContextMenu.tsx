// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Copy, ClipboardPaste } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { isMacOS } from '../../utils/platform'
import { TEST_IDS } from '../../constants/testids'

interface TerminalContextMenuProps {
  x: number
  y: number
  hasSelection: boolean
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

/**
 * Context menu for terminal panel with Copy and Paste operations.
 * Copy is disabled when no text is selected.
 */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onCopy,
  onPaste,
  onClose
}: TerminalContextMenuProps): JSX.Element {
  const isMac = isMacOS()
  const copyShortcut = isMac ? '⌘C' : 'Ctrl+C'
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V'

  const items: ContextMenuItem[] = [
    {
      label: 'Copy',
      shortcut: copyShortcut,
      icon: <Copy size={14} />,
      action: () => {
        onCopy()
        onClose()
      },
      disabled: !hasSelection,
      testId: TEST_IDS.CONTEXT_MENU_ITEM_COPY
    },
    {
      label: 'Paste',
      shortcut: pasteShortcut,
      icon: <ClipboardPaste size={14} />,
      action: () => {
        onPaste()
        onClose()
      },
      testId: TEST_IDS.CONTEXT_MENU_ITEM_PASTE
    }
  ]

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      containerTestId={TEST_IDS.CONTEXT_MENU_TERMINAL}
    />
  )
}
