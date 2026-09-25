// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `selection-prompts`: a selection turned into a prompt, from the
 * editor and from the preview; the Modify and Visualize dialogs; a Modify
 * prompt handled by Claude Code. Guide page: how-to/turn-a-selection-into-a-prompt.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { blurAll, launch, openFile, openProject, selectInEditor, visible } from '../lib/app'
import { anySelected, shot } from '../lib/shots'
import { startClaude, stopHookCount, waitForPty, ptyLength } from '../lib/terminal'

const ROWS = [
  'turn-a-selection/editor-menu',
  'turn-a-selection/preview-menu',
  'turn-a-selection/modify-dialog',
  'turn-a-selection/visualize-dialog',
  'turn-a-selection/prompt-in-terminal'
]
const MEETING = 'meetings/2026-03-14-spring-meeting.md'

test('selection-prompts', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  test.setTimeout(10 * 60_000)
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    await openFile(cap, MEETING, 'split')
    const editorPane = visible(page, TEST_IDS.EDITOR_PANE)
    const previewPane = visible(page, TEST_IDS.PREVIEW_PANE)
    const dialog = page.getByTestId(TEST_IDS.DIALOG_CONTAINER)

    // The editor: the water-butts paragraph selected, right-click.
    const first = await selectInEditor(page, /The\stwo\swater/, /meeting\./)
    await first.click({ button: 'right', position: { x: 40, y: 4 } })
    const editorMenu = page.getByTestId(TEST_IDS.CONTEXT_MENU_EDITOR)
    await expect(editorMenu).toBeVisible()
    await shot(cap, 'turn-a-selection/editor-menu', { crop: [editorPane, editorMenu] })

    // Modify from the editor menu, an instruction typed, not sent.
    await editorMenu.getByTestId(TEST_IDS.CONTEXT_MENU_ITEM_MODIFY).click()
    await expect(dialog).toBeVisible()
    await page.getByTestId(TEST_IDS.DIALOG_PROMPT_INPUT).fill('Make this paragraph shorter and friendlier.')
    await shot(cap, 'turn-a-selection/modify-dialog', { crop: dialog, pad: 16 })
    await page.getByTestId(TEST_IDS.DIALOG_BTN_CANCEL).click()
    await expect(dialog).toHaveCount(0)

    // Visualize: the diagram type is a native list, shown closed (runbook).
    await selectInEditor(page, /The\stwo\swater/, /meeting\./)
    await first.click({ button: 'right', position: { x: 40, y: 4 } })
    await expect(editorMenu).toBeVisible()
    await editorMenu.getByRole('menuitem', { name: 'Visualize' }).click()
    await expect(dialog).toBeVisible()
    await page.getByTestId(TEST_IDS.DIALOG_PROMPT_DROPDOWN).selectOption('flowchart')
    await shot(cap, 'turn-a-selection/visualize-dialog', { crop: dialog, pad: 16 })
    await page.getByTestId(TEST_IDS.DIALOG_BTN_CANCEL).click()
    await expect(dialog).toHaveCount(0)

    // The preview: the same paragraph selected there; its menu opens on a DOM selection.
    const para = previewPane.locator('p', { hasText: 'The two water butts' })
    await expect(para).toBeVisible()
    await para.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 8, button: 2 }))
    })
    const previewMenu = page.getByTestId(TEST_IDS.CONTEXT_MENU_PREVIEW)
    await expect(previewMenu).toBeVisible()
    await shot(cap, 'turn-a-selection/preview-menu', { crop: [previewPane, previewMenu] })
    await page.keyboard.press('Escape')
    await expect(previewMenu).toHaveCount(0)

    if (!anySelected(['turn-a-selection/prompt-in-terminal'])) return
    // Modify sent to Claude Code; the shot is taken when its turn has ended
    // (a working spinner never holds still for a screenshot).
    await startClaude(page)
    await selectInEditor(page, /The\stwo\swater/, /meeting\./)
    await first.click({ button: 'right', position: { x: 40, y: 4 } })
    await editorMenu.getByTestId(TEST_IDS.CONTEXT_MENU_ITEM_MODIFY).click()
    await page.getByTestId(TEST_IDS.DIALOG_PROMPT_INPUT).fill('Make this paragraph shorter and friendlier.')
    const turns = stopHookCount(sb.stopLog)
    const from = await ptyLength(page)
    const file = path.join(sb.project, ...MEETING.split('/'))
    const before = fs.readFileSync(file, 'utf8')
    await page.getByTestId(TEST_IDS.DIALOG_BTN_CONFIRM).click()
    await waitForPty(page, 'Pasted text', { from })
    await expect.poll(() => stopHookCount(sb.stopLog), { timeout: 5 * 60_000, intervals: [250, 500, 1000] }).toBeGreaterThan(turns)
    await expect.poll(() => fs.readFileSync(file, 'utf8') !== before, { timeout: 30_000 }).toBe(true)
    await blurAll(page)
    await shot(cap, 'turn-a-selection/prompt-in-terminal')
  } finally {
    await cap.close()
  }
})
