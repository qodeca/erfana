// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/run-an-agent-in-the-terminal.md
 *
 * Follows the page step by step, finding controls by the labels the page
 * names. The real `claude` CLI is launched (it is on PATH), but the isolated
 * home has no Claude Code login, so it stops at its first-run screen and
 * cannot be told to edit a file. The edit that "lands" in the review section is
 * therefore made by a plain shell command – a STAND-IN for the agent's edit,
 * not the agent – to prove the terminal-to-editor path the page promises.
 */

import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

const FILE = 'notes.md'
const EDITED_TEXT = 'Stand-in edit from the terminal'

test.use({ testProjectFiles: { [FILE]: '# Notes\n\nOriginal line.\n' } })

test.describe('Guide: run an agent in the terminal', () => {
  test('starts a CLI agent, reviews an edit, maximizes and restarts the terminal', async ({
    windowWithTestProject: window,
    testProject
  }) => {
    test.setTimeout(180_000)
    // Harness helper only for READING the terminal buffer (xterm draws to a canvas).
    const terminal = new TerminalPage(window)

    // "Before you start: open a project." – the fixture opened one.

    await test.step('Start 1: A terminal opens when the project loads. If it is closed, select **Terminal** in the right activity bar.', async () => {
      const terminalButton = window.getByRole('button', { name: /^Terminal\b/ })
      await expect(terminalButton).toBeVisible({ timeout: 15_000 })
      // "A terminal opens when the project loads." – nothing selected yet.
      const panel = window.getByRole('region', { name: 'Terminal' })
      await expect(panel).toBeVisible({ timeout: 15_000 })
      await expect(terminal.getTerminal()).toBeVisible({ timeout: 15_000 })
      await terminal.waitForPrompt()
      // "If it is closed, select Terminal": close it, then reopen it the page's way.
      await terminalButton.click()
      await expect(terminal.getTerminal()).toBeHidden()
      await terminalButton.click()
      await expect(terminal.getTerminal()).toBeVisible({ timeout: 15_000 })
      await terminal.waitForPrompt()
    })

    await test.step('Start 2: Select the terminal and type the command for your CLI agent.', async () => {
      await terminal.getTerminal().click()
      await window.keyboard.type('claude')
      await window.keyboard.press('Enter')
      // The real Claude Code CLI starts and draws its own screen (first-run
      // screen, since the isolated home is not logged in).
      await terminal.waitForOutput('Claude Code', { timeout: 60_000 })
      const lines = (await terminal.readScreen()).lines
      await test.info().attach('terminal after typing claude', { body: lines.join('\n') })
      await test.info().attach('claude started', { body: await window.screenshot(), contentType: 'image/png' })
      // The text came from the CLI, not from the echoed command line.
      expect(lines.some((l) => l.includes('Claude Code') && !/\bclaude\s*$/.test(l))).toBe(true)
    })

    await test.step('Next: Use **Restart terminal** ... Erfana asks before it ends it.', async () => {
      await window.getByRole('button', { name: 'Restart terminal' }).click()
      const question = window.getByRole('dialog').filter({ hasText: 'Restart terminal?' })
      await expect(question).toBeVisible({ timeout: 10_000 })
      // The page does not name the confirm button; it reads Restart. Confirming ends Claude Code and starts a fresh shell.
      await question.getByRole('button', { name: 'Restart', exact: true }).click()
      await expect(question).toBeHidden()
      await terminal.waitForPrompt()
    })

    await test.step('Start 3: Tell the agent which file to inspect or change. (STAND-IN: shell edit)', async () => {
      // Claude Code is not logged in here, so a shell command makes the edit
      // an agent would make. This is a stand-in, not the agent.
      await terminal.getTerminal().click()
      await window.keyboard.type(`printf '\\n${EDITED_TEXT}\\n' >> ${FILE}`)
      await window.keyboard.press('Enter')
      await expect
        .poll(async () => (await import('fs')).readFileSync(`${testProject.path}/${FILE}`, 'utf8'))
        .toContain(EDITED_TEXT)
    })

    await test.step('Review 2: Open the changed file from the project tree if it is not already open.', async () => {
      await window.getByRole('treeitem', { name: FILE }).click()
    })

    await test.step('Review 1: Watch the editor or preview after the agent finishes.', async () => {
      // Outside the terminal panel: the editor or the preview shows the edit.
      const outsideTerminal = window
        .getByText(EDITED_TEXT)
        .filter({ visible: true })
        .and(window.locator(':not([role="region"][aria-label="Terminal"] *)'))
      await expect(outsideTerminal.first()).toBeVisible({ timeout: 15_000 })
      await test.info().attach('edit lands', { body: await window.screenshot(), contentType: 'image/png' })
    })

    await test.step('Review 3: Select **Maximize terminal** when you need more terminal space.', async () => {
      const before = await terminal.getTerminal().boundingBox()
      await window.getByRole('button', { name: 'Maximize terminal' }).click()
      await expect
        .poll(async () => (await terminal.getTerminal().boundingBox())?.width ?? 0)
        .toBeGreaterThan(before?.width ?? 0)
      await test.info().attach('terminal maximized', { body: await window.screenshot(), contentType: 'image/png' })
    })
  })
})
