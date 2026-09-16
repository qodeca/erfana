// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – links can open in the same tab (#124, part 3, WI-25).
 *
 * P3-AC1 the link table with the mode on and off: a plain link follows the
 * tab's mode, while `_blank`, Cmd/Ctrl-click and middle-click always open a new
 * tab; a tab opened by a link inherits the mode, a reused tab keeps its own.
 * P3-AC2 the tab follows its page: title, tooltip, close label, top of the page
 * and `#section`, the failure badge, watcher reloads, Find, the PDF name and the
 * zoom level all belong to the new page. The history half (P3-AC3, P3-AC4) is
 * `html-preview-same-tab.history.e2e.ts`; the new-tab-mode matrix (P3-AC5) is
 * `html-preview-links.e2e.ts`. DoD-3: this spec runs on `design-set/`.
 *
 * Link clicks are REAL input events sent main-side (`clickLink`): the preload
 * only reports a trusted click, and only a gesture may move a tab.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part3.md §3.2–§3.4
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { ElectronApplication, Page } from '@playwright/test'
import { test as base, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { SearchBarPage } from './pages/search-bar.page'
import { resetHostZoom } from './pages/html-preview.frames'
import {
  clickLink,
  dismissAllToasts,
  linkModeToggle,
  moveAnnouncement,
  previewTabs,
  previewZoomLevel,
  recordSaveDialogs,
  savedDialogNames,
  scrollState,
  turnSameTabOn,
  waitForLivePages,
  waitForPage,
  zoomInPreview,
  type LinkClick
} from './pages/html-preview.navigation'

const DESIGN_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'design-set')

const INDEX = 'design-set/index.html'
const PRICING = 'design-set/pricing.html'
const ABOUT = 'design-set/about.html'
const OVERVIEW_TITLE = '-DS-OVERVIEW-'
const PRICING_TITLE = '-DS-PRICING-'
const ABOUT_TITLE = '-DS-ABOUT-'
const PAGE_MARK = "getComputedStyle(document.documentElement).getPropertyValue('--page-mark').trim()"

interface Nav {
  preview: HtmlPreviewPage
  page: Page
  app: ElectronApplication
  projectPath: string
}

/** The committed `design-set/` corpus, as `testProjectFiles`. */
function designSet(): Record<string, string> {
  const files: Record<string, string> = { 'notes.md': '# Notes\n' }
  for (const name of fs.readdirSync(DESIGN_DIR)) {
    files[`design-set/${name}`] = fs.readFileSync(path.join(DESIGN_DIR, name), 'utf-8')
  }
  return files
}

const test = base.extend<{ nav: Nav }>({
  nav: async ({ windowWithTestProject: page, appWithTestProject: app, testProject }, use) => {
    await resetHostZoom(app, page)
    await dismissAllToasts(page)
    await use({ preview: new HtmlPreviewPage(page, app), page, app, projectPath: testProject.path })
    await resetHostZoom(app, page)
  }
})

test.use({ testProjectFiles: designSet() })

const target = HtmlPreviewPage.target

/** Open the overview as a live preview and wait for its page. */
async function openOverview(h: Nav): Promise<void> {
  await h.preview.open(INDEX)
  await waitForPage(h.preview, INDEX, OVERVIEW_TITLE)
}

/** Click `id` in the preview of `from`, as a real input event. */
async function click(h: Nav, from: string, id: string, how?: LinkClick): Promise<void> {
  expect(await clickLink(h.app, id, target(from), how), `${id} in ${from}`).toBe(true)
}

/** Replace `from` with `to` in a project file; the file must hold `from`. */
async function edit(h: Nav, relPath: string, from: string | RegExp, to: string): Promise<void> {
  const file = path.join(h.projectPath, relPath)
  const text = await fsp.readFile(file, 'utf-8')
  expect(text, `${relPath} no longer holds ${String(from)}`).toMatch(from)
  await fsp.writeFile(file, text.replace(from, to), 'utf-8')
}

