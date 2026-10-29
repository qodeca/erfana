// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/run-an-agent-in-the-terminal.md
 *
 * Follows the page step by step, finding controls by the labels the page
 * names. The real `claude` CLI is launched from Erfana's terminal.
 *
 * Real agent: set ERFANA_GUIDE_CLAUDE_TOKEN_FILE to a file holding a Claude
 * Code token (`claude setup-token`; the capture runbook's
 * `.local/capture/claude-token` works). The variable reaches the terminal's
 * shell through the ERFANA_ allowlist prefix, and the command reads the token
 * from the file, so its value never appears on screen or in the output. The
 * sandbox home gets the same `~/.claude.json` and project `acceptEdits`
 * settings as the capture sandbox (scripts/capture/sandbox.mjs), so no
 * first-run screen or approval prompt appears, and the agent makes the edit.
 *
 * Without the variable, the isolated home has no Claude Code login: Claude
 * Code stops at its login screen, and the edit is made by a plain shell
 * command – a STAND-IN for the agent, labelled as such in the step title.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

const FILE = 'notes.md'
const TOKEN_FILE = process.env.ERFANA_GUIDE_CLAUDE_TOKEN_FILE
const REAL_AGENT = Boolean(TOKEN_FILE && fs.existsSync(TOKEN_FILE))
const EDITED_TEXT = REAL_AGENT ? 'Agent edit from the guide test' : 'Stand-in edit from the terminal'

test.use({ testProjectFiles: { [FILE]: '# Notes\n\nOriginal line.\n' } })

test.describe('Guide: run an agent in the terminal', () => {
  test('starts a CLI agent, reviews an edit, maximizes and restarts the terminal', async ({
    windowWithTestProject: window,
    testProject,
    homeDir
  }) => {
    test.setTimeout(REAL_AGENT ? 360_000 : 180_000)
    test.info().annotations.push({ type: 'agent', description: REAL_AGENT ? 'real Claude Code' : 'shell stand-in (no token file)' })
    // Harness helper only for READING the terminal buffer (xterm draws to a canvas).
    const terminal = new TerminalPage(window)

    if (REAL_AGENT) {
      // Harness setup, not a page step: what a user's own Claude Code install
      // already has (onboarding done, the project trusted, edits accepted).
      const projects: Record<string, object> = {}
      for (const p of new Set([testProject.path, fs.realpathSync(testProject.path)])) {
        projects[p] = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      }
      fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, projects }))
      fs.mkdirSync(path.join(testProject.path, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(testProject.path, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } })
      )
    }

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
      // The login prefix is harness, not a page step; the token stays in the file.
      await window.keyboard.type(REAL_AGENT ? 'CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_GUIDE_CLAUDE_TOKEN_FILE")" claude' : 'claude')
      await window.keyboard.press('Enter')
      // The real Claude Code CLI starts and draws its own screen.
      await terminal.waitForOutput(REAL_AGENT ? 'accept edits on' : 'Claude Code', { timeout: 60_000 })
      const lines = (await terminal.readScreen()).lines
      await test.info().attach('terminal after starting the agent', { body: lines.join('\n') })
      await test.info().attach('claude started', { body: await window.screenshot(), contentType: 'image/png' })
      expect(lines.some((l) => l.includes('Claude Code') && !/\bclaude\s*$/.test(l))).toBe(true)
    })

    if (REAL_AGENT) {
      await test.step('Start 3: Tell the agent which file to inspect or change.', async () => {
        await terminal.getTerminal().click()
        await window.keyboard.type(`In ${FILE}, add the line "${EDITED_TEXT}" at the end. Change nothing else.`)
        await window.keyboard.press('Enter')
        await expect
          .poll(() => fs.readFileSync(path.join(testProject.path, FILE), 'utf8'), { timeout: 240_000, intervals: [500, 1000, 2000] })
          .toContain(EDITED_TEXT)
      })
    } else {
      await test.step('Next: Use **Restart terminal** ... Erfana asks before it ends it.', async () => {
        await restartTerminal()
      })
      await test.step('Start 3: Tell the agent which file to inspect or change. (STAND-IN: shell edit)', async () => {
        // Claude Code is not logged in here, so a shell command makes the edit
        // an agent would make. This is a stand-in, not the agent.
        await terminal.getTerminal().click()
        await window.keyboard.type(`printf '\\n${EDITED_TEXT}\\n' >> ${FILE}`)
        await window.keyboard.press('Enter')
        await expect.poll(() => fs.readFileSync(path.join(testProject.path, FILE), 'utf8')).toContain(EDITED_TEXT)
      })
    }

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

    if (REAL_AGENT) {
      await test.step('Next: Use **Restart terminal** ... Erfana asks before it ends it.', async () => {
        await restartTerminal()
      })
    }

    async function restartTerminal(): Promise<void> {
      await window.getByRole('button', { name: 'Restart terminal' }).click()
      const question = window.getByRole('dialog').filter({ hasText: 'Restart terminal?' })
      await expect(question).toBeVisible({ timeout: 10_000 })
      // The page does not name the confirm button; it reads Restart. Confirming ends the agent and starts a fresh shell.
      await question.getByRole('button', { name: 'Restart', exact: true }).click()
      await expect(question).toBeHidden()
      await terminal.waitForPrompt()
    }
  })
})
