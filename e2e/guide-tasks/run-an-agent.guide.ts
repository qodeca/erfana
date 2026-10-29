// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/run-an-agent-in-the-terminal.md
 *
 * Follows the page step by step with the REAL Claude Code CLI: start it in the
 * integrated terminal, ask it for one small edit, then review that edit in the
 * editor or preview, as the page promises.
 *
 * Login: ERFANA_GUIDE_CLAUDE_TOKEN_FILE names a token file. The token is read
 * inside the terminal's shell only – this spec never reads, prints or logs it.
 */

import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

const FILE_NAME = 'notes.md'
const BEFORE_LINE = 'Status: draft'
const AFTER_LINE = 'Status: reviewed by the agent'
const AGENT_TURN_MS = 4 * 60_000

test.use({
  testProjectFiles: {
    [FILE_NAME]: `# Notes\n\n${BEFORE_LINE}\n`
  }
})

test.describe('Guide: run an agent in the terminal', () => {
  test('Claude Code edits a file and the edit shows in the app', async ({
    windowWithTestProject: window,
    testProject,
    homeDir
  }) => {
    test.setTimeout(8 * 60_000)

    const tokenFile = process.env.ERFANA_GUIDE_CLAUDE_TOKEN_FILE
    if (!tokenFile || !fs.existsSync(tokenFile)) {
      throw new Error(
        'ERFANA_GUIDE_CLAUDE_TOKEN_FILE must name an existing Claude Code token file – ' +
          'this guide task needs the real agent and has no stand-in.'
      )
    }

    const terminal = new TerminalPage(window)
    const filePath = path.join(testProject.path, FILE_NAME)
    const editedText = window.getByText(AFTER_LINE).first()
    const terminalRegion = window.getByRole('region', { name: 'Terminal' })
    const terminalInput = terminalRegion.getByRole('textbox', { name: 'Terminal input' })

    await test.step('Harness setup: a Claude Code install that already trusts the project', async () => {
      const projectPaths = Array.from(
        new Set([testProject.path, fs.realpathSync(testProject.path)])
      )
      const projects = Object.fromEntries(
        projectPaths.map((p) => [p, { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }])
      )
      fs.writeFileSync(
        path.join(homeDir, '.claude.json'),
        JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, projects }, null, 2)
      )
      const settingsDir = path.join(testProject.path, '.claude')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.writeFileSync(
        path.join(settingsDir, 'settings.json'),
        JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2)
      )
    })

    await test.step('Before you start: "open a project" (and open the file to watch)', async () => {
      await window.getByText(FILE_NAME, { exact: true }).first().click()
      await expect(window.getByText(BEFORE_LINE).first()).toBeVisible({ timeout: 15_000 })
    })

    await test.step('Start 1: "A terminal opens when the project loads. If it is closed, select Terminal in the right activity bar."', async () => {
      // The activity-bar button's name carries its shortcut, e.g. "Terminal (⌘J)".
      const terminalButton = window.getByRole('button', { name: /^Terminal\b/ })
      await expect(terminalButton).toBeVisible({ timeout: 15_000 })
      await expect(async () => {
        if (!(await terminalRegion.isVisible())) {
          await terminalButton.click()
        }
        await expect(terminalRegion).toBeVisible({ timeout: 5_000 })
        // xterm's input is a hidden helper textarea; it only needs to exist.
        await expect(terminalInput).toBeAttached({ timeout: 5_000 })
      }).toPass({ timeout: 45_000 })
      await terminal.waitForPrompt()
    })

    await test.step('Start 2: "Select the terminal and type the command for your CLI agent."', async () => {
      await terminal.sendCommand(
        'CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_GUIDE_CLAUDE_TOKEN_FILE")" claude'
      )
      // Claude Code's start screen names the product.
      await expect
        .poll(async () => (await terminal.readScreen()).lines.join('\n'), {
          message: 'Claude Code should start in the terminal',
          timeout: 90_000
        })
        .toMatch(/Claude Code/)
    })

    await test.step('Start 3: "Tell the agent which file to inspect or change."', async () => {
      await terminal.sendCommand(
        `In ${FILE_NAME}, replace the line "${BEFORE_LINE}" with "${AFTER_LINE}". ` +
          'Change nothing else and do not create other files.'
      )
      await expect
        .poll(() => fs.readFileSync(filePath, 'utf-8'), {
          message: `the agent should rewrite ${FILE_NAME} on disk`,
          timeout: AGENT_TURN_MS,
          intervals: [2_000]
        })
        .toContain(AFTER_LINE)
      expect(fs.readFileSync(filePath, 'utf-8')).not.toContain(BEFORE_LINE)
    })

    await test.step('Review 1: "Watch the editor or preview after the agent finishes."', async () => {
      await expect(editedText).toBeVisible({ timeout: 30_000 })
    })

    await test.step('Review 2: "Open the changed file from the project tree if it is not already open."', async () => {
      await window.getByText(FILE_NAME, { exact: true }).first().click()
      await expect(editedText).toBeVisible({ timeout: 15_000 })
    })

    await test.step('Review 3: "Select Maximize terminal when you need more terminal space."', async () => {
      const maximize = terminalRegion.getByRole('button', { name: /^Maximize terminal/ })
      const widthBefore = (await terminalRegion.boundingBox())?.width ?? 0
      await maximize.click()
      // Maximized, the terminal spreads over the editor: its region gets wider.
      // (The editor stays in the DOM underneath, so its visibility proves nothing.)
      await expect
        .poll(async () => (await terminalRegion.boundingBox())?.width ?? 0, {
          message: 'Maximize terminal should widen the terminal over the editor',
          timeout: 10_000
        })
        .toBeGreaterThan(widthBefore + 100)
      await expect(terminalInput).toBeAttached()
    })

    await test.step('Cleanup: leave Claude Code', async () => {
      await terminal.interrupt()
      await terminal.interrupt()
    })
  })
})