test.describe('HTML preview same tab – the link table (P3-AC1)', () => {
  test('should show the target in the same tab when a plain link is clicked with the mode on', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')

    await click(h, INDEX, 'to-pricing')

    await waitForPage(h.preview, PRICING, PRICING_TITLE)
    await waitForLivePages(h.app, [PRICING])
    await expect(previewTabs(h.page)).toHaveCount(1)
    await expect(linkModeToggle(h.preview, 'pricing.html')).toHaveAttribute('aria-pressed', 'true')
    // A page-started move that closed nothing says nothing (UX §6).
    await expect(moveAnnouncement(h.preview, 'pricing.html')).toHaveText('')
  })

  test('should open a plain link in a new tab when the mode is off', async ({ nav: h }) => {
    await openOverview(h)
    await expect(linkModeToggle(h.preview, 'index.html')).toHaveAttribute('aria-pressed', 'false')

    await click(h, INDEX, 'to-pricing')

    await waitForLivePages(h.app, [INDEX, PRICING])
    await expect(previewTabs(h.page)).toHaveCount(2)
  })

  const ALWAYS_NEW_TAB: Array<{ name: string; id: string; how?: LinkClick }> = [
    { name: 'a _blank link', id: 'to-pricing-blank' },
    { name: 'a Cmd/Ctrl-click', id: 'to-pricing', how: { accel: true } },
    { name: 'a middle-click', id: 'to-pricing', how: { button: 'middle' } }
  ]
  for (const row of ALWAYS_NEW_TAB) {
    test(`should open a new tab for ${row.name} even with the mode on`, async ({ nav: h }) => {
      await openOverview(h)
      await turnSameTabOn(h.preview, 'index.html')

      await click(h, INDEX, row.id, row.how)

      await waitForLivePages(h.app, [INDEX, PRICING])
      await expect(previewTabs(h.page)).toHaveCount(2)
    })
  }

  test('should give a tab opened by a link the same-tab mode of the tab it came from', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')

    await click(h, INDEX, 'to-pricing-blank')

    await waitForLivePages(h.app, [INDEX, PRICING])
    await expect(linkModeToggle(h.preview, 'pricing.html')).toHaveAttribute('aria-pressed', 'true')
  })

  test('should keep the mode of a tab that a link reuses', async ({ nav: h }) => {
    await h.preview.open(PRICING)
    await waitForPage(h.preview, PRICING, PRICING_TITLE)
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')

    await click(h, INDEX, 'to-pricing-blank')

    // The tab already showing pricing.html is reused, not a third one opened.
    await expect(h.preview.tab('pricing.html').locator('xpath=ancestor::*[contains(@class,"dv-tab")][1]')).toHaveClass(
      /dv-active-tab/,
      { timeout: PREVIEW_BUDGET_MS }
    )
    await expect(previewTabs(h.page)).toHaveCount(2)
    await waitForLivePages(h.app, [INDEX, PRICING])
    await expect(linkModeToggle(h.preview, 'pricing.html')).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('HTML preview same tab – the tab follows its page (P3-AC2)', () => {
  test('should name the new page in the tab title, tooltip, close label and panel label', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')

    await click(h, INDEX, 'to-pricing')
    await waitForPage(h.preview, PRICING, PRICING_TITLE)

    const tab = h.preview.tab('pricing.html')
    await expect(tab).toBeVisible()
    await expect(tab).toHaveAttribute('title', /^pricing\.html\n.*design-set[\\/]pricing\.html$/)
    await expect(tab.getByRole('button', { name: 'Close pricing.html', exact: true })).toBeVisible()
    await expect(h.preview.tab('index.html')).toHaveCount(0)
    await expect(h.preview.placeholder('pricing.html')).toHaveCount(1)
  })

  test('should open a new page at its top, and a link with a #section at that section', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')

    // The link sits below a tall spacer: clicking it scrolls the overview down.
    await click(h, INDEX, 'to-pricing-bottom')
    await waitForPage(h.preview, PRICING, PRICING_TITLE)
    expect(await scrollState(h.preview, target(PRICING))).toEqual({ y: 0, hash: '' })

    await click(h, PRICING, 'to-about-team')
    await waitForPage(h.preview, ABOUT, ABOUT_TITLE)
    await expect
      .poll(() => scrollState(h.preview, target(ABOUT)), { timeout: PREVIEW_BUDGET_MS })
      .toEqual({ y: expect.any(Number), hash: '#team' })
    expect((await scrollState(h.preview, target(ABOUT)))?.y).toBeGreaterThan(0)
  })

  test("should show only the new page's failures in the badge", async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')
    expect(await h.preview.failureBadgeCount()).toBe(0)

    // about.html throws a script error.
    await click(h, INDEX, 'to-about-self')
    await waitForPage(h.preview, ABOUT, ABOUT_TITLE)
    await expect.poll(() => h.preview.failureBadgeCount(), { timeout: PREVIEW_BUDGET_MS }).toBe(1)
    expect(await h.preview.failureBadgeEntries()).toContain('about-page-error')
    await h.page.keyboard.press('Escape')

    await click(h, ABOUT, 'to-contact')
    await waitForPage(h.preview, 'design-set/contact.html', '-DS-CONTACT-')
    await expect.poll(() => h.preview.failureBadgeCount(), { timeout: PREVIEW_BUDGET_MS }).toBe(0)
  })

  test("should reload for a save of the new page and never for the old page's file", async ({ nav: h }) => {
    // A page's watch set holds its subresources (stylesheets, scripts, images,
    // frames – `extractStaticLinks`), never its `<a href>` links, so once the tab
    // is on about.html a save of pricing.html is the old page's file and must not
    // reload it.
    await h.preview.open(PRICING)
    await waitForPage(h.preview, PRICING, PRICING_TITLE)
    await turnSameTabOn(h.preview, 'pricing.html')
    await click(h, PRICING, 'to-about')
    await waitForPage(h.preview, ABOUT, ABOUT_TITLE)
    expect(await h.preview.eval("(window.__e2eMarker = 'kept')", target(ABOUT))).toBe('kept')

    await edit(h, PRICING, 'Enterprise tier', 'Enterprise tier, edited')
    // Barrier: a save the new page's watchers DO act on lands in place, so the
    // old page's save has had its full chance to reload the tab.
    let round = 0
    await expect(async () => {
      round += 1
      await edit(h, 'design-set/styles.css', /--page-mark: [^;]+;/, `--page-mark: swap-${round};`)
      await expect
        .poll(() => h.preview.eval(PAGE_MARK, target(ABOUT)), { timeout: 3_000 })
        .toBe(`swap-${round}`)
    }).toPass({ timeout: PREVIEW_BUDGET_MS })
    expect(await h.preview.eval('String(window.__e2eMarker)', target(ABOUT))).toBe('kept')

    await edit(h, ABOUT, 'Four people.', 'Five people.')
    await expect
      .poll(() => h.preview.eval('document.body.textContent', target(ABOUT)), { timeout: PREVIEW_BUDGET_MS })
      .toContain('Five people.')
    expect(await h.preview.eval('String(window.__e2eMarker)', target(ABOUT))).toBe('undefined')
  })

  test('should search the new page with Find', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')
    await click(h, INDEX, 'to-pricing')
    await waitForPage(h.preview, PRICING, PRICING_TITLE)

    await h.preview.panel('pricing.html').getByTestId('preview-band-find').click()
    const find = new SearchBarPage(h.page)
    await find.waitForOpen()
    // Search a page that is on screen: the find bar insets the view, which is
    // hidden until its new bounds land.
    await expect.poll(async () => (await h.preview.viewBounds())?.visible, { timeout: PREVIEW_BUDGET_MS }).toBe(true)
    await find.search('Enterprise')
    await find.waitForTotal(1)
    // Words only the overview holds are not found on the new page.
    await find.search('kestrel')
    await expect(find.countLabel()).toHaveText('No results', { timeout: PREVIEW_BUDGET_MS })
  })

  test('should suggest the new page’s name when exporting to PDF', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')
    await click(h, INDEX, 'to-pricing')
    await waitForPage(h.preview, PRICING, PRICING_TITLE)
    await recordSaveDialogs(h.app)

    await h.preview.panel('pricing.html').getByTestId('preview-band-export-pdf').click()

    await expect.poll(() => savedDialogNames(h.app), { timeout: PREVIEW_BUDGET_MS }).toEqual(['pricing.pdf'])
  })

  test('should keep the zoom level when the tab moves to another page', async ({ nav: h }) => {
    await openOverview(h)
    await turnSameTabOn(h.preview, 'index.html')
    await zoomInPreview(h.app, target(INDEX))
    await expect.poll(() => previewZoomLevel(h.app, target(INDEX)), { timeout: PREVIEW_BUDGET_MS }).toBe(1)

    await click(h, INDEX, 'to-pricing')
    await waitForPage(h.preview, PRICING, PRICING_TITLE)

    await expect.poll(() => previewZoomLevel(h.app, target(PRICING)), { timeout: PREVIEW_BUDGET_MS }).toBe(1)
  })
})
