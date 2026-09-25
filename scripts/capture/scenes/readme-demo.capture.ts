// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `readme-demo`: #139's README demo loop, recorded from the real app
 * with real Claude Code (design § Loop for #139; spec R138-2…11).
 *
 * Storyboard (#139): S0 open the project from Recent projects · S1 Claude Code
 * idle, status bar visible · S2 select the plan's list, right-click,
 * Visualize > Flowchart · S3 the prompt reaches the terminal · S4 the agent
 * works (sped up in the edit) · S5 the Mermaid block lands and renders · S6
 * hold.
 *
 * The scene only records and logs marks; `run.mjs` cuts, speeds up and
 * encodes. Its recording starts with a one-colour sync flash so the marks
 * (wall-clock times) can be placed on the video's own timeline exactly.
 *
 * Capture-only choices, none of which changes the app:
 * - an Electron zoom factor of DEMO_ZOOM, so the terminal's 12 px text stays
 *   legible when the loop is shown 800 px wide (spike Q8, leader decision);
 * - between S0 and S1 (the cut) the project panel is folded, as a user
 *   would, so the editor and the terminal have the room.
 */

import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS, getDynamicTestId } from '../../../src/renderer/src/constants/testids'
import { blurAll, closeProject, launch, openFile, openProject, visible } from '../lib/app'
import { anySelected, clearToasts, shot, stableWindowCapture } from '../lib/shots'
import { ensureTerminalOpen, ptyContains, ptyLength, readPty, runAgentTurn, startClaude, stopHookCount, waitForPty, waitForShellPrompt } from '../lib/terminal'

const ROWS = ['readme/demo-webp', 'readme/demo-gif', 'readme/demo-mp4', 'readme/demo-still']

/** Capture-only zoom for terminal legibility at 800 px (runbook: legibility). */
export const DEMO_ZOOM = 1.25

const PLAN = 'handbook/open-day-plan.md'

/** Wall-clock time once the current frame has been painted (two animation frames). */
async function painted(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())))))
}

/**
 * Show a full-window magenta flash for a number of painted frames and return
 * the wall-clock time it was first on screen. `run.mjs` finds the first
 * magenta frame in the recording and so knows the video time of that instant.
 */
async function syncFlash(page: Page): Promise<number> {
  const shownAt = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const d = document.createElement('div')
        d.id = '__capture_sync'
        d.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'
        document.body.appendChild(d)
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())))
      })
  )
  // Keep it up for 20 painted frames (about a third of a second), then remove it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0
        const tick = (): void => {
          if (++n >= 20) {
            document.getElementById('__capture_sync')?.remove()
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          } else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
  )
  return shownAt
}

/** Fold the project panel so the editor and the agent's terminal have the room. */
async function roomForTheAgent(page: Page): Promise<void> {
  await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
  await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeHidden({ timeout: 10_000 })
}

