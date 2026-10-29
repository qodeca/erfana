// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task run: docs/user-guide/first-ten-minutes.md ("Start with Erfana").
 *
 * A newcomer goes from first launch to a first agent run using only that page.
 * Every control is found by the label the page gives the reader. The native
 * folder picker is stubbed. App time per step is measured and printed.
 *
 * Real agent: set ERFANA_GUIDE_CLAUDE_TOKEN_FILE to a file holding a Claude
 * Code token (as in run-an-agent.guide.ts). The sandbox home and project get
 * the capture sandbox's Claude Code settings, the token is read from the file
 * inside the command (never shown), and the agent makes the small change.
 *
 * Without it, stated rather than hidden: the real `claude` CLI starts but is
 * not logged in inside the isolated home, so the spec stops it, and "Ask the
 * agent to make a small change" is done by a STAND-IN – a plain shell command
 * in the same terminal. It is not the agent; it proves the
 * terminal-to-file-to-preview path that step 3 asks the reader to review.
 */
import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'
import { TerminalPage } from '../pages/terminal.page'

const FILE_NAME = 'garden-notes.md'
const SEED = '# Garden notes\n\nPlant the tomatoes in May.\n'
const ADDED_LINE = 'Water the beans every evening.'
const TOKEN_FILE = process.env.ERFANA_GUIDE_CLAUDE_TOKEN_FILE
const REAL_AGENT = Boolean(TOKEN_FILE && fs.existsSync(TOKEN_FILE))

test.use({ testProjectFiles: { [FILE_NAME]: SEED } })

test.describe('Guide: Start with Erfana (first ten minutes)', () => {
  test('first launch to a first agent run, by the page alone', async ({
    app,
    window,
    testProject,
    homeDir
  }) => {
    test.setTimeout(REAL_AGENT ? 360_000 : 120_000)
    test.info().annotations.push({ type: 'agent', description: REAL_AGENT ? 'real Claude Code' : 'shell stand-in (no token file)' })
    if (REAL_AGENT) {
      // Harness setup, not a page step: what a user's own Claude Code install
      // already has (onboarding done, the project trusted, edits accepted).
      const projects: Record<string, object> = {}
      for (const p of new Set([testProject.path, fs.realpathSync(testProject.path)])) {
        projects[p] = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      }
      fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, projects }))
      fs.mkdirSync(path.join(testProject.path, '.claude'), { recursive: true })
      fs.writeFileSync(path.join(testProject.path, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }))
    }
    const timings: Array<[string, number]> = []
    let mark = Date.now()
    const lap = (label: string): void => {
      const now = Date.now()
      timings.push([label, now - mark])
      mark = now
    }
    const terminal = new TerminalPage(window)
    const filePath = path.join(testProject.path, FILE_NAME)

    // ## Open a project
    await test.step('1. On Home, select **Open project** and choose a folder containing Markdown files.', async () => {
      await stubDialog(app, 'showOpenDialog', { filePaths: [testProject.path], canceled: false })
      await window.getByRole('button', { name: 'Open project' }).first().click()
      await expect(window.getByText(FILE_NAME).first()).toBeVisible({ timeout: 15_000 })
      lap('open project')
    })

    await test.step('2. Select a file in the project tree. New Markdown tabs open in Preview mode.', async () => {
      await window.getByText(FILE_NAME).first().click()
      await expect(window.getByRole('heading', { name: 'Garden notes' })).toBeVisible({ timeout: 15_000 })
      // Preview mode: no source editor yet
      await expect(window.locator('.monaco-editor')).toHaveCount(0)
      lap('select file, preview')
    })

    await test.step('3. Select **Split Vertical** in the toolbar to see source and preview together.', async () => {
      await window.getByRole('button', { name: 'Split Vertical' }).click()
      await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 })
      await expect(window.getByRole('heading', { name: 'Garden notes' })).toBeVisible()
      lap('split vertical')
    })

    // ## Start and review an agent turn
    await test.step('1. The terminal opens with the project. If you closed it, select **Terminal** on the right activity bar. Type the command for your installed CLI agent.', async () => {
      // "The terminal opens with the project."
      await expect(terminal.getTerminal()).toBeVisible({ timeout: 15_000 })
      await terminal.waitForPrompt()
      // "If you closed it, select **Terminal** on the right activity bar."
      // The accessible name carries the shortcut, e.g. "Terminal (⌘J)".
      const terminalButton = window.getByRole('button', { name: /^Terminal\b/ })
      await terminalButton.click()
      await expect(terminal.getTerminal()).toBeHidden()
      await terminalButton.click()
      await expect(terminal.getTerminal()).toBeVisible({ timeout: 15_000 })
      await terminal.waitForPrompt()
      // The real installed CLI agent. Without a token file it is not logged in
      // inside the isolated home, so it shows its login screen instead.
      // The login prefix is harness, not a page step; the token stays in the file.
      await terminal.sendCommand(REAL_AGENT ? 'CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_GUIDE_CLAUDE_TOKEN_FILE")" claude' : 'claude')
      await expect
        .poll(async () => (await terminal.readScreen()).lines.join('\n'), {
          message: 'the real claude CLI should start and draw its screen',
          timeout: 30_000
        })
        .toMatch(/Claude Code|Welcome to Claude|theme|Log in|login/i)
      console.log('[guide] claude screen:\n' + (await terminal.readScreen()).lines.filter((l) => l.trim()).join('\n'))
      if (REAL_AGENT) {
        await terminal.waitForOutput('accept edits on', { timeout: 60_000 })
        lap('open terminal, start agent')
        return
      }
      // Not logged in here: stop the CLI and return to the shell.
      // Proof of being back at the shell: only a shell expands $((40+2)).
      await expect(async () => {
        // Ctrl+C twice: the CLI asks for a second press before it exits.
        await terminal.interrupt()
        await window.keyboard.press('Control+C')
        await terminal.sendCommand('echo SHELL_BACK_$((40+2))')
        await terminal.waitForOutputLine('SHELL_BACK_42', { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
      lap('open terminal, start agent')
    })

    await test.step(`2. Ask the agent to make a small change to a file in this project.${REAL_AGENT ? '' : ' (STAND-IN: shell edit)'}`, async () => {
      if (REAL_AGENT) {
        await terminal.getTerminal().click()
        await window.keyboard.type(`In ${FILE_NAME}, add the line "${ADDED_LINE}" at the end. Change nothing else.`)
        await window.keyboard.press('Enter')
        await expect.poll(() => fs.readFileSync(filePath, 'utf-8'), { timeout: 240_000, intervals: [500, 1000, 2000] }).toContain(ADDED_LINE)
        lap('agent change')
        return
      }
      // STAND-IN, not the agent: the shell in the same terminal edits the file.
      await terminal.sendCommand(`printf '\\n${ADDED_LINE}\\n' >> ${FILE_NAME}`)
      await expect.poll(() => fs.readFileSync(filePath, 'utf-8')).toContain(ADDED_LINE)
      lap('stand-in change')
    })

    await test.step('3. Review the changed source and preview. … external file changes reload in the open tab.', async () => {
      // Contains, not exact: an agent may append the line to the last paragraph,
      // and Markdown then renders both lines as one paragraph.
      await expect(window.getByText(ADDED_LINE).first()).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('.monaco-editor').first()).toContainText(ADDED_LINE)
      lap('review reload')
    })

    const total = timings.reduce((sum, [, ms]) => sum + ms, 0)
    console.log(
      '[guide] app time per step (ms): ' +
        timings.map(([label, ms]) => `${label}=${ms}`).join(', ') +
        ` | total=${total}`
    )
  })
})
