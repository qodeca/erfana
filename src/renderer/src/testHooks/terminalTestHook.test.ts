// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { registerTestTerminal } from './terminalTestHook'

function fakeXterm(rows: Array<{ text: string; wrapped?: boolean }>, cursor = { x: 3, y: 1 }): Terminal {
  return {
    buffer: {
      active: {
        length: rows.length,
        cursorX: cursor.x,
        cursorY: cursor.y,
        getLine: (i: number) => ({
          isWrapped: rows[i].wrapped ?? false,
          translateToString: () => rows[i].text
        })
      }
    }
  } as unknown as Terminal
}

describe('terminal test hook', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__ERFANA_TEST_HOOKS__
    delete window.__erfanaTest
    delete (window as unknown as Record<string, unknown>).api
  })

  it('installs nothing when the launcher did not switch the hooks on', () => {
    const forget = registerTestTerminal('terminal-1', fakeXterm([{ text: 'secret' }]))

    expect(window.__erfanaTest).toBeUndefined()
    expect(() => forget()).not.toThrow()
  })

  it('does not install on a truthy value other than true', () => {
    ;(window as unknown as Record<string, unknown>).api = { testHooks: { enabled: 'yes' } }

    registerTestTerminal('terminal-1', fakeXterm([{ text: 'x' }]))

    expect(window.__erfanaTest).toBeUndefined()
  })

  it('ignores a global that page script sets', () => {
    ;(window as unknown as Record<string, unknown>).__ERFANA_TEST_HOOKS__ = true
    ;(window as unknown as Record<string, unknown>).api = { testHooks: { enabled: false } }

    registerTestTerminal('terminal-1', fakeXterm([{ text: 'x' }]))

    expect(window.__erfanaTest).toBeUndefined()
  })

  describe('when the hooks are on', () => {
    const enable = (): void => {
      ;(window as unknown as Record<string, unknown>).api = { testHooks: { enabled: true } }
    }

    it('returns the buffer text with wrapped rows joined and blank rows dropped', () => {
      enable()
      registerTestTerminal(
        'terminal-1',
        fakeXterm([{ text: 'user@host % ls  ' }, { text: 'a.md', wrapped: false }, { text: '' }, { text: 'long' }, { text: 'er', wrapped: true }])
      )

      expect(window.__erfanaTest!.terminalText('terminal-1')).toBe('user@host % ls\na.md\nlonger')
    })

    it('returns the cursor position', () => {
      enable()
      registerTestTerminal('terminal-1', fakeXterm([{ text: 'x' }], { x: 5, y: 2 }))

      expect(window.__erfanaTest!.terminalCursor('terminal-1')).toEqual({ x: 5, y: 2 })
    })

    it('returns null for an unknown terminal', () => {
      enable()
      registerTestTerminal('terminal-1', fakeXterm([{ text: 'x' }]))

      expect(window.__erfanaTest!.terminalText('terminal-2')).toBeNull()
      expect(window.__erfanaTest!.terminalCursor('terminal-2')).toBeNull()
    })

    it('forgets a terminal when it is unregistered', () => {
      enable()
      const forget = registerTestTerminal('terminal-1', fakeXterm([{ text: 'x' }]))

      forget()

      expect(window.__erfanaTest!.terminalText('terminal-1')).toBeNull()
    })

    it('keeps a newer terminal registered under the same id', () => {
      enable()
      const forgetOld = registerTestTerminal('terminal-1', fakeXterm([{ text: 'old' }]))
      registerTestTerminal('terminal-1', fakeXterm([{ text: 'new' }]))

      forgetOld()

      expect(window.__erfanaTest!.terminalText('terminal-1')).toBe('new')
    })
  })
})