test('readme-demo', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  test.setTimeout(10 * 60_000)
  const videoDir = path.join(process.env.ERFANA_CAPTURE_SANDBOX ?? '', 'video')
  const cap = await launch({ zoom: DEMO_ZOOM, recordVideoDir: videoDir })
  const { page, sandbox: sb } = cap
  const marks: Record<string, number> = {}
  let syncWall = 0
  let terminalRect = { x: 0, y: 0, width: 0, height: 0 }
  let knownLine = ''
  try {
    // Before recording starts to matter: the project becomes the only Recent
    // projects entry (opened once through the bridge, then closed).
    await openProject(cap)
    await closeProject(cap)
    const recent = page.getByTestId(getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT, sb.project))
    await expect(recent).toBeVisible()
    await clearToasts(page)
    await blurAll(page)
    syncWall = await syncFlash(page)
    await stableWindowCapture(cap)
    marks.startScreen = await painted(page)

    // S0: open the project from Recent projects, then the plan in Split view.
    let from = await ptyLength(page)
    await recent.click()
    await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeVisible({ timeout: 20_000 })
    await ensureTerminalOpen(page)
    await waitForShellPrompt(page, { from })
    await openFile(cap, PLAN, 'split')
    await clearToasts(page)
    await stableWindowCapture(cap)
    marks.projectOpen = await painted(page)

    // The cut. Claude Code starts and answers one short question off camera
    // (Erfana's status bar appears only after a finished turn). Claude Code
    // keeps its header (version, model, folder) at the top of its screen and
    // repaints it after any clear, so S1 shows that header; the start-up
    // itself is cut (runbook: README demo).
    await roomForTheAgent(page)
    await startClaude(page)
    await runAgentTurn(page, sb.stopLog, 'Reply with the single word: ready')
    await expect(page.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).toBeVisible({ timeout: 60_000 })
    await blurAll(page)
    await stableWindowCapture(cap)
    marks.claudeIdle = await painted(page)

    // S2: select the list, right-click, Visualize, Flowcharts.
    const editor = visible(page, TEST_IDS.EDITOR_MONACO)
    const firstItem = editor.locator('.view-line', { hasText: /1\.\s*Book/ })
    await firstItem.click({ position: { x: 1, y: 4 } })
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Meta+Shift+ArrowDown')
    await expect(editor.locator('.selected-text').first()).toBeVisible()
    await stableWindowCapture(cap)
    marks.selected = await painted(page)
    await firstItem.click({ button: 'right' })
    const menu = page.getByTestId(TEST_IDS.CONTEXT_MENU_EDITOR)
    await expect(menu).toBeVisible()
    await stableWindowCapture(cap)
    marks.menuOpen = await painted(page)
    await menu.getByRole('menuitem', { name: 'Visualize' }).click()
    const dialog = page.getByTestId(TEST_IDS.DIALOG_PROMPT)
    await expect(dialog).toBeVisible()
    await dialog.getByTestId(TEST_IDS.DIALOG_PROMPT_DROPDOWN).selectOption('flowchart')
    await stableWindowCapture(cap)
    marks.dialogOpen = await painted(page)

    // S3: the prompt reaches Claude Code in the terminal.
    const turnsBefore = stopHookCount(sb.stopLog)
    from = await ptyLength(page)
    await dialog.getByTestId(TEST_IDS.DIALOG_BTN_CONFIRM).click()
    await expect(dialog).toHaveCount(0)
    // Claude Code folds a long paste into one line; that line is what the
    // viewer reads at the hand-off, so it is the legibility check's known text.
    knownLine = 'Pasted text'
    await waitForPty(page, knownLine, { from, timeout: 30_000 })
    await stableWindowCapture(cap)
    marks.handedOff = await painted(page)
    const box = await page.getByTestId(TEST_IDS.TERMINAL_INSTANCE).boundingBox()
    if (!box) throw new Error('terminal not visible')
    // CSS px under the zoom → window px of the 1280×800 recording.
    terminalRect = { x: box.x * DEMO_ZOOM, y: box.y * DEMO_ZOOM, width: box.width * DEMO_ZOOM, height: box.height * DEMO_ZOOM }

    // S4 → S5: the agent's turn ends on the Stop hook; the block is on disk and rendered.
    const planFile = path.join(sb.project, ...PLAN.split('/'))
    const preview = visible(page, TEST_IDS.EDITOR_PREVIEW)
    await expect.poll(() => stopHookCount(sb.stopLog), { timeout: 5 * 60_000, intervals: [250, 500, 1000] }).toBeGreaterThan(turnsBefore)
    await expect.poll(() => fs.readFileSync(planFile, 'utf8').includes('```mermaid'), { timeout: 30_000 }).toBe(true)
    await expect(preview.locator('.mermaid-diagram svg').first()).toBeVisible({ timeout: 30_000 })
    // R138-8: the edit went through with no approval prompt on the way.
    expect(await ptyContains(page, 'Do you want to', from)).toBe(false)
    await preview.locator('.mermaid-diagram svg').first().scrollIntoViewIfNeeded()
    await blurAll(page)
    await stableWindowCapture(cap)
    marks.editLanded = await painted(page)

    await shot(cap, 'readme/demo-still', { windowCapture: true, scaleWidth: 1280 })
    marks.end = await painted(page)

  } finally {
    // Also after a failure, for whoever inspects the sandbox.
    const dom = await page.evaluate(() => document.body.innerText).catch(() => '')
    fs.writeFileSync(path.join(sb.raw, 'readme-demo.dom.txt'), dom)
    fs.writeFileSync(path.join(sb.raw, 'readme-demo.pty.txt'), await readPty(page).catch(() => ''))
    const video = page.video()
    await cap.close()
    if (video) {
      const file = await video.path()
      fs.writeFileSync(
        path.join(sb.raw, 'readme-demo.json'),
        `${JSON.stringify({ video: file, syncWall, marks, terminalRect, knownLine, zoom: DEMO_ZOOM }, null, 2)}\n`
      )
    }
  }
})
