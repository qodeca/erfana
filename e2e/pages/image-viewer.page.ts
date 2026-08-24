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

/**
 * Expando `clickExport` writes on an export button to record that it went busy.
 *
 * Namespaced because it lives on a real DOM node in the app under test; the
 * observer that sets it is armed and disconnected within one `clickExport`.
 */
const BUSY_LATCH = '__erfanaExportWentBusy'

export class ImageViewerPage {
  constructor(
    /**
     * `protected` rather than `private` so `ImageViewerNarrowPage` can extend
     * this vocabulary instead of duplicating it. The narrow-width additions
     * live in their own file only because this one is near the 500-line cap.
     */
    protected readonly page: Page,
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
   * The full-screen overlay root, rendered into `#portal-root` OUTSIDE the
   * panel.
   *
   * It carries the same test ids as the panel, which is why every locator here
   * is scoped: an unscoped `getByTestId` would match twice while full screen is
   * open.
   */
  fullScreen(): Locator {
    return byTestId(this.page, TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
  }

  /** The panel's full-screen button. */
  fullScreenButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN}"]`)
  }

  /** The full-screen overlay's close button. */
  fullScreenCloseButton(): Locator {
    return this.fullScreen().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_CLOSE}"]`)
  }

  /** The panel's Export-as-PNG button (issue #73). */
  exportPngButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG}"]`)
  }

  /** The panel's Export-as-PDF button (issue #73). */
  exportPdfButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF}"]`)
  }

  /** The panel's copy-to-clipboard button (issue #73). */
  copyButton(): Locator {
    return this.panel().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_COPY}"]`)
  }

  /** The full-screen overlay's Export-as-PNG button. */
  fullScreenExportPngButton(): Locator {
    return this.fullScreen().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG}"]`)
  }

  /** The full-screen overlay's Export-as-PDF button. */
  fullScreenExportPdfButton(): Locator {
    return this.fullScreen().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF}"]`)
  }

  /** The full-screen overlay's copy-to-clipboard button. */
  fullScreenCopyButton(): Locator {
    return this.fullScreen().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_BTN_COPY}"]`)
  }

  /**
   * The visually hidden export live region.
   *
   * Panel-owned, and rendered into whichever surface is on top - so it is
   * looked up on the PAGE, not inside the panel, and must always resolve to
   * exactly one element.
   */
  exportStatus(): Locator {
    return byTestId(this.page, TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)
  }

  /**
   * The visually hidden ASSERTIVE export live region.
   *
   * The mirror of {@link exportStatus}: failures go here (`role="alert"`), so
   * a user who is told the export failed cannot mistake silence for success.
   * Panel-owned and rendered into whichever surface is on top, so it is looked
   * up on the PAGE and must always resolve to exactly one element.
   */
  exportAlert(): Locator {
    return byTestId(this.page, TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT)
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

  // ---------------------------------------------------------------------------
  // Full screen
  // ---------------------------------------------------------------------------

  /**
   * Open the full-screen overlay and wait until it has painted an image.
   *
   * The overlay renders the same test ids into `#portal-root`, so a test that
   * asserts on the overlay must go through `fullScreen()`-scoped locators from
   * here on; the panel-scoped ones keep matching the panel behind it.
   */
  async enterFullScreen(): Promise<void> {
    await this.fullScreenButton().click()
    await expect(this.fullScreen()).toBeVisible({ timeout: this.defaultTimeout })
    await expect(
      this.fullScreen().locator(`[data-testid="${TEST_IDS.IMAGE_VIEWER_IMAGE}"]`)
    ).toBeVisible({ timeout: this.defaultTimeout })
  }

  /** Close the full-screen overlay and wait until it is gone. */
  async exitFullScreen(): Promise<void> {
    await this.fullScreenCloseButton().click()
    await expect(this.fullScreen()).toHaveCount(0, { timeout: this.defaultTimeout })
  }

  // ---------------------------------------------------------------------------
  // Export (issue #73)
  // ---------------------------------------------------------------------------

  /**
   * Click an export control and wait for the export to actually run and settle.
   *
   * Busy is `aria-disabled`, never `disabled`, so Playwright's `toBeEnabled`
   * would report the control as usable throughout an export. `aria-disabled` is
   * therefore the attribute every wait here asserts on.
   *
   * Waiting only for `'false'` after the click asserts a condition that already
   * held before it, so it returns before the request has left the renderer and
   * everything sequenced behind it races the export. The busy state has to be
   * observed on the way through — but it cannot be POLLED for: a cancelled save
   * dialog is stubbed in main and the whole round trip finishes in about a
   * millisecond, well inside one poll interval, so `toHaveAttribute('true')`
   * times out on a transition that certainly happened.
   *
   * A `MutationObserver` armed BEFORE the click records the transition instead
   * of sampling for it, which makes the wait exact rather than fast enough. It
   * latches on `oldValue === 'false'`, not on the attribute's live value: React
   * can flip the attribute twice inside one microtask checkpoint, and the
   * callback would then read the settled value and miss the run entirely.
   *
   * @param button - One of the six export locators above
   */
  async clickExport(button: Locator): Promise<void> {
    await expect(button).toHaveAttribute('aria-disabled', 'false', {
      timeout: this.defaultTimeout
    })

    await button.evaluate((element, latch) => {
      const target = element as unknown as Record<string, unknown>
      target[latch] = false
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName !== 'aria-disabled' || record.oldValue !== 'false') continue
          target[latch] = true
          observer.disconnect()
          return
        }
      })
      observer.observe(element, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['aria-disabled']
      })
    }, BUSY_LATCH)

    await button.click()

    // Started: the click reached the handler and the request left the renderer.
    await expect(button).toHaveJSProperty(BUSY_LATCH, true, { timeout: this.defaultTimeout })
    // Settled: main has answered, any toast is out and the flag has cleared.
    await expect(button).toHaveAttribute('aria-disabled', 'false', {
      timeout: this.defaultTimeout
    })
  }

  /**
   * Assert every export control reads busy, in both surfaces if full screen is
   * open.
   *
   * The two toolbar instances share ONE busy state, so a disagreement between
   * them is the defect this catches.
   */
  async expectExportBusy(timeout = this.defaultTimeout): Promise<void> {
    for (const button of [this.exportPngButton(), this.exportPdfButton(), this.copyButton()]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true', { timeout })
    }
  }

  /** Assert the export live region settles on a sentence (full screen only). */
  async expectExportAnnouncement(text: string, timeout = this.defaultTimeout): Promise<void> {
    await expect(this.exportStatus()).toHaveText(text, { timeout })
  }
}
