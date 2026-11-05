// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useState } from 'react'
import { TextareaContextMenu } from './TextareaContextMenu'
import { isContextMenuKey, isKeyboardMenuEcho, markKeyboardMenuOpen, menuAnchorBelow } from './contextMenuKey'
import {
  copyFromField,
  cutFromField,
  deleteFromField,
  hasFieldSelection,
  pasteIntoField,
  textFieldFrom,
  type TextField
} from './textFieldActions'

/** The open menu: where it is and which field it acts on. */
interface OpenMenu {
  x: number
  y: number
  field: TextField
  hasSelection: boolean
}

/**
 * One app-level Cut / Copy / Paste / Delete menu for every text field that has
 * no menu of its own (#463) – Settings, the search bar, comment boxes – instead
 * of one menu per field.
 *
 * It listens on `window` in the bubble phase and steps aside when an earlier
 * handler called `preventDefault()`: the prompt, file-name and chat dialogs,
 * the editor, the terminal and the comment host open their own menus, and all
 * of them cancel the event first. Shift+F10 and the Menu key open it under the
 * field, with the Windows Menu-key echo dropped (`contextMenuKey.ts`).
 *
 * Mounted once, in `App.tsx`.
 */
export function TextFieldContextMenuHost(): JSX.Element | null {
  const [menu, setMenu] = useState<OpenMenu | null>(null)

  useEffect(() => {
    const open = (field: TextField, at: { x: number; y: number }): void =>
      setMenu({ ...at, field, hasSelection: hasFieldSelection(field) })

    const onContextMenu = (event: MouseEvent): void => {
      if (event.defaultPrevented) return
      const field = textFieldFrom(event.target)
      if (field === null) return
      event.preventDefault()
      // The Windows Menu-key echo of a menu the keyboard already opened (#90).
      if (isKeyboardMenuEcho()) return
      open(field, { x: event.clientX, y: event.clientY })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isContextMenuKey(event)) return
      const field = textFieldFrom(event.target)
      if (field === null) return
      event.preventDefault()
      markKeyboardMenuOpen()
      open(field, menuAnchorBelow(field))
    }

    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (menu === null) return null
  const { field } = menu
  return (
    <TextareaContextMenu
      x={menu.x}
      y={menu.y}
      hasSelection={menu.hasSelection}
      readOnly={field.readOnly}
      concealed={field.type === 'password'}
      onCut={() => cutFromField(field)}
      onCopy={() => copyFromField(field)}
      onPaste={() => pasteIntoField(field)}
      onDelete={() => deleteFromField(field)}
      onClose={() => setMenu(null)}
    />
  )
}
