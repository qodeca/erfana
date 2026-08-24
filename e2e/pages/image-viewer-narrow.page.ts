// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Narrow-width vocabulary for the image viewer's toolbar (issue #73).
 *
 * Extends {@link ImageViewerPage} rather than duplicating it; it is a separate
 * file only because the base POM is close to the repo's 500-line cap, the same
 * reason `image-export.e2e.ts` has two siblings.
 *
 * **Why a panel width has to be forced.** The centre editor area declares a
 * 400 px minimum (`MIN_SIZES.centerEditor` in `AppDockLayout.tsx`), so no amount
 * of window resizing or sidebar collapsing takes a single editor group below
 * 400 px — measured, not assumed: at every window width from 900 px down to
 * 380 px the panel stays exactly 400 px and the window simply clips it. The
 * band the toolbar overflow rule exists for (~300–340 px) is only reachable by
 * splitting the editor area into side-by-side dockview groups, whose own
 * minimum is 100 px, and a dockview tab split is a native HTML5 drag that
 * Playwright cannot drive.
 *
 * So {@link constrainPanelWidth} sets an inline width on the panel root, which
 * is exactly the geometry a side-by-side split produces. Nothing about the
 * app's own layout rules is overridden: no `!important`, no injected
 * stylesheet, no test-only branch in production code. The panel then lays
 * itself out at that width with its real CSS, and the flex/scroll behaviour
 * under test is Chromium's, not a jsdom guess — which is the whole point,
 * because `ImageViewerPanel.toolbarOverflow.test.ts` can only read the
 * stylesheet as text.
 *
 * @module ImageViewerNarrowPage
 * @see docs/testing/e2e-selectors.md § Image viewer panel
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { expect, type Locator } from '@playwright/test'

import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { ImageViewerPage } from './image-viewer.page'

/** How a toolbar control is reported by {@link ImageViewerNarrowPage.controls}. */
export interface ToolbarControl {
  /** Human name, used in assertion messages. */
  name: string
  /** Panel-scoped locator. */
  locator: Locator
}

/** What the toolbar's scroll port currently measures. */
export interface ToolbarScrollMetrics {
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
}

export class ImageViewerNarrowPage extends ImageViewerPage {
  /** The toolbar row, which is also the horizontal scroll port. */
  toolbar(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_TOOLBAR}"]`)
  }

  /** The panel's zoom-out button. */
  zoomOutButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT}"]`)
  }

  /**
   * Every interactive control in the panel toolbar, in DOM (and therefore tab)
   * order.
   *
   * Eight of them, and the locked requirement is that all eight stay usable at
   * any width — so the list is stated once here and asserted against
   * `TOOLBAR_CONTROL_COUNT` by the spec, rather than being spread across tests
   * that could each quietly drop one.
   */
  controls(): ToolbarControl[] {
    return [
      { name: 'zoom out', locator: this.zoomOutButton() },
      { name: 'zoom level (reset)', locator: this.zoomLevel() },
      { name: 'zoom in', locator: this.zoomInButton() },
      { name: 'fit to view', locator: this.fitButton() },
      { name: 'export as PNG', locator: this.exportPngButton() },
      { name: 'export as PDF', locator: this.exportPdfButton() },
      { name: 'copy to clipboard', locator: this.copyButton() },
      { name: 'full screen', locator: this.fullScreenButton() }
    ]
  }

  /**
   * Give the panel the width a side-by-side dockview split would give it.
   *
   * @param width - Panel width in CSS pixels
   */
  async constrainPanelWidth(width: number): Promise<void> {
    await this.panel().evaluate((element, px) => {
      ;(element as HTMLElement).style.width = `${px}px`
    }, width)

    // Condition-based: the assertion below is about laid-out geometry, so wait
    // for the measured width rather than for the style assignment to return.
    await expect
      .poll(async () => Math.round((await this.panel().boundingBox())?.width ?? 0), {
        message: `panel never laid out at ${width}px`
      })
      .toBe(width)
  }

  /** What the toolbar's scroll port currently measures. */
  async toolbarScrollMetrics(): Promise<ToolbarScrollMetrics> {
    return this.toolbar().evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft
    }))
  }

  /**
   * How far the PANEL container has been scrolled horizontally.
   *
   * Must stay 0: the container has `overflow: hidden` and no scrollbar, so if
   * the browser scrolls it to reveal a focused control, the rest of the toolbar
   * leaves the screen with no way back.
   */
  async panelScrollLeft(): Promise<number> {
    return this.panel().evaluate((element) => element.scrollLeft)
  }

  /**
   * The `data-testid` of whatever currently has focus.
   *
   * Used to prove where Tab landed without asserting on the element's text or
   * position, neither of which is a stable contract.
   */
  async focusedTestId(): Promise<string | null> {
    return this.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
  }

  /**
   * Assert a control is inside the panel's own box, horizontally.
   *
   * This is the "not painted nowhere" check the old defect needed: a control
   * pushed past `.container`'s right edge was still in the accessibility tree
   * and still focusable, but no user could see or hit it.
   *
   * @param control - The control to measure
   */
  async expectWithinPanel(control: ToolbarControl): Promise<void> {
    const [panelBox, controlBox] = await Promise.all([
      this.panel().boundingBox(),
      control.locator.boundingBox()
    ])

    expect(panelBox, 'panel has no box').not.toBeNull()
    expect(controlBox, `${control.name} has no box`).not.toBeNull()
    if (!panelBox || !controlBox) return

    expect(
      controlBox.x,
      `${control.name} starts left of the panel (${controlBox.x} < ${panelBox.x})`
    ).toBeGreaterThanOrEqual(panelBox.x - 1)
    expect(
      controlBox.x + controlBox.width,
      `${control.name} is painted past the panel's right edge`
    ).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
  }
}
