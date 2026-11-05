// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: a prompt command started from the preview submits itself (#449).
 *
 * Every built-in prompt template presses Enter after pasting the prompt. With a
 * long, multi-line selection the paste takes a while to reach the program in
 * the terminal – on Windows ConPTY hands it over in pieces – and an Enter sent
 * on a fixed timer arrived in the same read as the end of the paste, where a
 * prompt box takes it for a line break inside the pasted text. The prompt sat
 * in the box, unsent.
 *
 * The terminal runs a stand-in agent (e2e/fixtures/pasteSubmitAgent.cjs) that
 * applies that rule and prints whether the Enter arrived as a submit. The test
 * runs the real Explain command from the preview context menu on a 150-line
 * paragraph, so the prompt goes through the real template, IPC and PTY.
 *
 * The agent takes its input ~1 KiB per read, 50 ms apart, as ConPTY does, so
 * the bug reproduces on every OS: an Enter on the old fixed 200 ms timer is
 * still queued behind the paste and lands in the read with its end
 * (AGENT-LINEBREAK). The agent reports how long the paste took to read, and the
 * test checks that this outlasted the old 200 ms – otherwise it would prove
 * nothing about the timer.
 *
 * Uses the manual launch pattern of context-menu-explain.e2e.ts.
 */

import { test, expect, _electron as electron, type Page } from '@playwright/test'
import * as path from 'path'
import { E2E_CHROMIUM_ARGS } from './fixtures/isolation'
import { TerminalPage } from './pages/terminal.page'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForAppReady,
  openProject,
  clickFileByName,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

/** Source lines in the selected paragraph – long enough that the paste arrives in several reads. */
const PARAGRAPH_LINES = 150

const longParagraph = Array.from(
  { length: PARAGRAPH_LINES },
  (_, i) => `Line ${i + 1} of a long paragraph that is sent to the agent as one prompt.`
).join('\n')

const testSeed = {
  'long.md': `# Long selection\n\n${longParagraph}\n`
}

/** Forward slashes work for node under every Windows shell and on POSIX. */
const AGENT_SCRIPT = path.join(__dirname, 'fixtures', 'pasteSubmitAgent.cjs').replace(/\\/g, '/')

/** Long enough for a paste of this size on a loaded Windows host. */
const SUBMIT_TIMEOUT_MS = 30_000

/** The fixed Enter delay before #449 (ENTER_MIN_DELAY_MS in terminalInputSettle.ts). */
const OLD_FIXED_ENTER_DELAY_MS = 200

/** `AGENT-SUBMIT <characters> took=<ms>` – see pasteSubmitAgent.cjs. */
const SUBMIT_LINE = /^AGENT-SUBMIT (\d+) took=(\d+)$/

/**
 * Select the paragraph and fire the context menu on it in one step, so no
 * re-render can clear the selection in between (see context-menu-explain.e2e.ts).
 */
async function selectParagraphAndOpenMenu(page: Page): Promise<void> {
  await page.evaluate((tid) => {
    const p = document.querySelector(`[data-testid="${tid}"] .markdown-preview-content p`)
    if (!p) throw new Error('Paragraph not found in preview')
    const range = document.createRange()
    range.selectNodeContents(p)
    const sel = window.getSelection()
    if (!sel) throw new Error('No selection object')
    sel.removeAllRanges()
    sel.addRange(range)
    const rect = p.getBoundingClientRect()
    p.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + 50,
        clientY: rect.top + 10
      })
    )
  }, TEST_IDS.EDITOR_PREVIEW)
}

test.describe('Prompt commands submit by themselves (#449)', () => {
  test('Explain on a long multi-line selection is submitted, not left in the prompt box', async () => {
    test.setTimeout(120_000)

    const { projectPath, cleanup: cleanupProject } = await createTestProject(testSeed)
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('prompt-submit')

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ERFANA_E2E_TEST_HOOKS: '1'
      }
    })

    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10_000 })

      // Start the stand-in agent in the real terminal
      const terminal = new TerminalPage(window)
      await terminal.open()
      await terminal.sendCommand(`node "${AGENT_SCRIPT}"`)
      await terminal.waitForOutputLine('AGENT-READY', { timeout: 30_000 })

      await clickFileByName(window, 'long.md')
      const paragraph = byTestId(window, TEST_IDS.EDITOR_PREVIEW).locator('.markdown-preview-content p').first()
      await expect(paragraph).toBeVisible({ timeout: 10_000 })

      await selectParagraphAndOpenMenu(window)
      const menu = byTestId(window, TEST_IDS.CONTEXT_MENU_PREVIEW)
      await expect(menu).toBeVisible({ timeout: 3000 })
      await byTestId(window, TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN).click()
      await expect(menu).not.toBeVisible({ timeout: 2000 })

      // The agent prints AGENT-SUBMIT once Enter arrives on its own after the paste
      await expect
        .poll(async () => (await terminal.readScreen()).lines.map((l) => l.trim()), {
          message: 'the agent should report the prompt as submitted',
          timeout: SUBMIT_TIMEOUT_MS
        })
        .toContainEqual(expect.stringMatching(SUBMIT_LINE))
      const screen = (await terminal.readScreen()).lines.map((l) => l.trim())
      expect(screen, 'Enter must not arrive as a line break inside the paste').not.toContain('AGENT-LINEBREAK')

      const submitted = screen.map((l) => SUBMIT_LINE.exec(l)).find((m) => m !== null)
      // The whole prompt arrived: the template plus every selected line
      expect(Number(submitted?.[1])).toBeGreaterThan(longParagraph.length)
      // The paste was still being read when the old fixed Enter would have gone
      expect(
        Number(submitted?.[2]),
        'the paste must outlast the old fixed Enter delay, or this test cannot catch #449'
      ).toBeGreaterThan(OLD_FIXED_ENTER_DELAY_MS)
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})
