// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – one file, one tab, and Back/Forward (#124, part 3, WI-25).
 *
 * P3-AC3 a tab that moves to a page closes the other tabs showing it, asks
 * first when one of them is an unsaved editor, and the tree then treats the
 * moved tab as that page's tab. P3-AC4 Back and Forward: the Back button, the
 * keys with focus in the page and in the tab's toolbar, after a `#section`
 * step, across a forced sleep, a deleted page dropped from the history, and –
 * RS11 – the Back key pressed in Monaco moves neither of two previews. Also the
 * failed banner a move caused, and its way back (part 3 §3.8), and what a page
 * may do to the history on its own: a step it takes with no input behind it
 * replaces the entry it is on rather than adding one (QG-7 S1), one click buys
 * one entry, so a step the page takes right after the click's own replaces too
 * (QG-8 T1), and a
 * `pushState` to another page throws inside the preview (QG-7 S2). The link
 * table and the page state are `html-preview-same-tab.e2e.ts`. DoD-3:
 * `design-set/`.
 *
 * Made only in test setup: `extra/page-N.html` (enough previews to put a tab to
 * sleep) and `design-set/huge.html`, a page over `PREVIEW.MAX_ASSET_BYTES`:
 * eligible (the check does not read the size), refused with 413 when it loads –
 * the one way to make a move land on a failed page without racing a delete.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part3.md §3.5–§3.8
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { ElectronApplication, Page } from '@playwright/test'
import { test as base, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import {
  backButton,
  clickLink,
  dismissAllToasts,
  linkModeToggle,
  livePages,
  moveAnnouncement,
  navChord,
  pressNavKeyInPage,
  previewTabs,
  scrollState,
  toastOf,
  turnSameTabOn,
  waitForLivePages,
  waitForPage
} from './pages/html-preview.navigation'
import { PREVIEW } from '../src/shared/constants'

const DESIGN_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'design-set')

const INDEX = 'design-set/index.html'
const PRICING = 'design-set/pricing.html'
const ABOUT = 'design-set/about.html'
const CONTACT = 'design-set/contact.html'
const HUGE = 'design-set/huge.html'
const EXTRA = Array.from({ length: PREVIEW.MAX_LIVE_VIEWS }, (_, i) => `extra/page-${i + 1}.html`)

const TITLE: Record<string, string> = {
  [INDEX]: '-DS-OVERVIEW-',
  [PRICING]: '-DS-PRICING-',
  [ABOUT]: '-DS-ABOUT-',
  [CONTACT]: '-DS-CONTACT-'
}

interface Nav {
  preview: HtmlPreviewPage
  page: Page
  app: ElectronApplication
  tree: ProjectTreePage
  tabs: TabBarPage
  projectPath: string
}

