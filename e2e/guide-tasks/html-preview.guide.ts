// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/preview-an-html-page.md
 *
 * Follows the page step by step as a newcomer would, finding every control by
 * the label the page gives it. The previewed page itself runs in a native
 * view, so its content is read (and its elements clicked) through the main
 * process with the shared preview helpers – that is harness, not guidance.
 *
 * Condition-based waits only.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'
import { evalInPreview, livePreviews } from '../pages/html-preview.native'
import { HtmlPreviewPage } from '../pages/html-preview.page'
import { clickElement, waitForOverlay } from '../pages/html-preview.comments-ui'

const BUDGET = 20_000
const INDEX = { urlIncludes: '/index.html' }

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Open day flyer</title></head>
<body>
  <h1 id="headline">Open day flyer</h1>
  <p id="intro">Come and meet the garden club on Saturday.</p>
</body>
</html>
`

const PARTNERS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Our partners</title>
  <link rel="stylesheet" href="https://cdn.example.org/partners.css">
</head>
<body>
  <h1 id="partners">Our partners</h1>
</body>
</html>
`

const BROKEN_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Volunteer sign-up</title></head>
<body>
  <h1>Volunteer sign-up</h1>
  <script>rota.load()</script>
</body>
</html>
`

test.use({
  testProjectFiles: {
    'index.html': INDEX_HTML,
    'partners.html': PARTNERS_HTML,
    'signup.html': BROKEN_HTML
  }
})

/** Wait until a live preview serves `name`. */
async function waitForLivePreview(app: ElectronApplication, name: string): Promise<void> {
  await expect
    .poll(async () => (await livePreviews(app)).some((p) => p.url.endsWith(`/${name}`)), {
      timeout: BUDGET,
      message: `no running page for ${name}`
    })
    .toBe(true)
}

/** The row for `name` in the project tree. */
function treeFile(window: Page, name: string) {
  return window.getByRole('treeitem', { name }).or(window.getByText(name, { exact: true })).first()
}

test('Guide: preview an HTML page', async ({
  windowWithTestProject: window,
  appWithTestProject: app,
  testProject
}) => {
  test.setTimeout(180_000)

  await test.step('Before you start: Run HTML files is on in Settings > HTML preview', async () => {
    // "check that **Run HTML files** is on in **Settings** > **HTML preview**. It is on by default."
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(window.getByText('HTML preview', { exact: true }).first()).toBeVisible()
    const runHtml = window.getByRole('switch', { name: 'Run HTML files' })
      .or(window.getByRole('checkbox', { name: 'Run HTML files' }))
    await expect(runHtml).toBeChecked()
    await window.keyboard.press('Escape')
    await expect(runHtml).toBeHidden()
  })

  await test.step('1. Select an HTML file in the project tree. It opens as a running page.', async () => {
    await treeFile(window, 'index.html').click()
    await waitForLivePreview(app, 'index.html')
    await expect
      .poll(() => evalInPreview(app, `document.getElementById('headline')?.textContent ?? null`), {
        timeout: BUDGET
      })
      .toBe('Open day flyer')
  })

  await test.step('2. To see the code instead, right-click the file and choose Open as source.', async () => {
    await treeFile(window, 'index.html').click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Open as source' }).click()
    // The source is shown in the editor: the raw markup is visible.
    await expect(window.getByText('<h1 id="headline">', { exact: false }).first()).toBeVisible({
      timeout: BUDGET
    })
  })

  await test.step('3. Use the preview toolbar: Back, Find, Open in default browser and Export to PDF.', async () => {
    // Back to the running page: select the file in the tree again.
    await treeFile(window, 'index.html').click()
    await waitForLivePreview(app, 'index.html')
    await expect(window.getByRole('button', { name: 'Back', exact: true })).toBeVisible({ timeout: BUDGET })
    await expect(window.getByRole('button', { name: 'Open in default browser', exact: true })).toBeVisible()

    // Find searches the page.
    await window.getByRole('button', { name: 'Find', exact: true }).click()
    const findBox = window.getByRole('search').getByRole('textbox')
    await expect(findBox).toBeVisible()
    await findBox.fill('garden')
    await window.keyboard.press('Escape')

    // Export to PDF saves the page (native save dialog stubbed).
    const pdfPath = path.join(testProject.path, 'flyer.pdf')
    await stubDialog(app, 'showSaveDialog', { canceled: false, filePath: pdfPath })
    await window.getByRole('button', { name: 'Export to PDF', exact: true }).click()
    await expect
      .poll(() => fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).subarray(0, 4).toString(), {
        timeout: BUDGET,
        message: 'Export to PDF did not write the file'
      })
      .toBe('%PDF')
  })

  await test.step('4. For a remote host, select the blocked count in the toolbar, such as 1 blocked · 0 allowed. Then select Allow, and Confirm only after reviewing the host.', async () => {
    await treeFile(window, 'partners.html').click()
    await waitForLivePreview(app, 'partners.html')
    await window.getByRole('button', { name: /^1 blocked · 0 allowed/ }).click()
    // The visible label is "Allow"; its accessible name adds the host.
    await window.getByRole('button', { name: /^Allow\b/ }).click()
    await window.getByRole('button', { name: 'Confirm', exact: true }).click()
    // NOTE: "Approved remote hosts are saved in the project's `.erfana/settings.json`."
    const settingsFile = path.join(testProject.path, '.erfana', 'settings.json')
    await expect
      .poll(() => (fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf-8') : ''), {
        timeout: BUDGET
      })
      .toContain('https://cdn.example.org')
  })

  await test.step('Comment 1. Select Comment mode in the toolbar.', async () => {
    await treeFile(window, 'index.html').click()
    await waitForLivePreview(app, 'index.html')
    const modeButton = window.getByRole('button', { name: 'Comment mode', exact: true })
    await modeButton.click()
    await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
    // Harness: comment mode reloads the page with its overlay; wait for it.
    await waitForOverlay(new HtmlPreviewPage(window, app), app, INDEX)
  })

  await test.step('Comment 2. Select an element. The first time, enter your name in Before your first comment and select Continue.', async () => {
    await clickElement(app, 'intro', 'left', INDEX)
    const prompt = window.getByRole('dialog', { name: 'Before your first comment' })
    await expect(prompt).toBeVisible({ timeout: BUDGET })
    await prompt.getByRole('textbox', { name: 'Name' }).fill('Newcomer')
    await prompt.getByRole('button', { name: 'Continue', exact: true }).click()
  })

  await test.step('Comment 3. Type the comment and select Save. It is saved inside the .html file, and a pin marks the element.', async () => {
    const commentText = 'Please add the start time.'
    const saveButton = window.getByRole('button', { name: 'Save', exact: true })
    const commentWindow = window.getByRole('dialog').filter({ has: saveButton })
    await expect(commentWindow).toBeVisible({ timeout: BUDGET })
    await commentWindow.getByRole('textbox').first().fill(commentText)
    await saveButton.click()
    await expect
      .poll(() => fs.readFileSync(path.join(testProject.path, 'index.html'), 'utf-8'), {
        timeout: BUDGET
      })
      .toContain(commentText)
  })

  await test.step('If something goes wrong: select the issue count on the preview tab.', async () => {
    await treeFile(window, 'signup.html').click()
    await waitForLivePreview(app, 'signup.html')
    const issueCount = window.getByRole('button', { name: /issue/i }).first()
    await expect(issueCount).toBeVisible({ timeout: BUDGET })
    await issueCount.click()
    await expect(window.getByText(/rota is not defined/).first()).toBeVisible({ timeout: BUDGET })
  })
})
