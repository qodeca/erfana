// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Keyboard paste in the terminal pastes the clipboard exactly once (#463).
 *
 * On Windows, xterm turns Ctrl+V into `^V` for the shell and fires no paste
 * event, so Ctrl+V pasted nothing; Ctrl+Shift+V could paste twice, once by the
 * app and once by the browser's own paste. The unit tests used a mocked xterm
 * and never saw either. This test writes a unique text to the real system
 * clipboard, presses each paste key the platform supports in the real
 * terminal, and counts the text on screen: exactly one copy per press.
 *
 * The system clipboard is shared by every Playwright worker on the machine, so
 * each press pastes its own token: another test's value can only make an
 * assertion fail, never pass. Waits are condition-based only.
 */
import { test, expect } from './fixtures/index'
import { TerminalPage } from './pages/terminal.page'

/** The paste keys each platform supports, as Playwright names them. */
const PASTE_KEYS: Record<string, string[]> = {
  win32: ['Control+v', 'Control+Shift+V', 'Shift+Insert'],
  linux: ['Control+Shift+V', 'Shift+Insert'],
  darwin: ['Meta+v', 'Control+Shift+V']
}

/** How many times `token` shows in the terminal text. */
function countIn(text: string, token: string): number {
  return text.split(token).length - 1
}

test.describe('Terminal keyboard paste (#463)', () => {
  // One worker, in order: the tests share one system clipboard
  test.describe.configure({ mode: 'default' })

  for (const key of PASTE_KEYS[process.platform] ?? []) {
    test(`${key} pastes the clipboard exactly once`, async ({ windowWithTestProject: page, appWithTestProject: app }) => {
      const terminal = new TerminalPage(page)
      await terminal.open()
      await terminal.focus()

      const token = `PASTE-${key.replace(/\W/g, '')}-${Date.now()}`
      await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), token)

      await page.keyboard.press(key)

      await terminal.waitForOutput(token, { timeout: 10_000 })
      // A second paste (the browser's own) would land right after the first
      await expect
        .poll(async () => countIn((await terminal.readScreen()).lines.join('\n'), token), { timeout: 3_000 })
        .toBe(1)

      // Leave the prompt clean for the next test: Ctrl+C with no selection interrupts
      await terminal.interrupt()
    })
  }
})
