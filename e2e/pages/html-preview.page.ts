// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview Page Object Model (#111).
 *
 * One home for the helpers the three preview specs used to carry as private
 * copies (`openPreview` / `previewSnapshot` / `previewEval`), which had drifted
 * on whether they called `.first()`. The drift is resolved by SCOPING rather
 * than by picking a side: a placeholder is looked up through the panel that
 * owns it (`aria-label="HTML preview of <basename>"`), so an assertion names one
 * preview whether one or four are open, and Playwright's strict mode still
 * catches a duplicate.
 *
 * The previewed page runs in a sealed native `WebContentsView` in its own web
 * contents, so nothing about it is readable from the renderer DOM. Everything
 * that reads the page goes through the main process (`app.evaluate`); those
 * reads live in `html-preview.native.ts` and the methods below delegate to
 * them. The band, the tab, the failure badge and the still frame are ordinary
 * DOM chrome and are reached with locators.
 *
 * Condition-based waits only — never a sleep.
 *
 * @see docs/html-preview/README.md
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { ProjectTreePage } from './project-tree.page'
import {
  clickInPreview,
  clickTrusted,
  evalInPreview,
  livePreviews,
  previewSnapshot,
  viewBounds,
  type LivePreview,
  type PreviewSnapshot,
  type PreviewTarget,
  type ViewBounds
} from './html-preview.native'

// Re-exported so every import path that named these before the split still works.
export type { LivePreview, PreviewSnapshot, PreviewTarget, ViewBounds }

/** Generous budget: an Electron `WebContentsView` load + native paint + IPC. */
export const PREVIEW_BUDGET_MS = 20_000

export class HtmlPreviewPage {
  constructor(
    private readonly page: Page,
    private readonly app: ElectronApplication
  ) {}

  // ---------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------

  /**
   * Open a project-relative `.html` file (`/`-separated) as a running preview
   * and wait until a live `erfana-preview://` web contents serves THAT path.
   *
   * Path-exact on purpose. The specs used to wait on `.html-preview-placeholder`
   * — one without `.first()`, two with it — and both were wrong in a different
   * way: without it, a second open preview trips strict mode; with it, the wait
   * is satisfied by whichever preview mounted first, which says nothing about
   * the file just clicked. The corpus fixtures are all called `index.html`, so
   * a basename cannot tell them apart either; the preview URL carries the
   * project-relative path and can.
   *
   * The test-project fixtures mount with the tree panel already open — do NOT
   * click the Files activity-bar button, which would toggle it shut.
   */
  async open(relPath: string): Promise<void> {
    const tree = new ProjectTreePage(this.page)
    const segments = relPath.split('/')
    if (segments.length > 1) {
      await tree.expandTo([segments[0]])
    }
    await tree.fileRow(relPath).click()
    // Actual page readiness (title sentinel, script effects) is asserted by each
    // test through `snapshot()` / `eval()`; this only waits for the view to exist.
    const urlPath = segments.map(encodeURIComponent).join('/')
    await expect
      .poll(async () => (await this.livePreviews()).some((p) => p.url.endsWith(`/${urlPath}`)), {
        timeout: PREVIEW_BUDGET_MS,
        message: `no live preview appeared for ${relPath}`
      })
      .toBe(true)
  }

  /**
   * The `PreviewTarget` addressing the preview of a project-relative path —
   * pass it to `snapshot()` / `eval()` when more than one preview is open.
   */
  static target(relPath: string): PreviewTarget {
    return { urlIncludes: `/${relPath.split('/').map(encodeURIComponent).join('/')}` }
  }

  // ---------------------------------------------------------------------------
  // Panel chrome (DOM)
  // ---------------------------------------------------------------------------

  /**
   * The placeholder the native view paints over, for the preview of `basename`.
   * Scoped by the panel's accessible label, so it is exact when several
   * previews are open and strict when two would match.
   *
   * Two spellings of that label: `HTML preview of <basename>` alone, and – while
   * the page can be entered from the keyboard (issue #124, QG-8 U1) – the same
   * words followed by ` – press Enter …`. The prefix match keeps the dash, so
   * `index.html` never matches the preview of `index.html.bak`.
   */
  placeholder(basename: string): Locator {
    const identity = `HTML preview of ${basename.replace(/"/g, '\\"')}`
    return this.page.locator(
      `.html-preview-placeholder[aria-label="${identity}"], ` +
        `.html-preview-placeholder[aria-label^="${identity} – "]`
    )
  }

  /** The panel root that owns the preview of `basename`. */
  panel(basename: string): Locator {
    return this.page.locator('.html-preview-panel', { has: this.placeholder(basename) })
  }

  /**
   * The cached still frame shown while the native view is hidden or evicted —
   * inside the panel of `basename`. Count 0 while the view is live.
   */
  stillFrame(basename: string): Locator {
    return this.panel(basename).locator('.html-preview-still-frame')
  }

  /** The dockview tab of the preview of `basename`. */
  tab(basename: string): Locator {
    return this.page.locator('.html-preview-tab', {
      has: this.page.locator('.html-preview-tab-label', { hasText: basename })
    })
  }

  /** The close control of the first preview tab. */
  tabClose(): Locator {
    return this.page.locator('.html-preview-tab-close').first()
  }

