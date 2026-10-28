// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Images referenced from Markdown in the preview (#71).
 *
 * Before the fix a relative `src` was handed to the page unchanged, so it
 * resolved against the app bundle (`out/renderer/assets/icon.svg`) and every
 * project image showed as a broken image (naturalWidth 0). These tests drive
 * the real pipeline – the main-process read through the confinement check, the
 * `data:` URL, the directory watcher – and assert on DECODED pixels
 * (`naturalWidth`), so a test can only pass when the image really painted.
 *
 * Condition-based waits only. The watcher floor is ~600 ms plus the preview's
 * 300 ms settle, so the budgets are generous polls, never sleeps.
 *
 * @see src/renderer/src/components/Editor/MarkdownImage.tsx
 * @see src/main/ipc/markdown-image-handlers.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { encodePng } from './fixtures/images/generateImageFixtures'
import { EditorPanelPage } from './pages/editor-panel.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'

/** Budget for a disk write to reach the preview (see the header). */
const REFRESH_BUDGET_MS = process.platform === 'win32' ? 12_000 : 8_000

const DOC = 'doc.md'
const OTHER = 'other.md'
const RED = { r: 200, g: 40, b: 40, a: 255 }

/**
 * An SVG with explicit intrinsic dimensions: one with only a `viewBox` reports
 * Chromium's default 300 px `naturalWidth`, which would hide a refresh.
 */
function svgSource(width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#c8ff00"/></svg>\n`
  )
}

test.use({
  testProjectFiles: {
    'assets/icon.svg': svgSource(40, 20),
    [DOC]: [
      '# Images doc',
      '',
      '![svg](./assets/icon.svg)',
      '',
      '![png](assets/pixel.png)',
      '',
      '![absolute](/etc/hosts.png)',
      '',
      '![outside](../outside.png)',
      '',
      '![fileurl](file:///etc/hosts.png)',
      ''
    ].join('\n'),
    [OTHER]: '# Other doc\n'
  }
})

/** Open a file from the tree in preview mode and return its preview. */
async function openPreview(page: Page, fileName: string, heading: string): Promise<Locator> {
  const panel = new EditorPanelPage(page)
  await new ProjectTreePage(page).fileRow(fileName).click()
  await new TabBarPage(page).waitForTab(fileName)
  await panel.waitForReady()
  const preview = panel.previewPane().filter({ hasText: heading })
  await expect(preview).toBeVisible()
  return preview
}

/** Decoded width of the image with this alt text; 0 while not painted. */
function naturalWidth(preview: Locator, alt: string): Promise<number> {
  return preview
    .locator(`img[alt="${alt}"]`)
    .evaluate((img) => ((img as HTMLImageElement).complete ? (img as HTMLImageElement).naturalWidth : 0))
    .catch(() => 0)
}

test.describe('Markdown preview images (#71)', () => {
  test.beforeEach(async ({ testProject }) => {
    // Binary fixture written here: the seed map takes text only
    await fs.promises.writeFile(path.join(testProject.path, 'assets', 'pixel.png'), encodePng(30, 15, { fill: RED }))
  })

  test('renders a project-relative SVG and PNG, and never loads paths outside the project', async ({
    windowWithTestProject: page
  }) => {
    const preview = await openPreview(page, DOC, 'Images doc')

    await expect.poll(() => naturalWidth(preview, 'svg'), { timeout: 10_000 }).toBe(40)
    await expect.poll(() => naturalWidth(preview, 'png'), { timeout: 10_000 }).toBe(30)
    // Bytes from the main process, as an image – the SVG is never inlined
    await expect(preview.locator('img[alt="svg"]')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
    await expect(preview.locator('img[alt="png"]')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(preview.locator('.markdown-preview-content svg')).toHaveCount(0)

    // Absolute, out-of-project and file: sources show their alt text only
    for (const alt of ['absolute', 'outside', 'fileurl']) {
      await expect(preview.locator(`img[alt="${alt}"]`)).toHaveCount(0)
      await expect(preview.locator('.markdown-image-placeholder', { hasText: alt })).toBeVisible()
    }
  })

  test('refreshes images changed on disk without reopening the tab', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const preview = await openPreview(page, DOC, 'Images doc')
    await expect.poll(() => naturalWidth(preview, 'svg'), { timeout: 10_000 }).toBe(40)
    await expect.poll(() => naturalWidth(preview, 'png'), { timeout: 10_000 }).toBe(30)
    const svgHandle = await preview.locator('img[alt="svg"]').elementHandle()

    // In-place rewrite of the SVG, atomic replace of the PNG (how agents and
    // design tools usually write)
    await fs.promises.writeFile(path.join(testProject.path, 'assets', 'icon.svg'), svgSource(80, 20))
    const tmp = path.join(testProject.path, 'assets', '.pixel.png.tmp')
    await fs.promises.writeFile(tmp, encodePng(60, 15, { fill: RED }))
    await fs.promises.rename(tmp, path.join(testProject.path, 'assets', 'pixel.png'))

    await expect.poll(() => naturalWidth(preview, 'svg'), { timeout: REFRESH_BUDGET_MS }).toBe(80)
    await expect.poll(() => naturalWidth(preview, 'png'), { timeout: REFRESH_BUDGET_MS }).toBe(60)
    // The same element was updated in place: no remount, no blank frame
    const sameElement = await preview
      .locator('img[alt="svg"]')
      .evaluate((img, before) => img === before, svgHandle)
    expect(sameElement).toBe(true)
  })

  test('a preview hidden behind another tab shows the new image when shown again', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const preview = await openPreview(page, DOC, 'Images doc')
    await expect.poll(() => naturalWidth(preview, 'svg'), { timeout: 10_000 }).toBe(40)

    await openPreview(page, OTHER, 'Other doc')
    await fs.promises.writeFile(path.join(testProject.path, 'assets', 'icon.svg'), svgSource(120, 20))

    await new TabBarPage(page).activate(DOC)
    await expect.poll(() => naturalWidth(preview, 'svg'), { timeout: REFRESH_BUDGET_MS }).toBe(120)
  })
})
