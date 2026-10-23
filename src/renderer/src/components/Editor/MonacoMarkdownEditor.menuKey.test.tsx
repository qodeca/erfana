// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shift+F10 and the Menu key open the editor's context menu under the caret
 * (#90), and the native `contextmenu` Windows sends after the Menu key is not
 * taken as a second open.
 *
 * The real `monaco-editor` import does not resolve in the renderer test env,
 * so the wrapper is replaced by one that mounts a small fake editor, and the
 * value sync (covered by MonacoMarkdownEditor.sync.test.tsx) is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { resetKeyboardMenuEcho } from '../ContextMenu/contextMenuKey'

const KeyMod = { CtrlCmd: 2048, Shift: 1024 }
const KeyCode = { KeyB: 32, KeyI: 39, KeyK: 41, KeyF: 36, KeyG: 37, F10: 68, ContextMenu: 58 }

const fake = vi.hoisted(() => ({
  commands: new Map<number, () => void>(),
  contextMenu: null as null | ((e: unknown) => void)
}))

function createFakeEditor() {
  const model = { getValueInRange: () => 'picked' }
  const host = document.createElement('div')
  host.getBoundingClientRect = () => ({ left: 100, top: 50, right: 600, bottom: 450, width: 500, height: 400, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect
  return {
    getModel: () => model,
    getValue: () => '',
    getSelection: () => ({ startLineNumber: 3, endLineNumber: 4, isEmpty: () => false }),
    getPosition: () => ({ lineNumber: 4, column: 7 }),
    getScrolledVisiblePosition: () => ({ left: 42, top: 60, height: 20 }),
    getDomNode: () => host,
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    onContextMenu: (listener: (e: unknown) => void) => {
      fake.contextMenu = listener
      return { dispose: () => {} }
    },
    addCommand: (keybinding: number, handler: () => void) => {
      fake.commands.set(keybinding, handler)
      return null
    },
    updateOptions: () => {},
    dispose: () => {}
  }
}

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor(props: { onMount?: (editor: unknown, monaco: unknown) => void }) {
    useEffect(() => {
      props.onMount?.(createFakeEditor(), { KeyMod, KeyCode })
      // Mount once, as the real wrapper does.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="mock-monaco" />
  },
  loader: { config: vi.fn() }
}))
vi.mock('../../utils/monacoLanguageServices', () => ({ disableWorkerLanguageServices: vi.fn() }))
vi.mock('../../utils/monacoClipboardCommands', () => ({ registerClipboardActions: vi.fn() }))
vi.mock('../../utils/monacoValueSync', () => ({
  createEditorValueSync: () => ({
    resetTo: vi.fn(),
    reconcile: vi.fn(),
    confirm: vi.fn(),
    isApplying: () => false,
    recordEmit: vi.fn()
  })
}))
vi.mock('monaco-editor', () => ({}))

import { MonacoMarkdownEditor } from './MonacoMarkdownEditor'

function mount(onContextMenu = vi.fn()) {
  render(<MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/a.md" onContextMenu={onContextMenu} />)
  return onContextMenu
}

describe('MonacoMarkdownEditor keyboard context menu (#90)', () => {
  beforeEach(() => {
    fake.commands.clear()
    fake.contextMenu = null
    resetKeyboardMenuEcho()
  })

  it.each([
    ['Shift+F10', KeyMod.Shift | KeyCode.F10],
    ['the Menu key', KeyCode.ContextMenu]
  ])('%s opens the menu under the caret', (_name, keybinding) => {
    const onContextMenu = mount()
    const command = fake.commands.get(keybinding)
    expect(command).toBeDefined()

    command?.()

    // Host left + caret left; host top + caret top + line height.
    expect(onContextMenu).toHaveBeenCalledWith({
      x: 142,
      y: 130,
      selectedText: 'picked',
      startLine: 3,
      endLine: 4
    })
  })

  it('drops the native contextmenu that follows a keyboard open, but not a later right-click', () => {
    const onContextMenu = mount()
    const native = (x: number, y: number) => ({
      event: { posx: x, posy: y, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    })

    fake.commands.get(KeyCode.ContextMenu)?.()
    fake.contextMenu?.(native(300, 250))
    expect(onContextMenu).toHaveBeenCalledTimes(1)

    // A real right-click is preceded by a pointer press.
    document.dispatchEvent(new Event('pointerdown'))
    fake.contextMenu?.(native(310, 260))
    expect(onContextMenu).toHaveBeenCalledTimes(2)
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ x: 310, y: 260 }))
  })
})
