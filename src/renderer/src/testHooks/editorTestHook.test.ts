// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import type * as monaco from 'monaco-editor'
import type { Terminal } from '@xterm/xterm'
import { registerTestEditor } from './editorTestHook'
import { registerTestTerminal } from './terminalTestHook'

interface FakeEditor {
  editor: monaco.editor.ICodeEditor
  container: HTMLElement
  dispose: () => void
}

function fakeEditor(value: string | null): FakeEditor {
  const container = document.createElement('div')
  const dom = document.createElement('div')
  container.appendChild(dom)
  document.body.appendChild(container)
  const onDispose: Array<() => void> = []
  const editor = {
    getContainerDomNode: () => dom,
    getModel: () => (value === null ? null : { getValue: () => value }),
    onDidDispose: (listener: () => void) => {
      onDispose.push(listener)
      return { dispose: () => {} }
    }
  } as unknown as monaco.editor.ICodeEditor
  return { editor, container, dispose: () => onDispose.forEach((l) => l()) }
}

const enable = (): void => {
  ;(window as unknown as Record<string, unknown>).api = { testHooks: { enabled: true } }
}

describe('editor test hook', () => {
  afterEach(() => {
    delete window.__erfanaTest
    delete (window as unknown as Record<string, unknown>).api
    document.body.innerHTML = ''
  })

  it('installs nothing when the launcher did not switch the hooks on', () => {
    const forget = registerTestEditor(fakeEditor('secret').editor)

    expect(window.__erfanaTest).toBeUndefined()
    expect(() => forget()).not.toThrow()
  })

  it('does not install on a truthy value other than true', () => {
    ;(window as unknown as Record<string, unknown>).api = { testHooks: { enabled: 'yes' } }

    registerTestEditor(fakeEditor('x').editor)

    expect(window.__erfanaTest).toBeUndefined()
  })

  describe('when the hooks are on', () => {
    it('returns the model value of the editor inside the container', () => {
      enable()
      const a = fakeEditor('alpha\n')
      const b = fakeEditor('beta\n')
      const forgetA = registerTestEditor(a.editor)
      const forgetB = registerTestEditor(b.editor)

      expect(window.__erfanaTest!.editorValue(a.container)).toBe('alpha\n')
      expect(window.__erfanaTest!.editorValue(b.container)).toBe('beta\n')
      forgetA()
      forgetB()
    })

    it('returns null for a container with no editor in it', () => {
      enable()
      const forget = registerTestEditor(fakeEditor('x').editor)

      expect(window.__erfanaTest!.editorValue(document.createElement('div'))).toBeNull()
      forget()
    })

    it('returns null for an editor with no model', () => {
      enable()
      const e = fakeEditor(null)
      const forget = registerTestEditor(e.editor)

      expect(window.__erfanaTest!.editorValue(e.container)).toBeNull()
      forget()
    })

    it('forgets an editor when it is disposed', () => {
      enable()
      const e = fakeEditor('gone')
      registerTestEditor(e.editor)

      e.dispose()

      expect(window.__erfanaTest!.editorValue(e.container)).toBeNull()
    })

    it('forgets an editor when it is unregistered', () => {
      enable()
      const e = fakeEditor('gone')
      const forget = registerTestEditor(e.editor)

      forget()

      expect(window.__erfanaTest!.editorValue(e.container)).toBeNull()
    })

    it('keeps the terminal readers working when an editor registers first', () => {
      enable()
      const e = fakeEditor('x')
      const forgetEditor = registerTestEditor(e.editor)

      expect(window.__erfanaTest!.terminalText('terminal-1')).toBeNull()
      expect(window.__erfanaTest!.terminalCursor('terminal-1')).toBeNull()

      const xterm = {
        buffer: {
          active: {
            length: 1,
            cursorX: 0,
            cursorY: 0,
            getLine: () => ({ isWrapped: false, translateToString: () => 'prompt' })
          }
        }
      } as unknown as Terminal
      const forgetTerminal = registerTestTerminal('terminal-1', xterm)

      expect(window.__erfanaTest!.terminalText('terminal-1')).toBe('prompt')
      expect(window.__erfanaTest!.editorValue(e.container)).toBe('x')
      forgetTerminal()
      forgetEditor()
    })
  })
})
