// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shift+F10 and the Menu key open the editor's context menu under the caret
 * (#90), the native `contextmenu` Windows sends after the Menu key is not taken
 * as a second open, and the binding belongs to ONE editor.
 *
 * Why the last point: standalone Monaco's `addCommand` registers a keybinding
 * for every editor, so with two editors the last-mounted one would answer the
 * key and open the menu for a hidden file (#350 review). The binding must be
 * an `addAction`, which Monaco scopes to its own editor.
 *
 * The real `monaco-editor` import does not resolve in the renderer test env,
 * so the wrapper is replaced by one that mounts a small fake editor per
 * instance, and the value sync (covered by MonacoMarkdownEditor.sync.test.tsx)
 * is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { resetKeyboardMenuEcho } from '../ContextMenu/contextMenuKey'

const KeyMod = { CtrlCmd: 2048, Shift: 1024 }
const KeyCode = { KeyB: 32, KeyI: 39, KeyK: 41, KeyF: 36, KeyG: 37, F10: 68, ContextMenu: 58 }

interface FakeAction {
  id: string
  keybindings?: number[]
  run: (editor: unknown) => void
}

interface FakeEditor {
  actions: FakeAction[]
  commandKeybindings: number[]
  contextMenu: null | ((e: unknown) => void)
}

const harness = vi.hoisted(() => ({ editors: [] as FakeEditor[], nextCaretLeft: 42 }))

function createFakeEditor(caretLeft: number) {
  const model = { getValueInRange: () => 'picked' }
  const host = document.createElement('div')
  host.getBoundingClientRect = () =>
    ({ left: 100, top: 50, right: 600, bottom: 450, width: 500, height: 400, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect
  const record: FakeEditor = { actions: [], commandKeybindings: [], contextMenu: null }
  harness.editors.push(record)
  return {
    getModel: () => model,
    getValue: () => '',
    getSelection: () => ({ startLineNumber: 3, endLineNumber: 4, isEmpty: () => false }),
    getPosition: () => ({ lineNumber: 4, column: 7 }),
    getScrolledVisiblePosition: () => ({ left: caretLeft, top: 60, height: 20 }),
    getDomNode: () => host,
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    onContextMenu: (listener: (e: unknown) => void) => {
      record.contextMenu = listener
      return { dispose: () => {} }
    },
    addCommand: (keybinding: number) => {
      record.commandKeybindings.push(keybinding)
      return null
    },
    addAction: (action: FakeAction) => {
      record.actions.push(action)
      return { dispose: () => {} }
    },
    updateOptions: () => {},
    dispose: () => {}
  }
}

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor(props: { onMount?: (editor: unknown, monaco: unknown) => void }) {
    useEffect(() => {
      const caretLeft = harness.nextCaretLeft
      harness.nextCaretLeft += 100
      props.onMount?.(createFakeEditor(caretLeft), { KeyMod, KeyCode })
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

const MENU_KEYS = [KeyMod.Shift | KeyCode.F10, KeyCode.ContextMenu]

function menuAction(editor: FakeEditor): FakeAction {
  const action = editor.actions.find((candidate) => candidate.id === 'erfana.openContextMenu')
  if (!action) throw new Error('no context-menu action registered')
  return action
}

describe('MonacoMarkdownEditor keyboard context menu (#90)', () => {
  beforeEach(() => {
    harness.editors.length = 0
    harness.nextCaretLeft = 42
    resetKeyboardMenuEcho()
  })

  it('binds Shift+F10 and the Menu key as an editor action, never as a global command', () => {
    render(<MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/a.md" onContextMenu={vi.fn()} />)
    const [editor] = harness.editors

    expect(menuAction(editor).keybindings).toEqual(MENU_KEYS)
    for (const key of MENU_KEYS) expect(editor.commandKeybindings).not.toContain(key)
  })

  it('opens the menu under the caret', () => {
    const onContextMenu = vi.fn()
    render(<MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/a.md" onContextMenu={onContextMenu} />)

    menuAction(harness.editors[0]).run(null)

    // Host left + caret left; host top + caret top + line height.
    expect(onContextMenu).toHaveBeenCalledWith({
      x: 142,
      y: 130,
      selectedText: 'picked',
      startLine: 3,
      endLine: 4
    })
  })

  it('with two editors open, each action opens its own editor’s menu', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/a.md" onContextMenu={first} />
        <MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/b.md" onContextMenu={second} />
      </>
    )
    expect(harness.editors).toHaveLength(2)

    // The FIRST-mounted editor's key still reaches the first editor, which a
    // global addCommand (last registration wins) would not.
    menuAction(harness.editors[0]).run(null)
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ x: 142 }))
    expect(second).not.toHaveBeenCalled()

    resetKeyboardMenuEcho()
    menuAction(harness.editors[1]).run(null)
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ x: 242 }))
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('drops the native contextmenu that follows a keyboard open, but not a later right-click', () => {
    const onContextMenu = vi.fn()
    render(<MonacoMarkdownEditor value="" onChange={vi.fn()} filePath="/p/a.md" onContextMenu={onContextMenu} />)
    const [editor] = harness.editors
    const native = (x: number, y: number) => ({
      event: { posx: x, posy: y, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    })

    menuAction(editor).run(null)
    editor.contextMenu?.(native(300, 250))
    expect(onContextMenu).toHaveBeenCalledTimes(1)

    // A real right-click is preceded by a pointer press.
    document.dispatchEvent(new Event('pointerdown'))
    editor.contextMenu?.(native(310, 260))
    expect(onContextMenu).toHaveBeenCalledTimes(2)
    expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ x: 310, y: 260 }))
  })
})
