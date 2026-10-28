// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `html-preview`: a live page, the remote-host permission band, the
 * preview-issues list and the preview toolbar. The page itself is a separate
 * native view, so each shot lays its `capturePage()` over the window shot
 * (design § Native rows). Guide pages: how-to/preview-an-html-page.md,
 * reference/html-preview.md, reference/troubleshooting.md.
 */

import { expect, test, type Page } from '@playwright/test'
import { launch, openProject, type Capture } from '../lib/app'
import { ProjectTreePage } from '../../../e2e/pages/project-tree.page'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['html-preview/live-page', 'html-preview/remote-host-band', 'html-preview/problems', 'html-preview/toolbar']

/** The visible HTML preview panel. */
const previewPanel = (page: Page) => page.locator('.html-preview-panel').filter({ visible: true })

/** Open an HTML file from the tree and wait until its native page has loaded. */
async function openPage(cap: Capture, rel: string): Promise<void> {
  const tree = new ProjectTreePage(cap.page)
  // The tree re-renders when the watcher reports a change; retry the expand
  // and click as a whole (seen once: the folder row gone for a moment).
  await expect(async () => {
    await tree.expandTo(['site'])
    await tree.fileRow(rel).click({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
  await expect(previewPanel(cap.page)).toBeVisible({ timeout: 20_000 })
  const name = rel.split('/').pop() as string
  await expect
    .poll(
      () =>
        cap.app.evaluate(({ BrowserWindow }, file) => {
          for (const win of BrowserWindow.getAllWindows()) {
            for (const child of win.contentView.children) {
              const wc = (child as unknown as { webContents?: Electron.WebContents }).webContents
              if (wc && wc.getURL().startsWith('erfana-preview://') && wc.getURL().includes(file) && !wc.isLoading()) return true
            }
          }
          return false
        }, name),
      { timeout: 20_000 }
    )
    .toBe(true)
}

test('html-preview', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page } = cap
  try {
    await openProject(cap)

    await openPage(cap, 'site/index.html')
    await shot(cap, 'html-preview/live-page', { crop: previewPanel(page), pad: 0, native: true })
    const bar = page.locator('.erf-band__bar').filter({ visible: true })
    await expect(bar).toBeVisible()
    await shot(cap, 'html-preview/toolbar', { crop: bar, pad: 6, native: true })

    await openPage(cap, 'site/partners.html')
    const band = page.locator('.erf-band').filter({ visible: true })
    await page.getByTestId('preview-band-chip').filter({ visible: true }).click()
    await expect(band.locator('.erf-band__list')).toBeVisible()
    // The button's name carries the whole origin being granted.
    await band.getByRole('button', { name: /^Allow .*cdn\.example\.org/ }).click()
    await expect(band.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    await shot(cap, 'html-preview/remote-host-band', { crop: previewPanel(page), pad: 0, native: true })
    await page.keyboard.press('Escape')

    await openPage(cap, 'site/broken.html')
    // The issue badge on broken.html's own tab (partners.html can carry one too).
    await page.locator('[title*="site/broken.html"] .html-preview-badge').click()
    const popover = page.locator('.html-preview-badge-popover')
    await expect(popover).toBeVisible()
    await shot(cap, 'html-preview/problems', { crop: [previewPanel(page), popover], pad: 0, native: true })
  } finally {
    await cap.close()
  }
})
