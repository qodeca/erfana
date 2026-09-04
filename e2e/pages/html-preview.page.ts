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
 * that reads the page goes through the main process (`app.evaluate`), finding
 * the `erfana-preview://` web contents — the same identity the app serves it
 * under. The band, the tab, the failure badge and the still frame are ordinary
 * DOM chrome and are reached with locators.
 *
 * Condition-based waits only — never a sleep.
 *
 * @see docs/html-preview/README.md
 */

import { expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { ProjectTreePage } from './project-tree.page'

/** Generous budget: an Electron `WebContentsView` load + native paint + IPC. */
export const PREVIEW_BUDGET_MS = 20_000

/** A snapshot of one live preview's own web contents, read from the main process. */
export interface PreviewSnapshot {
  /** `webContents.getTitle()` — may fall back to the URL until the doc is read. */
  title: string
  /** `document.title` read inside the page — the authoritative title sentinel. */
  docTitle: string
  /** True once the inline script has run (its `#js-output.pending` marker is gone). */
  jsRan: boolean
  url: string
  destroyed: boolean
}

/** One live preview's URL and document title. */
export interface LivePreview {
  url: string
  docTitle: string
}

/**
 * Which live preview a main-side read addresses. `urlIncludes` is matched
 * against the `erfana-preview://<token>/<project-relative path>` URL, so a
 * project-relative path such as `multi-file/index.html` picks exactly that
 * file. Omitted, the first live preview is used — fine for a spec that opens
 * one at a time.
 */
export interface PreviewTarget {
  urlIncludes?: string
}

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
   */
  placeholder(basename: string): Locator {
    return this.page.locator(
      `.html-preview-placeholder[aria-label="HTML preview of ${basename.replace(/"/g, '\\"')}"]`
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
  // The previewed page (main-process reads)
  // ---------------------------------------------------------------------------

  /**
   * Find one live preview's web contents (served under `erfana-preview://`) and
   * read its title/liveness from the main process. `null` when none is live.
   *
   * The document title is read via `executeJavaScript` (the page's own DOM), not
   * `getTitle()` — for a sealed, custom-protocol `WebContentsView`, `getTitle()`
   * can stay the URL, so it is not a reliable sentinel. Injection from the main
   * process is not subject to the page CSP, so it reads the real `document.title`.
   */
  async snapshot(target: PreviewTarget = {}): Promise<PreviewSnapshot | null> {
    return this.app.evaluate(async ({ webContents }, urlIncludes) => {
      const previews = webContents.getAllWebContents().filter((wc) => {
        try {
          const url = wc.getURL()
          return (
            url.startsWith('erfana-preview://') &&
            (urlIncludes === undefined || url.includes(urlIncludes))
          )
        } catch {
          return false
        }
      })
      if (previews.length === 0) return null
      const wc = previews[0]
      // Every read can throw "Object has been destroyed" — eviction can take
      // this view at any point, including on the synchronous `getURL()`. A
      // snapshot of a view that vanished is `null`, which the caller polls on.
      try {
        const url = wc.getURL()
        let docTitle = ''
        let jsRan = false
        try {
          docTitle = await wc.executeJavaScript('document.title')
          // The self-contained fixture drops the `pending` class on DOMContentLoaded.
          jsRan = await wc.executeJavaScript('!document.querySelector("#js-output.pending")')
        } catch {
          // Page may be mid-load / navigating — leave the defaults, the caller polls.
        }
        const destroyed = wc.isDestroyed()
        return {
          title: destroyed ? '' : wc.getTitle(),
          docTitle,
          jsRan,
          url,
          destroyed
        }
      } catch {
        return null
      }
    }, target.urlIncludes)
  }

  /** Every live preview's URL and document title, read from the main process. */
  async livePreviews(): Promise<LivePreview[]> {
    return this.app.evaluate(async ({ webContents }) => {
      const previews = webContents.getAllWebContents().filter((wc) => {
        try {
          return wc.getURL().startsWith('erfana-preview://') && !wc.isDestroyed()
        } catch {
          return false
        }
      })
      const out: Array<{ url: string; docTitle: string }> = []
      for (const wc of previews) {
        // EVERY read here can throw "Object has been destroyed": eviction runs
        // on its own schedule and can take this view between the filter above
        // and any line below, including the synchronous `getURL()` — seen once
        // in a full-suite run under load. A view that vanished mid-read is not
        // live, so skip it and let the caller poll again.
        try {
          const url = wc.getURL()
          let docTitle = ''
          try {
            docTitle = await wc.executeJavaScript('document.title')
          } catch {
            // Mid-load; the caller polls.
          }
          if (wc.isDestroyed()) continue
          out.push({ url, docTitle })
        } catch {
          continue
        }
      }
      return out
    })
  }

  /** Every live preview title, joined — for `toContain` assertions on the set. */
  async liveTitles(): Promise<string> {
    return (await this.livePreviews()).map((p) => p.docTitle).join(' | ')
  }

  /**
   * Evaluate an expression inside a live preview page's DOM (main-process
   * read). `null` when no matching preview is live or the page is mid-load.
   */
  async eval(expr: string, target: PreviewTarget = {}): Promise<string | null> {
    return this.app.evaluate(
      async ({ webContents }, { e, urlIncludes }) => {
        const wc = webContents.getAllWebContents().find((c) => {
          try {
            const url = c.getURL()
            return (
              url.startsWith('erfana-preview://') &&
              (urlIncludes === undefined || url.includes(urlIncludes))
            )
          } catch {
            return false
          }
        })
        if (!wc) return null
        try {
          return await wc.executeJavaScript(e)
        } catch {
          return null
        }
      },
      { e: expr, urlIncludes: target.urlIncludes }
    )
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
   * Click an element by id inside the live preview page whose title matches,
   * via `HTMLElement.click()` — an UNTRUSTED click (`isTrusted === false`),
   * which is precisely what the preload refuses, so this drives the
   * `will-navigate` fallback path. For a trusted click see
   * {@link clickTrusted}.
   *
   * @returns `true` only when the page WAS found and the element WAS clicked.
   *
   * The return value is the point: a renamed fixture id, or an element that
   * never rendered, must not produce a test that quietly clicks nothing.
   */
  async clickInPreview(docTitle: string, elementId: string): Promise<boolean> {
    return this.app.evaluate(
      async ({ webContents }, { title, id }) => {
        for (const wc of webContents.getAllWebContents()) {
          if (!wc.getURL().startsWith('erfana-preview://')) continue
          let found = ''
          try {
            found = await wc.executeJavaScript('document.title')
          } catch {
            // Mid-load or already gone: this is not the page we are looking for.
            // Only the IDENTIFICATION probe is allowed to fail quietly.
            continue
          }
          if (!found.includes(title)) continue
          return await wc.executeJavaScript(
            `(() => {
               const el = document.getElementById(${JSON.stringify(id)})
               if (!el) return false
               el.click()
               return true
             })()`
          )
        }
        return false
      },
      { title: docTitle, id: elementId }
    )
  }

  /**
   * Click an element by id inside a live preview page with a REAL input event
   * (`webContents.sendInputEvent`), so the page sees `isTrusted === true` and
   * the preload reports it as a gesture. This is the only way from a test to
   * reach the paths that demand a gesture — an external link, for one.
   *
   * @returns `true` only when the page and the element were found; the click
   * is dispatched at the element's centre after scrolling it into view.
   */
  async clickTrusted(elementId: string, target: PreviewTarget = {}): Promise<boolean> {
    return this.app.evaluate(
      async ({ webContents }, { id, urlIncludes }) => {
        const wc = webContents.getAllWebContents().find((c) => {
          try {
            const url = c.getURL()
            return (
              url.startsWith('erfana-preview://') &&
              (urlIncludes === undefined || url.includes(urlIncludes))
            )
          } catch {
            return false
          }
        })
        if (!wc) return false
        const point: { x: number; y: number } | null = await wc.executeJavaScript(
          `(() => {
             const el = document.getElementById(${JSON.stringify(id)})
             if (!el) return null
             el.scrollIntoView({ block: 'center', inline: 'center' })
             const r = el.getBoundingClientRect()
             return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
           })()`
        )
        if (point === null) return false
        wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
        wc.sendInputEvent({
          type: 'mouseDown',
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1
        })
        wc.sendInputEvent({
          type: 'mouseUp',
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1
        })
        return true
      },
      { id: elementId, urlIncludes: target.urlIncludes }
    )
  }

  /**
   * The on-screen rectangle of the live preview's native `WebContentsView`,
   * read from the main process. `null` when no preview view is attached.
   *
   * This is the ONE thing every other read here misses: they all read the
   * preview's web contents, which loads and runs its JavaScript whether or not
   * the view has ever been given a size. A view left at 0x0 executes its page
   * perfectly and shows the user a black rectangle.
   */
  async viewBounds(): Promise<{ width: number; height: number } | null> {
    return this.app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        for (const child of win.contentView.children) {
          const wc = (child as { webContents?: { getURL(): string } }).webContents
          try {
            if (wc && wc.getURL().startsWith('erfana-preview://')) {
              const b = child.getBounds()
              return { width: b.width, height: b.height }
            }
          } catch {
            // View mid-teardown; keep scanning.
          }
        }
      }
      return null
    })
  }
}
