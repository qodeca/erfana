// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/first-ten-minutes.md, followed as a newcomer.
 *
 * Goes from first launch (Home, no project) to a real Claude Code turn that
 * edits a Markdown file, and checks the edit lands on disk and in the app's
 * preview. Each step records the app time it took; the total plus the page's
 * reading time (200 words per minute) must fit in ten minutes.
 *
 * Needs ERFANA_GUIDE_CLAUDE_TOKEN_FILE: the path of a Claude Code OAuth token
 * file. The token is read only inside the terminal's shell, never here.
 */

import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'

const PAGE = path.join(__dirname, '..', '..', 'docs', 'user-guide', 'first-ten-minutes.md')
const AGENT_TURN_MS = 4 * 60_000
const TEN_MINUTES_MS = 10 * 60_000

const NOTE_FILE = 'shopping.md'
const NOTE_CONTENT = '# Shopping list\n\n- apples\n- bread\n'
const ADDED_ITEM = 'bananas'

/** Words a reader reads on the page: prose only, without the SPDX comment and image lines. */
function pageReadingMs(): { words: number; ms: number } {
  const text = fs
    .readFileSync(PAGE, 'utf-8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('!['))
    .join(' ')
  const words = text.split(/\s+/).filter((w) => /\w/.test(w)).length
  return { words, ms: (words / 200) * 60_000 }
}

test.use({ testProjectFiles: { [NOTE_FILE]: NOTE_CONTENT } })

test('first ten minutes: from first launch to a reviewed agent edit', async ({
  testProject,
  homeDir,
  app,
  window,
  terminalPage
}) => {
  const tokenFile = process.env.ERFANA_GUIDE_CLAUDE_TOKEN_FILE
  if (!tokenFile || !fs.existsSync(tokenFile)) {
    throw new Error(
      'ERFANA_GUIDE_CLAUDE_TOKEN_FILE must name an existing Claude Code token file – ' +
        'this guide task needs a real agent and has no stand-in.'
    )
  }
  test.setTimeout(AGENT_TURN_MS + 3 * 60_000)

  const projectPath = testProject.path
  const notePath = path.join(projectPath, NOTE_FILE)
  const timings: Array<{ step: string; ms: number }> = []
  let agentScreen = ''
  const timed = async (title: string, body: () => Promise<void>): Promise<void> => {
    await test.step(title, async () => {
      const started = Date.now()
      await body()
      timings.push({ step: title, ms: Date.now() - started })
    })
  }

  // --- Open a project ---

  await timed('Open a project 1: "On Home, select **Open project** and choose a folder containing Markdown files."', async () => {
    await stubDialog(app, 'showOpenDialog', { canceled: false, filePaths: [projectPath] })
    await window.getByRole('button', { name: 'Open project' }).first().click()
    await expect(window.getByText(NOTE_FILE, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  })

  await timed('Open a project 2: "Select a file in the project tree. New Markdown tabs open in Preview mode."', async () => {
    await window.getByText(NOTE_FILE, { exact: true }).first().click()
    await expect(window.getByRole('heading', { name: 'Shopping list' })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByRole('listitem').filter({ hasText: 'bread' })).toBeVisible()
  })

  await timed('Open a project 3: "Select **Split Vertical** in the toolbar to see source and preview together."', async () => {
    const splitVertical = window
      .getByRole('button', { name: /Split Vertical/ })
      .or(window.getByTitle(/Split Vertical/))
      .first()
    await splitVertical.click()
    // Source: the raw Markdown heading line is drawn by the editor; preview: the rendered heading.
    await expect(window.getByText(/#\s+Shopping\s+list/).first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByRole('heading', { name: 'Shopping list' })).toBeVisible()
  })

  // --- Start and review an agent turn ---

  await timed('Agent turn 1: "The terminal opens with the project. If you closed it, select **Terminal** on the right activity bar. Type the command for your installed CLI agent."', async () => {
    await expect(window.getByRole('button', { name: 'Terminal' }).first()).toBeVisible()
    await terminalPage.waitForReady()

    // Harness setup – what a user's own Claude Code install already has.
    const claudeJson = {
      theme: 'dark',
      hasCompletedOnboarding: true,
      projects: Object.fromEntries(
        [...new Set([projectPath, fs.realpathSync(projectPath)])].map((p) => [
          p,
          { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
        ])
      )
    }
    fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify(claudeJson, null, 2))
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2)
    )

    await terminalPage.sendCommand('CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_GUIDE_CLAUDE_TOKEN_FILE")" claude')
    await expect
      .poll(async () => (await terminalPage.readScreen()).lines.join('\n'), {
        message: 'Claude Code should start and wait for input',
        timeout: 60_000
      })
      .toMatch(/for shortcuts|accept edits/i)
  })

  await timed('Agent turn 2: "Ask the agent to make a small change to a file in this project."', async () => {
    await terminalPage.sendCommand(
      `In ${NOTE_FILE}, add one list item "- ${ADDED_ITEM}" after "- bread". Change nothing else.`,
      false
    )
    await terminalPage.waitForOutput(ADDED_ITEM)
    await window.keyboard.press('Enter')
    await expect
      .poll(() => fs.readFileSync(notePath, 'utf-8'), {
        message: 'the agent should add the item to the file on disk',
        timeout: AGENT_TURN_MS,
        intervals: [1000]
      })
      .toContain(`- ${ADDED_ITEM}`)
    const onDisk = fs.readFileSync(notePath, 'utf-8')
    expect(onDisk).toContain('- apples')
    expect(onDisk).toMatch(new RegExp(`- bread\\s*\\n- ${ADDED_ITEM}`))
    // Evidence the real agent made the edit: its own terminal screen (the typed
    // command shows the literal $(cat ...) expression, never the token).
    agentScreen = (await terminalPage.readScreen()).lines.slice(-25).join('\n')
  })

  await timed('Agent turn 3: "Review the changed source and preview. … external file changes reload in the open tab."', async () => {
    await expect(window.getByRole('listitem').filter({ hasText: ADDED_ITEM })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(new RegExp(`-\\s+${ADDED_ITEM}`)).first()).toBeVisible()
    // An untouched tab reloads quietly: no "changed on disk" bar.
    await expect(window.getByText(/changed on disk/i)).toHaveCount(0)
  })

  // Leave Claude Code so teardown meets a plain shell.
  await terminalPage.interrupt()
  await terminalPage.interrupt()

  const reading = pageReadingMs()
  const appMs = timings.reduce((sum, t) => sum + t.ms, 0)
  const report = [
    ...timings.map((t) => `${(t.ms / 1000).toFixed(1).padStart(7)} s  ${t.step.slice(0, 70)}`),
    `${(appMs / 1000).toFixed(1).padStart(7)} s  app time in total`,
    `${(reading.ms / 1000).toFixed(1).padStart(7)} s  reading ${reading.words} words at 200 wpm`,
    `${((appMs + reading.ms) / 1000).toFixed(1).padStart(7)} s  total (budget ${TEN_MINUTES_MS / 1000} s)`
  ].join('\n')
  console.log(`[first-ten-minutes]\n${report}`)
  console.log(`[first-ten-minutes] agent screen after the edit:\n${agentScreen}`)
  await test.info().attach('timings', { body: report, contentType: 'text/plain' })
  expect(appMs + reading.ms, 'app time plus reading time fits in ten minutes').toBeLessThan(TEN_MINUTES_MS)
})
