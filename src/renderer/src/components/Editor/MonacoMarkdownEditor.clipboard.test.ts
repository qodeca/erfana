// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Unit test for the Monaco clipboard `addAction` registrations.
 *
 * MonacoMarkdownEditor registers Copy/Cut/Paste via `registerClipboardActions`
 * (extracted to monacoClipboardCommands.ts) to own the Cmd/Ctrl+C/X/V chords
 * and suppress Monaco's built-in (browser-clipboard) actions. This test drives
 * that registration helper directly with a fake editor + fake monaco namespace
 * — no real Monaco runtime, no `monaco-editor` value import (which has no
 * resolvable entry in the renderer test env).
 *
 * Asserts the three actions are registered with the right ids + keybindings,
 * carry no contextMenu group/order, and that each `run` delegates to the
 * matching pure clipboard command.
 *
 * @see Issue #203 - Central text-clipboard service
 * @see docs/design/issue-203-clipboard-service.md §5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the central clipboard service so we can observe which primitive each
// action's `run` ultimately drives (copy/cut → writeText, paste → readText).
const mockWriteText = vi.fn()
const mockReadText = vi.fn()
vi.mock('../../services/textClipboard', () => ({
  textClipboard: {
    writeText: (t: string) => mockWriteText(t),
    readText: () => mockReadText()
  }
}))

import { registerClipboardActions } from '../../utils/monacoClipboardCommands'

// Fake monaco namespace: chord constants + the Range/Selection/EditorOption
// pieces buildMonacoClipboardDeps needs at runtime.
const KeyMod = { CtrlCmd: 2048 }
const KeyCode = { KeyC: 33, KeyX: 54, KeyV: 52 }
const SELECTION = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }
const fakeMonaco = {
  KeyMod,
  KeyCode,
  Range: { lift: (r: typeof SELECTION) => ({ isEmpty: () => r.startColumn === r.endColumn }) },
  Selection: class {
    constructor(
      public a: number,
      public b: number,
      public c: number,
      public d: number
    ) {}
  },
  editor: { EditorOption: { readOnly: 91 } }
} as unknown as typeof import('monaco-editor')

interface CapturedAction {
  id: string
  keybindings: number[]
  run: (ed: unknown) => void
  contextMenuGroupId?: string
  contextMenuOrder?: number
}

/** A fake editor satisfying buildMonacoClipboardDeps' calls. */
function makeEditor() {
  return {
    addAction: vi.fn(),
    getSelection: () => SELECTION,
    getModel: () => ({ getValueInRange: () => 'hello' }),
    getOption: () => false,
    executeEdits: vi.fn()
  }
}

function register(editor = makeEditor()): { actions: CapturedAction[]; editor: ReturnType<typeof makeEditor> } {
  registerClipboardActions(editor as never, fakeMonaco)
  const actions = editor.addAction.mock.calls.map((c) => c[0] as CapturedAction)
  return { actions, editor }
}

describe('registerClipboardActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteText.mockResolvedValue(true)
    mockReadText.mockResolvedValue('')
  })

  it('registers exactly the three clipboard actions with the expected ids and keybindings', () => {
    const { actions } = register()
    const byId = Object.fromEntries(actions.map((a) => [a.id, a]))

    expect(actions).toHaveLength(3)

    expect(byId['erfana.clipboardCopy']).toBeDefined()
    expect(byId['erfana.clipboardCopy'].keybindings).toEqual([KeyMod.CtrlCmd | KeyCode.KeyC])

    expect(byId['erfana.clipboardCut']).toBeDefined()
    expect(byId['erfana.clipboardCut'].keybindings).toEqual([KeyMod.CtrlCmd | KeyCode.KeyX])

    expect(byId['erfana.clipboardPaste']).toBeDefined()
    expect(byId['erfana.clipboardPaste'].keybindings).toEqual([KeyMod.CtrlCmd | KeyCode.KeyV])
  })

  it('does not set contextMenu group/order (the custom EditorContextMenu owns the menu)', () => {
    const { actions } = register()

    for (const action of actions) {
      expect(action.contextMenuGroupId).toBeUndefined()
      expect(action.contextMenuOrder).toBeUndefined()
    }
  })

  it('copy run drives writeText with the selection text', async () => {
    const { actions, editor } = register()
    const copy = actions.find((a) => a.id === 'erfana.clipboardCopy')!

    await copy.run(editor)

    expect(mockWriteText).toHaveBeenCalledWith('hello')
    expect(mockReadText).not.toHaveBeenCalled()
  })

  it('cut run drives writeText then deletes via executeEdits on success', async () => {
    const { actions, editor } = register()
    const cut = actions.find((a) => a.id === 'erfana.clipboardCut')!

    await cut.run(editor)

    expect(mockWriteText).toHaveBeenCalledWith('hello')
    expect(editor.executeEdits).toHaveBeenCalledTimes(1)
  })

  it('paste run drives readText and inserts via executeEdits', async () => {
    mockReadText.mockResolvedValue('pasted')
    const { actions, editor } = register()
    const paste = actions.find((a) => a.id === 'erfana.clipboardPaste')!

    await paste.run(editor)

    expect(mockReadText).toHaveBeenCalledTimes(1)
    expect(editor.executeEdits).toHaveBeenCalledTimes(1)
  })
})
