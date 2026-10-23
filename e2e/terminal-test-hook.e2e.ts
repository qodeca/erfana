// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal test hook (`window.__erfanaTest`) is installed for the e2e
 * fixtures' launches and is what `TerminalPage.readScreen()` reads through.
 */
import { test, expect } from './fixtures/index'
import { TerminalPage } from './pages/terminal.page'
import type { Api } from '../src/preload/index'

test.describe('terminal test hook', () => {
  test('is installed in e2e mode and returns the drawn terminal text', async ({ windowWithTestProject: page }) => {
    const terminalPage = new TerminalPage(page)
    await terminalPage.open()

    expect(await page.evaluate(() => window.api.testHooks.enabled)).toBe(true)

    const viaHook = await page.evaluate(async () => {
      const listed = await (window.api as Api).terminal.list()
      const id = listed.success ? listed.terminals[0]?.id : undefined
      return id ? (window.__erfanaTest?.terminalText(id) ?? null) : null
    })
    const screen = await terminalPage.readScreen()

    expect(viaHook).not.toBeNull()
    expect(viaHook).toBe(screen.lines.join('\n'))
  })
})