/** The committed `design-set/` corpus, plus the pages made only for this spec. */
function projectFiles(): Record<string, string> {
  const files: Record<string, string> = { 'notes.md': '# Notes\n' }
  for (const name of fs.readdirSync(DESIGN_DIR)) {
    files[`design-set/${name}`] = fs.readFileSync(path.join(DESIGN_DIR, name), 'utf-8')
  }
  EXTRA.forEach((rel, i) => {
    files[rel] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Extra -EXTRA-${i + 1}-</title></head><body><p>Extra page ${i + 1}</p></body></html>\n`
  })
  return files
}

const test = base.extend<{ nav: Nav }>({
  nav: async ({ windowWithTestProject: page, appWithTestProject: app, testProject }, use) => {
    await dismissAllToasts(page)
    await use({
      preview: new HtmlPreviewPage(page, app),
      page,
      app,
      tree: new ProjectTreePage(page),
      tabs: new TabBarPage(page),
      projectPath: testProject.path
    })
  }
})

test.use({ testProjectFiles: projectFiles() })

const target = HtmlPreviewPage.target
const base_ = (rel: string): string => path.posix.basename(rel)

/** Click `id` in the preview of `from`, as a real input event. */
async function click(h: Nav, from: string, id: string): Promise<void> {
  expect(await clickLink(h.app, id, target(from)), `${id} in ${from}`).toBe(true)
}

/**
 * The fragment of the URL main's `webContents` for `relPath` last committed, or
 * `null` when no live preview shows it. Main emits `did-navigate-in-page` as it
 * commits, so once this reads a step, the navigator has recorded that step –
 * which `location.hash` inside the page cannot tell.
 */
async function committedHash(h: Nav, relPath: string): Promise<string | null> {
  return h.app.evaluate(({ webContents }, suffix) => {
    for (const wc of webContents.getAllWebContents()) {
      try {
        const url = wc.isDestroyed() ? '' : wc.getURL()
        if (url.startsWith('erfana-preview://') && decodeURIComponent(new URL(url).pathname).endsWith(suffix)) {
          return new URL(url).hash
        }
      } catch {
        // Gone mid-read: not live.
      }
    }
    return null
  }, `/${relPath}`)
}

/** Open `relPath` as a preview and wait for its page. */
async function openPage(h: Nav, relPath: string): Promise<void> {
  await h.preview.open(relPath)
  await waitForPage(h.preview, relPath, TITLE[relPath])
}

/** Open the overview in same-tab mode and move it to pricing.html: history [index, pricing]. */
async function overviewThenPricing(h: Nav): Promise<void> {
  await openPage(h, INDEX)
  await turnSameTabOn(h.preview, 'index.html')
  await click(h, INDEX, 'to-pricing')
  await waitForPage(h.preview, PRICING, TITLE[PRICING])
  await waitForLivePages(h.app, [PRICING])
}

/** Open one more live preview than the budget, so the tab showing `relPath` goes to sleep. */
async function putToSleep(h: Nav, relPath: string): Promise<void> {
  for (const [i, rel] of EXTRA.entries()) {
    await h.preview.open(rel)
    await h.preview.waitForTitled(`-EXTRA-${i + 1}-`)
  }
  await expect.poll(() => livePages(h.app), { timeout: PREVIEW_BUDGET_MS }).not.toContain(relPath)
}

/** Open `relPath` as source (tree context menu) and wait for its editor. */
async function openAsSource(h: Nav, relPath: string): Promise<MonacoPage> {
  await h.tree.expandTo([path.posix.dirname(relPath)])
  await h.tree.runContextMenuAction(h.tree.fileRow(relPath), 'Open as source')
  await h.tabs.waitForTab(base_(relPath))
  const monaco = new MonacoPage(h.page, new KeyboardHelper(h.page))
  await monaco.waitForReady()
  return monaco
}

/** An editor for pricing.html with an unsaved edit, then the overview in same-tab mode. */
async function dirtyPricingThenOverview(h: Nav): Promise<void> {
  const monaco = await openAsSource(h, PRICING)
  await monaco.focus()
  // To the end of the file (Cmd+Down in Monaco on macOS), so the text lands after </html>.
  await h.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await h.page.keyboard.type('E2EUNSAVED')
  await expect(h.tabs.dirtyDot('pricing.html')).toBeVisible()
  await openPage(h, INDEX)
  await turnSameTabOn(h.preview, 'index.html')
}

function unsavedPrompt(h: Nav): ReturnType<Page['getByRole']> {
  return h.page.getByRole('dialog', { name: 'Save changes to pricing.html?' })
}

test.describe('HTML preview same tab – one file, one tab (P3-AC3)', () => {
  test('should close the other preview and editor tabs of a page when a tab moves there', async ({ nav: h }) => {
    await openPage(h, PRICING)
    await openAsSource(h, PRICING)
    await openPage(h, INDEX)
    await turnSameTabOn(h.preview, 'index.html')
    await expect(previewTabs(h.page)).toHaveCount(2)

    await click(h, INDEX, 'to-pricing')

    await waitForPage(h.preview, PRICING, TITLE[PRICING])
    await waitForLivePages(h.app, [PRICING])
    await expect(previewTabs(h.page)).toHaveCount(1)
    await h.tabs.waitForTabGone('pricing.html')
    await expect(moveAnnouncement(h.preview, 'pricing.html')).toHaveText('Closed 2 other tabs that showed it.')
  })

  test('should ask about unsaved edits and stay on the page when the reader cancels', async ({ nav: h }) => {
    await dirtyPricingThenOverview(h)

    await click(h, INDEX, 'to-pricing')

    const prompt = unsavedPrompt(h)
    await expect(prompt).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expect(prompt.getByRole('button', { name: 'Save', exact: true })).toBeFocused()
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(prompt).toHaveCount(0)
    await expect(backButton(h.preview, 'index.html')).toBeFocused()
    await waitForLivePages(h.app, [INDEX])
    await expect(h.tabs.dirtyDot('pricing.html')).toBeVisible()
  })

  test('should save the edits, then move, when the reader picks Save', async ({ nav: h }) => {
    await dirtyPricingThenOverview(h)

    await click(h, INDEX, 'to-pricing')
    await unsavedPrompt(h).getByRole('button', { name: 'Save', exact: true }).click()

    await waitForPage(h.preview, PRICING, TITLE[PRICING])
    expect(await fsp.readFile(path.join(h.projectPath, PRICING), 'utf-8')).toContain('E2EUNSAVED')
    await expect
      .poll(() => h.preview.eval('document.body.textContent', target(PRICING)), { timeout: PREVIEW_BUDGET_MS })
      .toContain('E2EUNSAVED')
    await h.tabs.waitForTabGone('pricing.html')
    await expect(backButton(h.preview, 'pricing.html')).toBeFocused()
  })

  test('should focus the moved tab for a tree click on its page, and open a new tab for the page it left', async ({ nav: h }) => {
    await overviewThenPricing(h)

    await h.tree.fileRow(PRICING).click()
    await h.tree.fileRow(INDEX).click()

    // Had the pricing.html click opened a tab, there would be three.
    await waitForLivePages(h.app, [INDEX, PRICING])
    await expect(previewTabs(h.page)).toHaveCount(2)
  })
})

test.describe('HTML preview same tab – Back and Forward (P3-AC4)', () => {
  test('should start with Back disabled, then go back with the Back button and say so', async ({ nav: h }) => {
    await openPage(h, INDEX)
    await expect(backButton(h.preview, 'index.html')).toHaveAttribute('aria-disabled', 'true')
    await turnSameTabOn(h.preview, 'index.html')
    await click(h, INDEX, 'to-pricing')
    await waitForPage(h.preview, PRICING, TITLE[PRICING])

    const back = backButton(h.preview, 'pricing.html')
    await expect(back).not.toHaveAttribute('aria-disabled', 'true')
    await expect(back).toHaveAttribute('title', /^Back to index\.html/)
    await back.click()

    await waitForPage(h.preview, INDEX, TITLE[INDEX])
    await waitForLivePages(h.app, [INDEX])
    await expect(moveAnnouncement(h.preview, 'index.html')).toHaveText('Showing index.html.')
    await expect(backButton(h.preview, 'index.html')).toHaveAttribute('aria-disabled', 'true')
  })

  test('should go back with the Back key inside the page, then forward with the Forward key', async ({ nav: h }) => {
    await overviewThenPricing(h)

    expect(await pressNavKeyInPage(h.app, 'back', target(PRICING))).toBe(true)
    await waitForPage(h.preview, INDEX, TITLE[INDEX])
    await waitForLivePages(h.app, [INDEX])

    expect(await pressNavKeyInPage(h.app, 'forward', target(INDEX))).toBe(true)
    await waitForPage(h.preview, PRICING, TITLE[PRICING])
    await waitForLivePages(h.app, [PRICING])
  })

  test("should go back and forward with the keys while focus is in the tab's toolbar", async ({ nav: h }) => {
    await overviewThenPricing(h)

    await linkModeToggle(h.preview, 'pricing.html').focus()
    await h.page.keyboard.press(navChord('back'))
    await waitForPage(h.preview, INDEX, TITLE[INDEX])

    await linkModeToggle(h.preview, 'index.html').focus()
    await h.page.keyboard.press(navChord('forward'))
    await waitForPage(h.preview, PRICING, TITLE[PRICING])
    await waitForLivePages(h.app, [PRICING])
  })

  test('should go back from a #section jump to the top of the same page, then to the page before', async ({ nav: h }) => {
    await overviewThenPricing(h)
    expect(await h.preview.eval("(window.__e2eMarker = 'kept')", target(PRICING))).toBe('kept')

    await click(h, PRICING, 'jump-plans')
    await expect.poll(async () => (await scrollState(h.preview, target(PRICING)))?.hash, { timeout: PREVIEW_BUDGET_MS }).toBe('#plans')
    const back = backButton(h.preview, 'pricing.html')
    await expect(back).toHaveAttribute('title', /^Back to pricing\.html/)

    await back.click()
    await expect.poll(async () => (await scrollState(h.preview, target(PRICING)))?.hash, { timeout: PREVIEW_BUDGET_MS }).toBe('')
    // The same document: the page's own state survived the step.
    expect(await h.preview.eval('String(window.__e2eMarker)', target(PRICING))).toBe('kept')

    await back.click()
    await waitForPage(h.preview, INDEX, TITLE[INDEX])
  })

  test('should keep the history when the tab is put to sleep and woken', async ({ nav: h }) => {
    await overviewThenPricing(h)
    await putToSleep(h, PRICING)

    await h.preview.tab('pricing.html').click()
    await waitForPage(h.preview, PRICING, TITLE[PRICING])

    const back = backButton(h.preview, 'pricing.html')
    await expect(back).not.toHaveAttribute('aria-disabled', 'true')
    await back.click()
    await waitForPage(h.preview, INDEX, TITLE[INDEX])
  })

  test('should show the page the tab moved to as its still picture while it sleeps', async ({ nav: h }) => {
    // RS2-8: a move invalidates the still, and the next hide publishes the new page's.
    await overviewThenPricing(h)
    await putToSleep(h, PRICING)

    await expect(h.preview.stillFrame('pricing.html')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
  })

  test('should move neither of two previews for the Back key pressed in Monaco', async ({ nav: h }) => {
    // Preview 1: [index, pricing, about]. Preview 2: [contact, contact#form].
    await overviewThenPricing(h)
    await click(h, PRICING, 'to-about')
    await waitForPage(h.preview, ABOUT, TITLE[ABOUT])
    await openPage(h, CONTACT)
    await click(h, CONTACT, 'jump-form')
    await expect(backButton(h.preview, 'contact.html')).not.toHaveAttribute('aria-disabled', 'true')

    await h.tree.fileRow('notes.md').click()
    // Markdown can open rendered; the key has to land in Monaco itself.
    await h.page.getByTestId('view-mode-btn-editor').click()
    const monaco = new MonacoPage(h.page, new KeyboardHelper(h.page))
    await monaco.waitForReady()
    await monaco.setContent('    - item')
    await monaco.focus()
    await h.page.keyboard.press(navChord('back'))

    if (process.platform === 'darwin') {
      // Cmd+[ reached Monaco, which outdents the line.
      await expect.poll(() => monaco.getContent(), { timeout: PREVIEW_BUDGET_MS }).not.toMatch(/^ {4}- item/)
    }
    // Barrier: preview 1's Back lands one step back, on pricing.html – two
    // steps back (index.html) had the key moved it too.
    await h.preview.tab('about.html').click()
    await backButton(h.preview, 'about.html').click()
    await waitForPage(h.preview, PRICING, TITLE[PRICING])
    await expect(backButton(h.preview, 'pricing.html')).not.toHaveAttribute('aria-disabled', 'true')
    expect(await livePages(h.app)).toEqual([CONTACT, PRICING])
    expect((await scrollState(h.preview, target(CONTACT)))?.hash).toBe('#form')
  })

  test('should drop a deleted page from the history, say so, and stay on the page', async ({ nav: h }) => {
    await overviewThenPricing(h)
    await fsp.rm(path.join(h.projectPath, INDEX))

    await backButton(h.preview, 'pricing.html').click()

    const toast = toastOf(h.page, 'error')
    await expect(toast).toContainText('Could not show index.html', { timeout: PREVIEW_BUDGET_MS })
    await expect(toast).toContainText(
      "index.html is no longer there, so it was removed from this tab's history. This tab stayed on pricing.html."
    )
    await expect(backButton(h.preview, 'pricing.html')).toHaveAttribute('aria-disabled', 'true')
    expect(await livePages(h.app)).toEqual([PRICING])
  })

  test('should explain a move that landed on a page that could not be shown, and go back from the banner', async ({ nav: h }) => {
    const padding = 'x'.repeat(PREVIEW.MAX_ASSET_BYTES + 1024)
    await fsp.writeFile(path.join(h.projectPath, HUGE), `<!doctype html><title>-HUGE-</title><p>${padding}</p>\n`, 'utf-8')
    await openPage(h, INDEX)
    await turnSameTabOn(h.preview, 'index.html')

    await click(h, INDEX, 'to-huge')

    const banner = h.page.getByRole('alert').filter({ hasText: 'huge.html could not be shown – it may have been moved or deleted.' })
    await expect(banner).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    const backTo = banner.getByRole('button', { name: 'Back to index.html', exact: true })
    await expect(backTo).toBeFocused()

    await backTo.click()

    await waitForPage(h.preview, INDEX, TITLE[INDEX])
    await expect(backButton(h.preview, 'index.html')).toBeFocused()
    await expect(moveAnnouncement(h.preview, 'index.html')).toHaveText('Showing index.html.')
  })

  test('should record a pushState the reader clicked for as a history entry of the page', async ({ nav: h }) => {
    await openPage(h, CONTACT)
    const back = backButton(h.preview, 'contact.html')
    await expect(back).toHaveAttribute('aria-disabled', 'true')

    // A trusted click: an in-page step becomes an entry of its own only when
    // real input reached the page just before it (QG-7 S1).
    await click(h, CONTACT, 'push')

    await expect(back).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
    await back.click()
    await expect.poll(async () => (await scrollState(h.preview, target(CONTACT)))?.hash, { timeout: PREVIEW_BUDGET_MS }).toBe('')
    await expect(back).toHaveAttribute('aria-disabled', 'true')
  })

  test('should replace the entry for a step a script took with no input, so Back skips it', async ({ nav: h }) => {
    await openPage(h, CONTACT)
    const back = backButton(h.preview, 'contact.html')
    await expect(back).toHaveAttribute('aria-disabled', 'true')

    // No input has reached this page, so the step takes the entry it is on.
    expect(await h.preview.eval("(location.hash = 'scripted')", target(CONTACT))).toBe('scripted')
    // Barrier: the click's own step IS pushed, and main sees it after the scripted one.
    await click(h, CONTACT, 'jump-form')
    await expect(back).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })

    await back.click()

    await expect.poll(async () => (await scrollState(h.preview, target(CONTACT)))?.hash, { timeout: PREVIEW_BUDGET_MS }).toBe('#scripted')
    // Had the scripted step been pushed, the page's own entry would still be behind it.
    await expect(back).toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
  })

  test("should let one click buy one entry, so a script's step right after the click's own replaces it", async ({ nav: h }) => {
    await openPage(h, CONTACT)
    const back = backButton(h.preview, 'contact.html')
    await expect(back).toHaveAttribute('aria-disabled', 'true')
    // The page answers the click's own #form step with a step of its own, well
    // inside the gesture window.
    const armed = await h.preview.eval(
      "(addEventListener('hashchange', () => { location.hash = 'scripted' }, { once: true }), 'armed')",
      target(CONTACT)
    )
    expect(armed).toBe('armed')

    // The click's #form step is pushed and spends the gesture (QG-8 T1).
    await click(h, CONTACT, 'jump-form')
    await expect(back).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
    // Barrier: main committed the scripted step, so the navigator has recorded
    // it and sent the new history to the window.
    await expect.poll(() => committedHash(h, CONTACT), { timeout: PREVIEW_BUDGET_MS }).toBe('#scripted')

    // The Back key inside the page, not the button: main forwards it to the
    // window on the same channel, after that history, so the step cannot go
    // out against the generation before it and be skipped.
    expect(await pressNavKeyInPage(h.app, 'back', target(CONTACT))).toBe(true)

    // [contact, #scripted]: Back reaches the page's own entry. Had the scripted
    // step been pushed, Back would stop on #form with an entry still behind it.
    await expect.poll(async () => (await scrollState(h.preview, target(CONTACT)))?.hash, { timeout: PREVIEW_BUDGET_MS }).toBe('')
    await expect(back).toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
  })

  test('should refuse a pushState that names another page, and record nothing for it', async ({ nav: h }) => {
    // QG-7 S2: main records only the document on screen, and the sandboxed page
    // cannot rewrite its URL past the fragment and query in the first place.
    await openPage(h, CONTACT)
    const back = backButton(h.preview, 'contact.html')
    await expect(back).toHaveAttribute('aria-disabled', 'true')

    const outcome = await h.preview.eval(
      "(() => { try { history.pushState({}, '', 'other.html'); return 'no-throw' } catch (error) { return error.name } })()",
      target(CONTACT)
    )

    expect(outcome).toBe('SecurityError')
    expect(await livePages(h.app)).toEqual([CONTACT])
    await expect(back).toHaveAttribute('aria-disabled', 'true')
  })
})
