// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – comments on selected words (spec 024 024-FR-004,
 * 024-AC-004; comments-v2 OD-01, C-16).
 *
 * Real Chromium, real preload, real file on disk:
 *
 * - **024-AC-004 (b), C-16.** In comment mode a drag selects (it is no pick);
 *   Enter while the Comment button shows opens the window on the words, and
 *   Save writes a block whose anchor carries `sel` – the words main found in
 *   the file.
 * - **OD-01, 024-AC-004 (a).** Outside comment mode, on a page main already
 *   instruments (it has a comment), a right-click on selected words is the
 *   "Selection" menu; "Comment on selection" opens the window and Save writes
 *   a second block with `sel`.
 *
 * Helpers: `pages/html-preview.comments-ui.ts`. Local gate only: e2e is
 * disabled in CI. Condition-based waits only.
 */

import * as path from 'path'
import { test, expect } from './fixtures/index'
import {
  CommentChrome,
  diskBytes,
  dragInPage,
  mouseAt,
  openCommentPage,
  pressInPage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  singleBlockInsert,
  waitForBox,
  waitForViewShown
} from './pages/html-preview.comments-ui'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

const PAGE = 'comments/selection.html'
const TITLE = '-HPC-SEL-'
const TARGET = HtmlPreviewPage.target(PAGE)
const NAME = 'Reviewer SEL Tq7Wd'

/** One wide monospace line, so a drag across its first half stays on it. */
const PAGE_TEXT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  `  <title>${TITLE}</title>`,
  '  <style>body { margin: 40px; } p { margin: 0 0 24px; font: 20px/1.6 monospace; white-space: nowrap; }</style>',
  '</head>',
  '<body>',
  '  <p id="ship">We ship the beta to ten customers by Friday.</p>',
  '  <p id="other">Nothing to see in this line at all.</p>',
  '</body>',
  '</html>',
  ''
].join('\n')

test.use({ testProjectFiles: { [PAGE]: PAGE_TEXT } })

/** A drag across the first half of `#ship`'s line: words, not the whole element. */
async function selectWords(app: Parameters<typeof waitForBox>[0]): Promise<{ x: number; y: number }> {
  await waitForViewShown(app, TARGET)
  const box = await waitForBox(app, 'ship', TARGET)
  const y = Math.round(box.top + box.height / 2)
  const from = { x: Math.round(box.left + 2), y }
  const to = { x: Math.round(box.left + box.width * 0.45), y }
  expect(await dragInPage(app, from, to, TARGET), 'no preview to drag in').toBe(true)
  return { x: Math.round((from.x + to.x) / 2), y }
}

/** The one block a save added, as text; it must carry selected words. */
function expectWordsBlock(before: Buffer, after: Buffer): string {
  const insert = singleBlockInsert(before, after)
  expect(insert, 'the save did not add exactly one block').not.toBeNull()
  const text = insert!.inserted.toString('utf-8')
  expect(text, text).toContain('"sel"')
  expect(text).toMatch(/"exact":"[^"]+"/)
  return text
}

test.describe('HTML Preview comments – selected words (024-AC-004)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('024-AC-004 (b) C-16 in comment mode a drag selects; Enter opens the window on the words; Save writes sel', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'selection.html')
    const file = path.join(testProject.path, PAGE)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = await diskBytes(file)

    const panelId = await openCommentPage(preview, app, PAGE, TITLE)
    await chrome.modeOn(app, panelId, TARGET)
    await selectWords(app)
    // A drag is no pick: no window yet.
    await expect(chrome.window()).toHaveCount(0)
    expect(await pressInPage(app, 'Enter', [], TARGET)).toBe(true)
    await expect(chrome.window()).toHaveAttribute('data-view', /^(identity|new)$/, { timeout: PREVIEW_BUDGET_MS })
    await chrome.saveNewComment('Note-SEL-b: name the customers', PAGE, NAME)

    const text = expectWordsBlock(before, await diskBytes(file))
    expect(text).toContain('Note-SEL-b')
  })

  test('OD-01 024-AC-004 (a) outside comment mode a right-click on selected words is the Selection menu; Comment on selection writes sel', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'selection.html')
    const file = path.join(testProject.path, PAGE)
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    // A first comment: the page has blocks, so main instruments it outside comment mode too.
    const panelId = await openCommentPage(preview, app, PAGE, TITLE)
    await chrome.modeOn(app, panelId, TARGET)
    await selectWords(app)
    expect(await pressInPage(app, 'Enter', [], TARGET)).toBe(true)
    await chrome.saveNewComment('Note-SEL-a1: first', PAGE, NAME)
    await chrome.modeButton().click()
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'false', { timeout: PREVIEW_BUDGET_MS })
    const before = await diskBytes(file)

    const at = await selectWords(app)
    expect(await mouseAt(app, at, 'right', TARGET), 'no preview to right-click').toBe(true)
    await expect(chrome.menu()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.menu()).toHaveAttribute('aria-label', 'Selection')
    await page.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION).click()
    await chrome.saveNewComment('Note-SEL-a2: second', PAGE, NAME)

    const text = expectWordsBlock(before, await diskBytes(file))
    expect(text).toContain('Note-SEL-a2')
  })
})
