// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `agent`: the terminal at its prompt, Claude Code started, an edit
 * landing in the planting calendar, the status bar, the maximised terminal and
 * the guide's overview picture. Real Claude Code, logged in through the
 * sandbox (spec § 3.3); every turn ends on the Stop hook's file.
 * Guide pages: how-to/run-an-agent-in-the-terminal.md, README.md,
 * first-ten-minutes.md, reference/claude-code-status-bar.md, reference/terminal.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { blurAll, launch, openFile, openProject, visible } from '../lib/app'
import { anySelected, drawTitleTooltip, removeDrawnTooltips, shot } from '../lib/shots'
import { focusTerminal, runAgentTurn, startClaude } from '../lib/terminal'

const ROWS = [
  'run-an-agent/shell-prompt',
  'run-an-agent/claude-started',
  'run-an-agent/edit-lands',
  'index/overview',
  'claude-code-status-bar/status-bar',
  'run-an-agent/terminal-maximized'
]
const AGENT_ROWS = ROWS.slice(1)

/** The edit the agent is asked for: one row, one file. */
export const CALENDAR_PROMPT =
  'In handbook/planting-calendar.md add a table row for Carrots: sow March to June, sown where they grow (no planting out), harvest June to October. Change nothing else.'

test('agent', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  test.setTimeout(12 * 60_000)
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    await openFile(cap, 'handbook/planting-calendar.md', 'split')
    const terminal = page.getByTestId(TEST_IDS.TERMINAL_PANEL)

    await focusTerminal(page)
    await shot(cap, 'run-an-agent/shell-prompt', { crop: terminal, maxHeight: 220 })
    if (!anySelected(AGENT_ROWS)) return

    // The status bar appears only after the session's first finished turn
    // (ClaudeStatusService), so Claude Code gets one short question first.
    await startClaude(page)
    await runAgentTurn(page, sb.stopLog, 'Reply with one short sentence: which crops does handbook/planting-calendar.md list?')
    const statusBar = page.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)
    await expect(statusBar).toBeVisible({ timeout: 60_000 })
    await blurAll(page)
    await shot(cap, 'run-an-agent/claude-started', { crop: terminal })

    const calendar = path.join(sb.project, 'handbook', 'planting-calendar.md')
    const preview = visible(page, TEST_IDS.EDITOR_PREVIEW)
    await runAgentTurn(page, sb.stopLog, CALENDAR_PROMPT, async () => {
      const onDisk = fs.readFileSync(calendar, 'utf8').includes('| Carrots')
      return onDisk && (await preview.getByRole('cell', { name: 'Carrots' }).count()) > 0
    })
    // Bring the new row into view in the preview, as a reader would scroll to it.
    await preview.getByRole('cell', { name: 'Carrots' }).scrollIntoViewIfNeeded()
    await blurAll(page)
    await shot(cap, 'index/overview')
    const statusTip = await drawTitleTooltip(page, statusBar, 'capture-tip-status')
    await shot(cap, 'claude-code-status-bar/status-bar', { crop: [statusBar, statusTip], pad: 12, keepHover: true })
    await removeDrawnTooltips(page)

    // The edit landing, with the project panel folded away so the file and
    // the agent's summary have the room.
    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
    await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeHidden({ timeout: 10_000 })
    await shot(cap, 'run-an-agent/edit-lands')
    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
    await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeVisible({ timeout: 10_000 })

    const expand = page.getByTestId(TEST_IDS.TERMINAL_BTN_EXPAND)
    await expand.click()
    await expect(expand).toHaveAttribute('aria-pressed', 'true')
    await blurAll(page)
    await shot(cap, 'run-an-agent/terminal-maximized')
  } finally {
    await cap.close()
  }
})
