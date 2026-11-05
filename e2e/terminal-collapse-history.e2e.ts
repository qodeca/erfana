// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The terminal keeps its scroll history when its panel is collapsed and
 * expanded again (issue #465).
 *
 * Collapsing the panel (the activity-bar Terminal button) sets its width to
 * 0 px. The terminal used to fit itself to that, FitAddon clamped it to 2
 * columns, and xterm reflowed the whole scrollback to 2 columns: a 110-char
 * line became 55 rows, so 300 such lines needed far more than the 10,000-row
 * scrollback and the oldest were dropped for good. The test prints those 300
 * lines, collapses and expands the panel, and checks that the first line is
 * still in the history, whole.
 *
 * Waits are condition-based only (Playwright auto-waiting and `expect.poll`).
 */
import { test, expect } from './fixtures/index'
import { TerminalPage } from './pages/terminal.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'

const LINE_COUNT = 300
const LINE_BODY = 'x'.repeat(110)
/** One line of the history, as the shell prints it. */
const historyLine = (n: number): string => `HIST-${n}-${LINE_BODY}`

test.describe('Terminal history across a panel collapse (#465)', () => {
  test('keeps the first lines, whole, after the panel is collapsed and expanded', async ({
    windowWithTestProject: page
  }) => {
    test.setTimeout(120_000)
    const terminal = new TerminalPage(page)
    await terminal.open()

    // Node prints the same lines from any shell (PowerShell, zsh, bash)
    await terminal.sendCommand(
      `node -e "for (let i = 1; i <= ${LINE_COUNT}; i++) console.log('HIST-' + i + '-' + 'x'.repeat(110))"`
    )
    await terminal.waitForOutputLine(historyLine(LINE_COUNT), { timeout: 30_000 })
    expect((await terminal.readScreen()).lines).toContain(historyLine(1))

    // Collapse, then expand from the activity bar
    await terminal.close()
    await expect(byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)).not.toHaveClass(/\bactive\b/)
    await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await expect(terminal.getTerminal()).toBeVisible()

    // The oldest line is still there and unbroken; so is the newest
    await expect
      .poll(async () => (await terminal.readScreen()).lines, { timeout: 10_000 })
      .toEqual(expect.arrayContaining([historyLine(1), historyLine(LINE_COUNT)]))
  })
})
