// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pointer targets of at least 24 x 24 (#96, WCAG 2.2 SC 2.5.8,
 * design/system/foundations/surfaces.html and components/icon).
 *
 * The editor tab's close button and the settings checkboxes are measured in
 * the real UI. The other listed controls – the image and HTML preview tabs'
 * close buttons, the dialog info button and the import dialog's checkbox
 * labels – each need a specific file type, dialog or import flow to appear, so
 * they are measured as probes: the same markup and class names, placed in the
 * running app so the shipped stylesheet lays them out. All component CSS is in
 * the one entry bundle, so a probe gets exactly the rules the real control does.
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { openSettings } from './utils/helpers'

/** WCAG 2.2 SC 2.5.8 minimum, and the value of --btn-height-sm. */
const MIN_TARGET_PX = 24

interface Size {
  name: string
  width: number
  height: number
}

/**
 * Probe markup, mirroring the components. Each probe's `data-probe` element is
 * the pointer target: the button, the checkbox, or (for the import dialog) the
 * label that wraps its checkbox and toggles it.
 */
const PROBES = `
  <div class="image-tab"><button class="image-tab-close" data-probe="image tab close"></button></div>
  <div class="html-preview-tab"><button class="html-preview-tab-close" data-probe="html preview tab close"></button></div>
  <div class="dialog-info-wrapper"><button type="button" class="dialog-info-icon" data-probe="dialog info button"></button></div>
  <div class="doc-import-option-row">
    <label class="doc-import-checkbox-label" data-probe="import checkbox label">
      <input type="checkbox" /><span>Enable OCR text recognition</span>
    </label>
  </div>
`

async function measureProbes(page: Page): Promise<Size[]> {
  return page.evaluate((markup) => {
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position: fixed; top: 0; left: 0; width: 400px;'
    host.innerHTML = markup
    document.body.appendChild(host)
    const sizes = Array.from(host.querySelectorAll<HTMLElement>('[data-probe]')).map((el) => {
      const rect = el.getBoundingClientRect()
      return { name: el.dataset.probe ?? '', width: rect.width, height: rect.height }
    })
    host.remove()
    return sizes
  }, PROBES)
}

function expectTarget(size: Size): void {
  expect(size.width, `${size.name} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  expect(size.height, `${size.name} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
}

test.describe('Target size', () => {
  test.describe('editor tab', () => {
    test.use({ testProjectFiles: { 'alpha.md': '# Alpha\n' } })

    test('the close button is at least 24 x 24', async ({ windowWithTestProject: page }) => {
      const tree = new ProjectTreePage(page)
      const tabs = new TabBarPage(page)
      await tree.fileRow('alpha.md').click()
      await tabs.waitForTab('alpha.md')

      const box = await tabs.closeButton('alpha.md').boundingBox()
      expect(box).not.toBeNull()
      expectTarget({ name: 'editor tab close', width: box!.width, height: box!.height })
    })
  })

  test('every settings checkbox is at least 24 x 24', async ({ window: page }) => {
    await openSettings(page)
    const boxes = page.locator('.settings-checkbox')
    // Editor, git polling and HTML preview toggles; an empty list would prove nothing
    await expect(boxes).toHaveCount(3)
    for (const box of await boxes.all()) {
      const rect = await box.boundingBox()
      expect(rect).not.toBeNull()
      expectTarget({
        name: `settings checkbox ${await box.getAttribute('id')}`,
        width: rect!.width,
        height: rect!.height
      })
    }
  })

  test('preview tab close buttons, the dialog info button and import checkboxes are at least 24 x 24', async ({
    window: page
  }) => {
    const sizes = await measureProbes(page)
    expect(sizes.map((s) => s.name)).toEqual([
      'image tab close',
      'html preview tab close',
      'dialog info button',
      'import checkbox label'
    ])
    for (const size of sizes) expectTarget(size)
  })
})