  /** The on-screen rectangle of `basename`'s placeholder, or `null`. */
  async placeholderBox(basename: string): Promise<{ width: number; height: number } | null> {
    return this.placeholder(basename).boundingBox()
  }

  // ---------------------------------------------------------------------------
  // Failure badge (DOM)
  // ---------------------------------------------------------------------------

  /** The tab's failure badge. Lives in always-DOM tab chrome, never occluded. */
  badge(): Locator {
    return this.page.locator('.html-preview-badge').first()
  }

  /**
   * The number shown on the tab's failure badge (`.html-preview-badge-count`),
   * or 0 when no badge is present.
   */
  async failureBadgeCount(): Promise<number> {
    const count = this.page.locator('.html-preview-badge-count')
    if ((await count.count()) === 0) return 0
    const text = (await count.first().textContent())?.trim() ?? ''
    const n = Number.parseInt(text, 10)
    return Number.isNaN(n) ? 0 : n
  }

  /** Open the failure-badge popover and return the text of its listed entries. */
  async failureBadgeEntries(): Promise<string> {
    await this.badge().click()
    const popover = this.page.locator('.html-preview-badge-popover')
    await popover.waitFor({ state: 'visible', timeout: 5000 })
    return (await popover.textContent()) ?? ''
  }

  // ---------------------------------------------------------------------------
  // Permission band (DOM)
  // ---------------------------------------------------------------------------

  /** The band's counts chip (`N blocked · M allowed`). */
  chip(): Locator {
    return this.page.getByTestId('preview-band-chip')
  }

  /** The band root. */
  band(): Locator {
    return this.page.locator('.erf-band')
  }

  /** Expand the band's host list by clicking the chip. */
  async openBand(): Promise<void> {
    await this.chip().click()
    await expect(this.band().locator('.erf-band__list')).toBeVisible()
  }

  /** The row naming `origin` (or a bare host) in the band's list. */
  hostRow(origin: string): Locator {
    return this.band().locator('.erf-host', { hasText: origin })
  }

  /**
   * The Allow button for `origin`. Its accessible name carries the WHOLE
   * origin — scheme, host and port — because that is what is being granted.
   */
  allowButton(origin: string): Locator {
    return this.band().getByRole('button', { name: `Allow ${origin}`, exact: true })
  }

  /** The confirm step Allow opens. Confirm answers it; Allow never does. */
  confirmDialog(): Locator {
    return this.band().getByRole('alertdialog')
  }

  confirmButton(): Locator {
    return this.confirmDialog().getByRole('button', { name: 'Confirm', exact: true })
  }

  cancelButton(): Locator {
    return this.confirmDialog().getByRole('button', { name: 'Cancel', exact: true })
  }

  /** The heading above the rows the project has already granted. */
  allowedSection(): Locator {
    return this.band().getByText('Allowed in this project', { exact: true })
  }

  // ---------------------------------------------------------------------------
  // The previewed page (main-process reads, see html-preview.native.ts)
  // ---------------------------------------------------------------------------

  /** One live preview's title and liveness, or `null` – see `previewSnapshot`. */
  async snapshot(target: PreviewTarget = {}): Promise<PreviewSnapshot | null> {
    return previewSnapshot(this.app, target)
  }

  /** Every live preview's URL and document title, read from the main process. */
  async livePreviews(): Promise<LivePreview[]> {
    return livePreviews(this.app)
  }

  /** Every live preview title, joined — for `toContain` assertions on the set. */
  async liveTitles(): Promise<string> {
    return (await this.livePreviews()).map((p) => p.docTitle).join(' | ')
  }

  /** Evaluate `expr` in a live preview page's DOM; `null` when none or mid-load. */
  async eval(expr: string, target: PreviewTarget = {}): Promise<string | null> {
    return evalInPreview(this.app, expr, target)
  }

  /**
   * Wait until a live preview's document title CONTAINS this sentinel.
   *
   * Substring, not equality: the shared corpus fixtures carry a descriptive
   * title with the sentinel embedded (`Self-contained corpus page -OK-1`).
   */
  async waitForTitled(sentinel: string): Promise<void> {
    await expect
      .poll(async () => (await this.livePreviews()).some((p) => p.docTitle.includes(sentinel)), {
        timeout: PREVIEW_BUDGET_MS,
        message: `no live preview gained the ${sentinel} sentinel`
      })
      .toBe(true)
  }

  /**
   * UNTRUSTED click (`HTMLElement.click()`) by id in the preview titled
   * `docTitle` – drives the `will-navigate` fallback. `true` only when the page
   * and the element were found. See `clickInPreview` in the native module.
   */
  async clickInPreview(docTitle: string, elementId: string): Promise<boolean> {
    return clickInPreview(this.app, docTitle, elementId)
  }

  /**
   * TRUSTED click (real input event) by id – the only way to a gesture-gated
   * path such as an external link. `true` only when the page and the element
   * were found. See `clickTrusted` in the native module.
   */
  async clickTrusted(elementId: string, target: PreviewTarget = {}): Promise<boolean> {
    return clickTrusted(this.app, elementId, target)
  }

  /**
   * The native preview view's rectangle (`x`, `y`, `width`, `height`, DIP) and
   * whether it is shown, read main-side; `null` when none is attached. A view
   * left at 0x0 runs its page and shows a black rectangle – only this sees it.
   */
  async viewBounds(): Promise<ViewBounds | null> {
    return viewBounds(this.app)
  }
}
