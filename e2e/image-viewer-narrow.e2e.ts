// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image viewer's toolbar at a narrow panel width (issue #73).
 *
 * The export group pushed the toolbar's non-shrinkable width from ~335 px to
 * ~380 px. The fix was a layout one: all three button clusters became
 * `flex-shrink: 0`, the status slot gave up its 140 px floor, and the row became
 * a horizontal scroll port so nothing is ever clipped — "three export buttons,
 * always visible and clickable" is a locked requirement, so the row may not
 * hide, collapse or drop anything.
 *
 * Until now that was pinned ONLY as stylesheet text
 * (`ImageViewerPanel.toolbarOverflow.test.ts`), because jsdom performs no
 * layout and reports every width as 0. A stylesheet assertion cannot tell you
 * whether a real Chromium puts the eighth control somewhere a user can hit. So
 * these two tests measure the laid-out row instead:
 *
 * - every one of the eight controls is present, inside the panel's own box, and
 *   passes Playwright's actionability check (visible, stable, hit-testable —
 *   i.e. neither clipped nor obscured);
 * - reaching the rightmost control with Tab SCROLLS it into view, rather than
 *   leaving focus on something painted off the edge, which is the WCAG 2.2
 *   SC 2.4.11 failure the old row had.
 *
 * A screenshot of the same state is `(f) image viewer toolbar – narrow panel`
 * in `visual-regression.e2e.ts`; these assertions are the half that does not
 * depend on a baseline.
 *
 * How the narrow width is reached — and why it has to be forced — is documented
 * on `ImageViewerNarrowPage.constrainPanelWidth`.
 *
 * Convention: condition-based waits only. No sleeps.
 *
 * @see e2e/pages/image-viewer-narrow.page.ts
 * @see src/renderer/src/components/Panels/ImageViewerPanel/ImageViewerPanel.toolbarOverflow.test.ts
 */

import { expect } from './fixtures/index'
import { EXPORT_BUDGET_MS, imageExportTest as test } from './utils/image-export-helpers'
import { IMAGE_FIXTURES } from './fixtures/images/generateImageFixtures'
import { ImageViewerNarrowPage } from './pages/image-viewer-narrow.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

// Seed one text file so the tree is never empty for a reason unrelated to
// images; the images themselves are seeded by `imageExportTest`'s
// `testProject` override (see `e2e/utils/image-export-helpers.ts`).
test.use({ testProjectFiles: { 'notes.md': '# Notes\n' } })

/**
 * Panel width to test at.
 *
 * Inside the 300–340 px band where the pre-fix row lost its last controls off
 * the right edge, and comfortably under the ~380 px the eight controls need.
 */
const NARROW_PANEL_WIDTH = 300

/** Controls the locked requirement says must survive any width. */
const TOOLBAR_CONTROL_COUNT = 8

/**
 * Open the seeded PNG and squeeze the panel into the narrow band.
 *
 * @param page - The app window
 * @returns The narrow-width POM, with the panel already laid out
 */
async function openNarrowViewer(
  page: import('@playwright/test').Page
): Promise<ImageViewerNarrowPage> {
  const viewer = new ImageViewerNarrowPage(page, EXPORT_BUDGET_MS)
  await viewer.openFromTree(IMAGE_FIXTURES.png.fileName)
  await viewer.constrainPanelWidth(NARROW_PANEL_WIDTH)
  return viewer
}

test.describe('image viewer toolbar – narrow panel', () => {
  test('should keep all eight controls hit-testable when the panel is 300 px wide', async ({
    windowWithTestProject
  }) => {
    const viewer = await openNarrowViewer(windowWithTestProject)
    const controls = viewer.controls()

    expect(controls, 'the toolbar control list drifted from the locked eight').toHaveLength(
      TOOLBAR_CONTROL_COUNT
    )

    // Guard against a vacuous pass: if the row FITS at this width, everything
    // below is trivially true and proves nothing about the overflow rule.
    const metrics = await viewer.toolbarScrollMetrics()
    expect(
      metrics.scrollWidth,
      `the row fits at ${NARROW_PANEL_WIDTH}px (content ${metrics.scrollWidth}px), so this ` +
        'test no longer exercises the narrow case — narrow the panel further'
    ).toBeGreaterThan(metrics.clientWidth)

    for (const control of controls) {
      await expect(control.locator, `${control.name} is missing`).toHaveCount(1)
      await expect(control.locator, `${control.name} is not visible`).toBeVisible()

      // `hover()` runs the same actionability checks a click does, minus the
      // enabled check: the element must be visible, stable, and hit-testable at
      // its own centre point. A control clipped by an overflow:hidden ancestor
      // that cannot scroll fails this — which is exactly the defect the layout
      // change removed. A real click is deliberately not used: three of the
      // eight would open a save dialog or the full-screen overlay, and those
      // actions are covered per format elsewhere.
      await control.locator.hover()

      // Hover scrolls the row before hit-testing, so the box is read afterwards:
      // the assertion is "the row CAN bring this control into its own box",
      // not "it happens to start there".
      await viewer.expectWithinPanel(control)
    }
  })

  test('should scroll the rightmost control into view when Tab reaches it', async ({
    windowWithTestProject
  }) => {
    const viewer = await openNarrowViewer(windowWithTestProject)

    // Precondition, asserted rather than assumed: at rest the last control is
    // painted past the panel's right edge. Without this, "Tab scrolled it into
    // view" could be satisfied by a row that never needed scrolling.
    const [panelBox, restingBox] = await Promise.all([
      viewer.panel().boundingBox(),
      viewer.fullScreenButton().boundingBox()
    ])
    expect(panelBox).not.toBeNull()
    expect(restingBox).not.toBeNull()
    expect(
      (restingBox?.x ?? 0) + (restingBox?.width ?? 0),
      'the last control already sits inside the panel at rest — the narrow case is not reproduced'
    ).toBeGreaterThan((panelBox?.x ?? 0) + (panelBox?.width ?? 0))

    // Tab from its neighbour, so this is the browser's own focus order doing
    // the scrolling, not a programmatic `scrollIntoView` the test performed.
    await viewer.copyButton().focus()
    const before = (await viewer.toolbarScrollMetrics()).scrollLeft

    await windowWithTestProject.keyboard.press('Tab')

    await expect
      .poll(async () => viewer.focusedTestId(), {
        message: 'Tab did not land on the full-screen button'
      })
      .toBe(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN)

    await expect
      .poll(async () => (await viewer.toolbarScrollMetrics()).scrollLeft, {
        message: 'focusing the last control did not scroll the toolbar'
      })
      .toBeGreaterThan(before)

    // ...and it is the TOOLBAR that scrolled, not the panel container. This is
    // the precise pre-fix failure, measured: with no scroll port on the row,
    // Chromium satisfies "scroll the focused element into view" by scrolling
    // `.container` instead — which has `overflow: hidden`, no scrollbar and no
    // way back, so the rest of the toolbar simply leaves the screen. Verified
    // by emulating the old rules with an injected stylesheet: the toolbar's
    // scrollLeft stayed 0 while the container's went to 206.
    expect(
      await viewer.panelScrollLeft(),
      'the panel container scrolled instead of the toolbar — the row is not the scroll port'
    ).toBe(0)

    // The point of the scroll: the focused control is now somewhere a sighted
    // keyboard user can actually see it.
    await viewer.expectWithinPanel({
      name: 'full screen',
      locator: viewer.fullScreenButton()
    })
  })
})
