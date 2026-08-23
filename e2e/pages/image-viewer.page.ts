// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image viewer panel Page Object Model.
 *
 * Encapsulates the image viewer tab: opening it from the project tree, reading
 * the currently painted bytes, the zoom controls, the permanently mounted
 * status slot and the degraded-state banner.
 *
 * All locators are scoped INSIDE `[data-testid="image-viewer-panel"]`, so the
 * full-screen portal (which renders the same test ids into `#portal-root`,
 * outside the panel) can never satisfy a panel assertion.
 *
 * Freshness is asserted through a `data-marker` attribute embedded in the SVG
 * rather than by comparing two multi-kilobyte data URLs – the decoded marker
 * makes a failure message readable and makes "which version is on screen"
 * an explicit, ordered fact.
 *
 * @module ImageViewerPage
 * @see docs/testing/e2e-selectors.md § Image viewer panel
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

/**
 * States the permanently mounted status slot can report.
 *
 * Mirrors `ViewerStatus` in `imageViewerStatus.logic.ts`. Kept as a local union
 * rather than an import so the POM stays independent of renderer internals; the
 * `data-state` attribute is the contract between them.
 */
export type ImageViewerStatusState =
  | 'idle'
  | 'reloading'
  | 'unavailable'
  | 'stale'
  | 'reload-failed-missing'
  | 'reload-failed-watch'

/** Which degradation the banner is reporting. */
export type ImageViewerBannerVariant = 'deleted' | 'unavailable' | 'stale'

export class ImageViewerPage {
  constructor(
    private readonly page: Page,
    /** Default budget for watcher-driven assertions. See `REFRESH_BUDGET_MS`. */
    private readonly defaultTimeout = 15_000
  ) {}

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** The panel root. */
  panel(): Locator {
    return byTestId(this.page, TEST_IDS.IMAGE_VIEWER_PANEL)
  }

  /** The rendered `<img>` inside the panel (never the full-screen portal copy). */
  image(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_IMAGE}"]`)
  }

  /** The permanently mounted `role="status"` slot in the toolbar. */
  statusSlot(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_STATUS}"]`)
  }

  /** The deleted / auto-refresh-unavailable banner. */
  banner(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_DELETED_BANNER}"]`)
  }

  /** The banner's single action. */
  reloadButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_RELOAD}"]`)
  }

  /** The zoom-level button (also the reset affordance). */
  zoomLevel(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL}"]`)
  }

  /** The zoom-in button. */
  zoomInButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN}"]`)
  }

  /** The fit-to-view button. */
  fitButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_FIT}"]`)
  }

  /**
   * The toolbar dimensions metadata item.
   *
   * The metadata group carries no test ids; its accessible name is the stable
   * contract (`Dimensions: 200 × 200`).
   */
  dimensions(): Locator {
    return this.panel().locator('[aria-label^="Dimensions:"]')
  }

  // ---------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------

  /**
   * Open an image by clicking its node in the project tree.
   *
   * Deliberately not `ProjectTreePage.clickFileByName`: that helper waits for
   * Monaco's `editor-content`, which an image tab never renders.
   *
   * @param fileName - Basename as shown in the tree (e.g. `icon.svg`)
   */
  async openFromTree(fileName: string): Promise<void> {
    const node = this.page
      .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
      .filter({ hasText: fileName })

    await expect(node).toBeVisible({ timeout: this.defaultTimeout })
    await node.click()
    await this.waitForReady()
  }

  /** Wait until the panel has decoded and painted an image. */
  async waitForReady(): Promise<void> {
    await expect(this.panel()).toBeVisible({ timeout: this.defaultTimeout })
    await expect(this.image()).toBeVisible({ timeout: this.defaultTimeout })
    await expect(this.image()).not.toHaveAttribute('src', '', { timeout: this.defaultTimeout })
  }

  // ---------------------------------------------------------------------------
  // Painted bytes
  // ---------------------------------------------------------------------------

  /** The raw `src` data URL currently painted. */
  async src(): Promise<string> {
    return (await this.image().getAttribute('src')) ?? ''
  }

  /**
   * The `data-marker` attribute of the SVG currently on screen.
   *
   * Decodes the `data:` URL the panel is painting, so the assertion is about
   * the bytes the user is looking at, not about a DOM attribute changing.
   *
   * @returns The marker value, or an empty string when it cannot be read
   */
  async marker(): Promise<string> {
    const src = await this.src()
    const payload = src.split(',')[1]
    if (!payload) return ''

    const decoded = Buffer.from(payload, 'base64').toString('utf-8')
    return decoded.match(/data-marker="([^"]*)"/)?.[1] ?? ''
  }

  /**
   * Wait until the painted image carries `expected` as its marker.
   *
   * Condition-based: polls the decoded bytes rather than sleeping out the
   * watcher's ~600 ms `awaitWriteFinish` + debounce floor.
   *
   * @param expected - Marker written into the file on disk
   * @param timeout - Budget; defaults to the POM's refresh budget
   */
  async waitForMarker(expected: string, timeout = this.defaultTimeout): Promise<void> {
    await expect
      .poll(async () => this.marker(), {
        timeout,
        message: `image viewer never repainted with data-marker="${expected}"`
      })
      .toBe(expected)
  }

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------

  /** Current zoom level as shown in the toolbar (e.g. `140%`). */
  async zoomText(): Promise<string> {
    return ((await this.zoomLevel().textContent()) ?? '').trim()
  }

  /**
   * Click zoom-in `times` times, waiting for the label to settle each time.
   *
   * @param times - How many zoom steps to apply
   * @returns The zoom label after the last step
   */
  async zoomIn(times: number): Promise<string> {
    for (let i = 0; i < times; i++) {
      const before = await this.zoomText()
      await this.zoomInButton().click()
      await expect(this.zoomLevel()).not.toHaveText(before, { timeout: 5000 })
    }
    return this.zoomText()
  }

  /**
   * Put the viewer into fit mode.
   *
   * Fit mode is what decides whether a later intrinsic-dimension change re-fits
   * or keeps the zoom the user chose, so tests about that rule have to state
   * which mode they are in.
   */
  async clickFit(): Promise<void> {
    await this.fitButton().click()
  }

  /** The inline `transform` style currently applied to the image. */
  async transformStyle(): Promise<string> {
    return (await this.image().getAttribute('style')) ?? ''
  }

  // ---------------------------------------------------------------------------
  // Status and banner
  // ---------------------------------------------------------------------------

  /**
   * Assert the status slot reaches a state.
   *
   * Auto-retrying, so it doubles as the wait for the transient `reloading`
   * window (1000 ms) and for its self-clearing back to `idle`.
   */
  async expectStatusState(state: ImageViewerStatusState, timeout = this.defaultTimeout): Promise<void> {
    await expect(this.statusSlot()).toHaveAttribute('data-state', state, { timeout })
  }

  /** Assert the banner is visible and reporting `variant`. */
  async expectBanner(variant: ImageViewerBannerVariant, timeout = this.defaultTimeout): Promise<void> {
    await expect(this.banner()).toBeVisible({ timeout })
    await expect(this.banner()).toHaveAttribute('data-variant', variant, { timeout })
  }

  /** Assert no banner is mounted. */
  async expectNoBanner(timeout = this.defaultTimeout): Promise<void> {
    await expect(this.banner()).toHaveCount(0, { timeout })
  }

  /** Click the banner's Reload action. */
  async clickReload(): Promise<void> {
    await expect(this.reloadButton()).toBeEnabled({ timeout: this.defaultTimeout })
    await this.reloadButton().click()
  }
}
