// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – the native page stays on its placeholder (#124, part 1, WI-8).
 *
 * The previewed page is a native `WebContentsView` laid over a DOM placeholder.
 * Every test here moves the layout one way, waits for it to settle, and checks
 * that the view's rectangle (read main-side) equals the placeholder's, scaled
 * by the host zoom and inset by the find bar – and that nothing but the
 * placeholder sits under the view.
 *
 * Reproduction first (part 1 §1.3, user answer 1): the four symptoms this spec
 * SHOWED (C1 ×2, C2, C3) were marked `test.fail` until WI-9 fixed their causes;
 * they now run as plain regression checks. A scenario that did not reproduce
 * stays as a plain check. Results, with the drop-point log lines each scenario
 * produced: `temp/124-wi8-results-e2e.md`.
 *
 * "Settled" means two reads 100 ms apart agree (part 1 §1.3). The drop lines
 * (renderer `PREVIEW_BOUNDS_DROP_REASON`, main `previewBoundsDropLog.ts`) are
 * read from the combined log and attached to each test as `drop-reasons`.
 *
 * The harness (reads, layout moves, the drop trail) lives in
 * `html-preview-bounds.harness.ts`, shared with the drag-freeze spec.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part1.md
 */

import { BOUNDS_PROJECT_FILES, SLIDE_PX, expect, test } from './html-preview-bounds.harness'
import { SearchBarPage } from './pages/search-bar.page'

test.use({ testProjectFiles: BOUNDS_PROJECT_FILES })

test.describe('HTML preview – native view bounds (#124 part 1)', () => {
  test.describe('reproduced – fixed by WI-9, kept as regression checks', () => {
    test('should keep the page on its placeholder when squeezing the editor slides it sideways', async ({ bounds }) => {
      await bounds.open()
      await bounds.squeezeEditor()
      await bounds.expectOnPlaceholder('after squeezing the editor')
    })

    test('should follow the editor when a tree-splitter drag slides it at its minimum width', async ({ bounds }) => {
      await bounds.open()
      await bounds.squeezeEditor()
      // A find-bar toggle forces a fresh push, so the slide starts from a correct rect.
      const find = new SearchBarPage(bounds.page)
      await bounds.page.getByTestId('preview-band-find').click()
      await find.waitForOpen()
      await find.closeButton().click()
      await find.waitForClosed()
      await bounds.expectOnPlaceholder('before the slide')
      await bounds.dragSashAt((await bounds.editorEdges()).left, SLIDE_PX)
      await bounds.expectOnPlaceholder('after the tree-splitter slide')
    })

    test('should hide the page when the terminal is expanded over the editor', async ({ bounds }) => {
      await bounds.open()
      await bounds.terminal.toggleExpand()
      await expect(bounds.terminal.expandButton()).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await bounds.editorEdges()).right - (await bounds.editorEdges()).left).toBe(0)
      await expect
        .poll(async () => (await bounds.preview.viewBounds())?.visible ?? false, {
          timeout: 5000,
          message: 'the page stayed drawn while the terminal covers the editor area'
        })
        .toBe(false)
    })

    test('should size the page with its own window zoom when another window exists', async ({ bounds }) => {
      await bounds.open()
      await bounds.app.evaluate(({ BrowserWindow }) => {
        new BrowserWindow({ show: false, width: 320, height: 240 })
      })
      await bounds.setHostZoomLevel(1)
      await bounds.expectOnPlaceholder('after zooming the host with a second window open')
      // M10 stays as a tripwire: with the host window's own zoom, it must stay silent.
      expect(await bounds.drops.reasons()).not.toContain('main:zoom-mismatch')
    })
  })

  test.describe('not reproduced – checks', () => {
    test('should keep the page on its placeholder when the window shrinks and grows', async ({ bounds }) => {
      await bounds.open()
      const win = await bounds.hostWindow()
      await win.evaluate((w) => w.setSize(1100, 750))
      await bounds.expectOnPlaceholder('after a shrink')
      await win.evaluate((w) => w.setSize(1400, 900))
      await bounds.expectOnPlaceholder('after a grow')
    })

    test('should keep the page on its placeholder when the window is resized from its left and top edges', async ({ bounds }) => {
      await bounds.open()
      await (await bounds.hostWindow()).evaluate((w) => {
        const b = w.getBounds()
        w.setBounds({ x: b.x + 150, y: b.y + 60, width: b.width - 150, height: b.height - 60 })
      })
      await bounds.expectOnPlaceholder('after an edge resize')
    })

    test('should keep the page on its placeholder when the window is maximized and restored', async ({ bounds }) => {
      await bounds.open()
      const win = await bounds.hostWindow()
      await win.evaluate((w) => w.maximize())
      await expect.poll(() => win.evaluate((w) => w.isMaximized())).toBe(true)
      await bounds.expectOnPlaceholder('after maximize')
      await win.evaluate((w) => w.unmaximize())
      await expect.poll(() => win.evaluate((w) => w.isMaximized())).toBe(false)
      await bounds.expectOnPlaceholder('after restore')
    })

    test('should keep the page on its placeholder after a rapid resize burst', async ({ bounds }) => {
      await bounds.open()
      await bounds.resizeBurst(40, { width: 1234, height: 811 })
      await bounds.expectOnPlaceholder('after 40 resizes, one per frame')
    })

    test('should place the page on its placeholder when it opens while the window is resizing', async ({ bounds }) => {
      await Promise.all([bounds.resizeBurst(90, { width: 1250, height: 820 }), bounds.open()])
      await bounds.expectOnPlaceholder('after the burst ended')
    })

    test('should inset the page below the find bar and release it when the bar closes', async ({ bounds }) => {
      await bounds.open()
      const find = new SearchBarPage(bounds.page)
      await bounds.page.getByTestId('preview-band-find').click()
      await find.waitForOpen()
      await bounds.expectOnPlaceholder('with the find bar open')
      await find.closeButton().click()
      await find.waitForClosed()
      await bounds.expectOnPlaceholder('after the find bar closed')
    })

    test('should follow the placeholder when the permission band list opens and closes', async ({ bounds }) => {
      await bounds.open()
      await bounds.preview.openBand()
      await bounds.expectOnPlaceholder('with the band list open')
      await bounds.preview.chip().click()
      // Collapsing keeps the list in the DOM, hidden.
      await expect(bounds.preview.band().locator('.erf-band__list')).toBeHidden()
      await bounds.expectOnPlaceholder('with the band list closed')
    })

    test('should scale the page with the host zoom when only one window exists', async ({ bounds }) => {
      await bounds.open()
      await bounds.setHostZoomLevel(1)
      await bounds.expectOnPlaceholder('at zoom level +1')
      await bounds.setHostZoomLevel(-1)
      await bounds.expectOnPlaceholder('at zoom level -1')
    })

    test('should put the page back on its placeholder after a terminal expand and collapse', async ({ bounds }) => {
      await bounds.open()
      await bounds.terminal.toggleExpand()
      await expect(bounds.terminal.expandButton()).toHaveAttribute('aria-pressed', 'true')
      await bounds.terminal.toggleExpand()
      await expect(bounds.terminal.expandButton()).toHaveAttribute('aria-pressed', 'false')
      await bounds.expectOnPlaceholder('after the round trip')
    })
  })
})
