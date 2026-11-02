// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pointer targets of at least 24 x 24 (#96, WCAG 2.2 SC 2.5.8,
 * docs/design-system/system/foundations/surfaces.html and components/icon).
 *
 * The editor and image tabs' close buttons and the settings checkboxes are
 * measured in the real UI. The other listed controls – the HTML preview tab's
 * close button (alone and squeezed to the 80px tab floor beside a failure
 * badge), the badge itself, the dialog info button and the import dialog's
 * checkbox labels – each need a running preview, a dialog or an import flow to
 * appear, so they are measured as probes: the same markup and class names,
 * placed in the running app so the shipped stylesheet lays them out. All
 * component CSS is in the one entry bundle, so a probe gets exactly the rules
 * the real control does.
 *
 * A size alone is not a target: a parent with `overflow: hidden` can clip a
 * 24px button to a sliver and its bounding box still reads 24. So every check
 * also hit-tests the four corners, 1px in, and requires each to land on the
 * control itself.
 */

import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { ImageViewerPage } from './pages/image-viewer.page'
import { imageExportTest } from './utils/image-export-helpers'
import { IMAGE_FIXTURES } from './fixtures/images/generateImageFixtures'
import { openSettings } from './utils/helpers'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

/** WCAG 2.2 SC 2.5.8 minimum, and the value of --btn-height-sm. */
const MIN_TARGET_PX = 24

/** What a target measured: its box, and which of its corners hit-test to it. */
interface Target {
  name: string
  width: number
  height: number
  /** Corners (1px in) where elementFromPoint did NOT land on the target. */
  missedCorners: string[]
}

type Measure = (el: Element, name: string) => Target

/**
 * Install the in-page measurer as `window.__erfMeasureTarget`: an element's
 * bounding box, and whether the topmost element at each corner (1px in) is the
 * element or one of its descendants. Installed rather than passed, because a
 * function cannot cross the evaluate boundary and the renderer's CSP forbids
 * rebuilding one from source.
 */
async function installMeasure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const measure: Measure = (el, name) => {
      const rect = el.getBoundingClientRect()
      const corners: Array<[string, number, number]> = [
        ['top-left', rect.left + 1, rect.top + 1],
        ['top-right', rect.right - 1, rect.top + 1],
        ['bottom-left', rect.left + 1, rect.bottom - 1],
        ['bottom-right', rect.right - 1, rect.bottom - 1]
      ]
      const missedCorners = corners
        .filter(([, x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return hit === null || !(hit === el || el.contains(hit))
        })
        .map(([corner]) => corner)
      return { name, width: rect.width, height: rect.height, missedCorners }
    }
    ;(window as unknown as { __erfMeasureTarget: Measure }).__erfMeasureTarget = measure
  })
}

async function measureLocator(locator: Locator, name: string): Promise<Target> {
  await locator.scrollIntoViewIfNeeded()
  await installMeasure(locator.page())
  return locator.evaluate(
    (el, label) => (window as unknown as { __erfMeasureTarget: Measure }).__erfMeasureTarget(el, label),
    name
  )
}

/**
 * Probe markup, mirroring the components. Each `data-probe` element is the
 * pointer target: the button, or (for the import dialog) the label that wraps
 * its checkbox and toggles it. The squeezed HTML preview tab sits in a box
 * exactly as wide as the tab's 80px floor.
 */
const PROBES = `
  <div class="html-preview-tab"><span class="html-preview-tab-label">page.html</span>
    <button class="html-preview-tab-close" data-probe="html preview tab close">x</button></div>
  <div style="display: flex; width: 80px">
    <div class="html-preview-tab">
      <span class="html-preview-tab-icon"><svg width="14" height="14"></svg></span>
      <span class="html-preview-tab-label">a-long-page-name.html</span>
      <span class="html-preview-badge-anchor"><button class="html-preview-badge" data-probe="html preview failure badge">
        <svg width="14" height="14"></svg><span class="html-preview-badge-count">12</span></button></span>
      <button class="html-preview-tab-close" data-probe="html preview tab close, 80px tab with badge">x</button>
    </div>
  </div>
  <div class="dialog-info-wrapper"><button type="button" class="dialog-info-icon" data-probe="dialog info button"></button></div>
  <div class="doc-import-option-row">
    <label class="doc-import-checkbox-label" data-probe="import checkbox label">
      <input type="checkbox" /><span>Enable OCR text recognition</span>
    </label>
  </div>
`

async function measureProbes(page: Page): Promise<Target[]> {
  await installMeasure(page)
  return page.evaluate((markup) => {
    const measure = (window as unknown as { __erfMeasureTarget: Measure }).__erfMeasureTarget
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    // Topmost, so the corner hit-tests reach the probes and nothing above them
    host.style.cssText =
      'position: fixed; top: 0; left: 0; width: 400px; z-index: 2147483647; background: black;'
    host.innerHTML = markup
    document.body.appendChild(host)
    const targets = Array.from(host.querySelectorAll<HTMLElement>('[data-probe]')).map((el) =>
      measure(el, el.dataset.probe ?? '')
    )
    host.remove()
    return targets
  }, PROBES)
}

function expectTarget(target: Target): void {
  expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  expect(target.missedCorners, `${target.name}: corners covered or clipped`).toEqual([])
}

test.describe('Target size', () => {
  test.describe('editor tab', () => {
    test.use({ testProjectFiles: { 'alpha.md': '# Alpha\n' } })

    test('the close button is a full 24 x 24 target', async ({ windowWithTestProject: page }) => {
      const tree = new ProjectTreePage(page)
      const tabs = new TabBarPage(page)
      await tree.fileRow('alpha.md').click()
      await tabs.waitForTab('alpha.md')
      // Hovering reveals the button; it is opacity 0 otherwise but still hit-testable
      await tabs.closeButton('alpha.md').hover()

      expectTarget(await measureLocator(tabs.closeButton('alpha.md'), 'editor tab close'))
    })
  })

  test('every settings checkbox is a full 24 x 24 target', async ({ window: page }) => {
    await openSettings(page)
    const boxes = page.locator('.settings-checkbox')
    // Editor, git polling, HTML preview, HTML Preview comments and (spec 024) Markdown Preview
    // comments toggles; an empty list would prove nothing
    await expect(boxes).toHaveCount(5)
    for (const box of await boxes.all()) {
      expectTarget(await measureLocator(box, `settings checkbox ${await box.getAttribute('id')}`))
    }
  })

  test('the HTML preview tab, failure badge, dialog info button and import checkboxes are full 24 x 24 targets', async ({
    window: page
  }) => {
    const targets = await measureProbes(page)
    expect(targets.map((t) => t.name)).toEqual([
      'html preview tab close',
      'html preview failure badge',
      'html preview tab close, 80px tab with badge',
      'dialog info button',
      'import checkbox label'
    ])
    for (const target of targets) expectTarget(target)
  })
})

imageExportTest.describe('Target size – image tab', () => {
  imageExportTest.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

  imageExportTest('the close button is a full 24 x 24 target', async ({ windowWithTestProject: page }) => {
    const viewer = new ImageViewerPage(page)
    await viewer.openFromTree(IMAGE_FIXTURES.png.fileName)
    const close = page.locator(`[data-testid^="${TEST_IDS.IMAGE_TAB_CLOSE}"]`).first()
    await expect(close).toBeAttached()
    await close.hover()

    expectTarget(await measureLocator(close, 'image tab close'))
  })
})
