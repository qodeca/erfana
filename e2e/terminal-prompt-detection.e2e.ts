// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * When `TerminalPage.waitForPrompt` counts a screen as a drawn prompt (#288).
 *
 * No app here: the screens are real reads from xterm's buffer, taken from
 * e2e runs on macOS (zsh) and Windows (Git Bash).
 */

import { test, expect } from '@playwright/test'
import { isPromptDrawn } from './pages/terminal.page'

test.describe('terminal prompt detection', () => {
  test('zsh after a resize redraw: prompt line above, cursor at column 0 below', () => {
    // macOS full run, html-preview-bounds.e2e.ts:134 (cursorY 2)
    expect(isPromptDrawn({ lines: ['%', 'marcinobel@marcin-macbook-m5 test-Ws5UKu %'], cursorX: 0 })).toBe(true)
  })

  test('Git Bash: two-line prompt, cursor after "$ "', () => {
    expect(isPromptDrawn({ lines: ['marcinobel@HOST MSYS /c/proj (develop)', '$'], cursorX: 2 })).toBe(true)
  })

  test('PowerShell and a root shell', () => {
    expect(isPromptDrawn({ lines: ['PS C:\\proj>'], cursorX: 0 })).toBe(true)
    expect(isPromptDrawn({ lines: ['root@host:/#'], cursorX: 0 })).toBe(true)
  })

  test('a busy shell is not a prompt', () => {
    // Windows, after `sleep 4` was sent: the command line, cursor at column 0 below
    expect(isPromptDrawn({ lines: ['marcinobel@HOST MSYS /c/proj (develop)', '$ sleep 4'], cursorX: 0 })).toBe(false)
  })

  test('an empty screen is not a prompt', () => {
    expect(isPromptDrawn({ lines: [], cursorX: 0 })).toBe(false)
    expect(isPromptDrawn({ lines: [], cursorX: 5 })).toBe(false)
  })
})
