// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – script-built pages and frames, through the real UI
 * (docs/designs/html-preview-comments.md §12.2 E-005, E-006, E-017, E-025;
 * §19 R3-3, R3-11; decisions 5, 15, 28, 30, 35).
 *
 * - **E-005** the JS slide deck (`comments/slide-deck/`): on slide 3, scrolled
 *   down, a comment on a script-built point lands before the deck's in-file
 *   `<main>`; after the save reload the deck is on the same slide at the same
 *   scroll, with the pin on the point. On slide 1 the comment is "Not visible
 *   now" in the drawer, and back on slide 3 its pin returns (decision 30).
 * - **E-006** the frame host (`comments/iframe-host/`): a comment inside a
 *   same-project frame is written into that frame's file, never the parent's,
 *   and its pin is drawn inside the frame; a frame inside a frame works the
 *   same; a gitignored page shown in a frame is commentable (decision 35);
 *   `srcdoc`, `about:blank` and refused frames take no click – the parent's
 *   shield makes the `<iframe>` element itself the pick (R3-3); and an unsaved
 *   source tab of the frame's own file blocks Save (decision 13).
 * - **E-017** one file in two previews (its own tab, and a frame of another
 *   page): a comment written through one shows in both after their reloads.
 * - **E-025** a Vue-style server-rendered page (`comments/vue-hydrated/`): the
 *   block goes before the app's root container, the page's hydration check
 *   still passes after the reload, and the pin stays on the clicked element.
 *
 * Fixtures are committed byte-exact (`.gitattributes` `-text`). Helpers:
 * `pages/html-preview.comments-ui.ts`. Local gate only: e2e is disabled in
 * CI. Condition-based waits only.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { previewTabs } from './pages/html-preview.navigation'
import { evalInFrame } from './pages/html-preview.frames'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { runGit } from './utils/git-helpers'
import { commentLoads, newestLoad, waitForCommentLoad } from './pages/html-preview.comments'
import {
  CommentChrome,
  clickElement,
  diskBytes,
  expectPin,
  openCommentPage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  singleBlockInsert,
  waitForOverlay,
  type ElementPlace
} from './pages/html-preview.comments-ui'

const CORPUS = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'comments')
const corpus = (rel: string): string => fs.readFileSync(path.join(CORPUS, rel), 'utf-8')

const DECK = 'comments/slide-deck/index.html'
const HOST = 'comments/iframe-host/index.html'
const CHILD = 'comments/iframe-host/child.html'
const GRAND = 'comments/iframe-host/grandchild.html'
const IGNORED = 'comments/iframe-host/ignored/page.html'
const VUE = 'comments/vue-hydrated/index.html'

test.use({
  testProjectFiles: {
    [DECK]: corpus('slide-deck/index.html'),
    'comments/slide-deck/deck.js': corpus('slide-deck/deck.js'),
    [HOST]: corpus('iframe-host/index.html'),
    [CHILD]: corpus('iframe-host/child.html'),
    [GRAND]: corpus('iframe-host/grandchild.html'),
    [IGNORED]: corpus('iframe-host/ignored/page.html'),
    [VUE]: corpus('vue-hydrated/index.html'),
    '.gitignore': 'comments/iframe-host/ignored/\n',
    'notes.md': '# Notes\n'
  }
})

const NAME = 'Reviewer Frames Wd83'
const DECK_TARGET = HtmlPreviewPage.target(DECK)
const HOST_TARGET = HtmlPreviewPage.target(HOST)
const CHILD_STEP = { iframeId: 'child', frameUrlIncludes: '/iframe-host/child.html' }
const IN_CHILD: ElementPlace = { ...HOST_TARGET, frames: [CHILD_STEP] }
const IN_GRAND: ElementPlace = { ...HOST_TARGET, frames: [CHILD_STEP, { iframeId: 'grand', frameUrlIncludes: '/iframe-host/grandchild.html' }] }
const IN_IGNORED: ElementPlace = { ...HOST_TARGET, frames: [{ iframeId: 'ignored', frameUrlIncludes: '/ignored/page.html' }] }

/** Route the deck to slide `n` (its `hashchange` handler shows it) and wait until it is shown. */
async function goToSlide(preview: HtmlPreviewPage, n: number): Promise<void> {
  await preview.eval(`(location.hash = '#${n}', 'set')`, DECK_TARGET)
  await expect
    .poll(() => preview.eval('document.body.dataset.slide', DECK_TARGET), { timeout: PREVIEW_BUDGET_MS, message: `slide ${n} never showed` })
    .toBe(String(n))
}

/** A page expression's value in the deck, as a number. */
async function deckNumber(preview: HtmlPreviewPage, expr: string): Promise<number> {
  return Number(await preview.eval(`String(${expr})`, DECK_TARGET))
}

test.describe('HTML Preview comments – script-built pages and frames (P7)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('E-005 JS deck at #3: a script-built point keeps its slide and scroll after the save; slide 1 says "Not visible now"; back, the pin returns', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, DECK)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = await diskBytes(file)

    const panelId = await openCommentPage(preview, app, DECK, '-HPC-DECK-')
    await goToSlide(preview, 3)
    await chrome.modeOn(app, panelId, DECK_TARGET)
    // Comment mode reloads the page instrumented: the hash brings slide 3 back.
    await expect.poll(() => preview.eval('document.body.dataset.slide', DECK_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe('3')
    const scrolled = await deckNumber(preview, "(document.getElementById('s3-p12').scrollIntoView({ block: 'center' }), Math.round(scrollY))")
    expect(scrolled).toBeGreaterThan(200)

    await clickElement(app, 's3-p12', 'left', DECK_TARGET)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    // Built by the script: anchored to the nearest element in the file (§10.10).
    await expect(chrome.window()).toContainText('Added by a script – saved before <main')
    await chrome.saveNewComment('Deck-P7: make this point the headline', DECK)

    // The block went before the deck's in-file <main>, the one tokened ancestor.
    const inserted = singleBlockInsert(before, await diskBytes(file))
    expect(inserted, 'not exactly one block inserted').not.toBeNull()
    expect(before.subarray(inserted?.offset ?? 0).toString('utf-8').startsWith('<main id="deck">')).toBe(true)
    expect(inserted?.inserted.toString('utf-8')).toContain('built by script')

    // Same slide, same scroll, and the pin on the point (decision 28) – read
    // from the reloaded document, the one whose load carries the block.
    await waitForCommentLoad(app, DECK, 'page', 1)
    await expect.poll(() => preview.eval('location.hash', DECK_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe('#3')
    await expect.poll(() => preview.eval('document.body.dataset.slide', DECK_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe('3')
    await expect.poll(() => deckNumber(preview, 'Math.round(scrollY)'), { timeout: PREVIEW_BUDGET_MS }).toBe(scrolled)
    await expectPin(app, 's3-p12', true, DECK_TARGET)

    // Slide 1: the point is not rendered – "Not visible now", not lost (decision 30).
    await goToSlide(preview, 1)
    await chrome.openDrawer()
    const row = chrome.drawerRows().first()
    await expect(row.getByTestId('comment-drawer-tag')).toHaveText(['Not visible now'], { timeout: PREVIEW_BUDGET_MS })
    // Back on slide 3 the tag goes and the pin returns.
    await goToSlide(preview, 3)
    await deckNumber(preview, "(document.getElementById('s3-p12').scrollIntoView({ block: 'center' }), scrollY)")
    await expect(row.getByTestId('comment-drawer-tag')).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 's3-p12', true, DECK_TARGET)
  })

  test('E-006 a comment in a same-project frame is written into the frame\'s own file, the parent untouched, the pin drawn in the frame', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const hostFile = path.join(testProject.path, HOST)
    const childFile = path.join(testProject.path, CHILD)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const hostBefore = await diskBytes(hostFile)
    const childBefore = await diskBytes(childFile)

    const panelId = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await chrome.modeOn(app, panelId, HOST_TARGET)
    await waitForOverlay(preview, app, HOST_TARGET, CHILD_STEP.frameUrlIncludes)

    // Hover and right-click inside the frame: the element menu, then the window.
    await clickElement(app, 'child-note', 'right', IN_CHILD)
    await expect(chrome.menu()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-menu-add').click()
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.window()).toContainText(`p#child-note · ${CHILD}, line `)
    await expect(chrome.window()).toContainText(`Saved in ${CHILD}.`)
    await chrome.saveNewComment('Frame-P7: shorter', CHILD)

    const inserted = singleBlockInsert(childBefore, await diskBytes(childFile))
    expect(inserted, 'the frame file did not gain exactly one block').not.toBeNull()
    expect(childBefore.subarray(inserted?.offset ?? 0).toString('utf-8').startsWith('<p id="child-note">')).toBe(true)
    expect((await diskBytes(hostFile)).equals(hostBefore)).toBe(true)
    await expectPin(app, 'child-note', true, IN_CHILD)
  })

  test('E-006 a frame inside a frame: the comment goes into the innermost file', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const grandFile = path.join(testProject.path, GRAND)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = {
      host: await diskBytes(path.join(testProject.path, HOST)),
      child: await diskBytes(path.join(testProject.path, CHILD)),
      grand: await diskBytes(grandFile)
    }

    const panelId = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await chrome.modeOn(app, panelId, HOST_TARGET)
    await waitForOverlay(preview, app, HOST_TARGET, '/iframe-host/grandchild.html')
    await clickElement(app, 'grand-note', 'left', IN_GRAND)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.window()).toContainText(`p#grand-note · ${GRAND}, line `)
    await chrome.saveNewComment('Nested-P7: fine as is', GRAND)

    expect(singleBlockInsert(before.grand, await diskBytes(grandFile)), 'the innermost file did not gain one block').not.toBeNull()
    expect((await diskBytes(path.join(testProject.path, HOST))).equals(before.host)).toBe(true)
    expect((await diskBytes(path.join(testProject.path, CHILD))).equals(before.child)).toBe(true)
    await expectPin(app, 'grand-note', true, IN_GRAND)
  })

  test('E-006 a gitignored page shown in a frame is commentable (decision 35)', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const repo = testProject.path
    const ignoredFile = path.join(repo, IGNORED)
    runGit(repo, 'init', '-b', 'main')
    // The page really is ignored by git (check-ignore exits 0 and names it).
    expect(runGit(repo, 'check-ignore', IGNORED)).toBe(IGNORED)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = await diskBytes(ignoredFile)

    const panelId = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await chrome.modeOn(app, panelId, HOST_TARGET)
    await waitForOverlay(preview, app, HOST_TARGET, '/ignored/page.html')
    await clickElement(app, 'ignored-note', 'left', IN_IGNORED)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await chrome.saveNewComment('Ignored-P7: still reviewable', IGNORED)
    expect(singleBlockInsert(before, await diskBytes(ignoredFile)), 'the ignored page did not gain one block').not.toBeNull()
  })

  test('E-006 srcdoc, about:blank and refused frames take no click: the <iframe> element itself is the pick (R3-3)', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const hostBefore = await diskBytes(path.join(testProject.path, HOST))
    const panelId = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await chrome.modeOn(app, panelId, HOST_TARGET)

    // Count the clicks that reach the inline and blank frames' own documents.
    const COUNT = "(window.__hpcClicks = 0, window.addEventListener('click', () => { window.__hpcClicks += 1 }, true), 'armed')"
    for (const frame of ['about:srcdoc', 'about:blank']) {
      await expect.poll(() => evalInFrame(app, frame, COUNT, HOST_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe('armed')
    }

    for (const id of ['inline', 'blank', 'remote']) {
      await clickElement(app, id, 'left', HOST_TARGET)
      await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
      await expect(chrome.window()).toContainText(`iframe#${id} · ${HOST}, line `)
      await chrome.window().getByTestId('comment-cancel').click()
      await expect(chrome.window()).toHaveCount(0)
    }
    for (const frame of ['about:srcdoc', 'about:blank']) {
      expect(await evalInFrame(app, frame, 'String(window.__hpcClicks)', HOST_TARGET), `a click reached ${frame}`).toBe('0')
    }
    expect((await diskBytes(path.join(testProject.path, HOST))).equals(hostBefore)).toBe(true)
  })

  test('E-006 an unsaved source tab of the frame\'s own file blocks Save', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const childFile = path.join(testProject.path, CHILD)
    const banner = page.getByTestId('comment-unsaved-banner')
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    // The frame's file as source first, then the host page with comment mode on.
    await tree.expandTo(['comments', 'comments/iframe-host'])
    await tree.runContextMenuAction(tree.fileRow(CHILD), 'Open as source')
    await tabs.waitForTab('child.html')
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    await monaco.waitForReady()
    const panelId = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await chrome.modeOn(app, panelId, HOST_TARGET)

    // An edit in the source tab, then a pick in the frame – retried with a new
    // edit when autosave saved the last one first (E-008's pattern).
    let attempt = 0
    await expect(async () => {
      if ((await chrome.window().count()) > 0) await page.keyboard.press('Escape')
      await expect(chrome.window()).toHaveCount(0)
      await tabs.activate('child.html')
      await monaco.focus()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
      await page.keyboard.insertText(`<!-- E006UNSAVED${++attempt} -->`)
      await expect(tabs.dirtyDot('child.html')).toBeVisible()
      await previewTabs(page).filter({ hasText: 'index.html' }).click()
      await waitForOverlay(preview, app, HOST_TARGET, CHILD_STEP.frameUrlIncludes)
      await clickElement(app, 'child-note', 'left', IN_CHILD)
      await expect(chrome.window()).toHaveAttribute('data-view', 'new')
      await expect(banner).toBeVisible({ timeout: 1000 })
      await expect(banner).toContainText('Save your edits first')
      await page.getByTestId('comment-new-field').fill('Blocked-P7')
      await expect(page.getByTestId('comment-save')).toHaveAttribute('aria-disabled', 'true')
    }).toPass({ timeout: PREVIEW_BUDGET_MS * 2 })
    // Nothing was written into the frame's file by the window.
    expect(await fsp.readFile(childFile, 'utf-8')).not.toContain('Blocked-P7')
  })

  test('E-017 one file in two previews: a comment written through one shows in both after their reloads', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const hostChrome = new CommentChrome(page, preview, 'index.html')
    const childTarget = HtmlPreviewPage.target(CHILD)
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    // child.html in its own tab, and as a frame of the host page.
    await openCommentPage(preview, app, CHILD, '-HPC-CHILD-')
    const hostPanel = await openCommentPage(preview, app, HOST, '-HPC-FRAMES-')
    await hostChrome.modeOn(app, hostPanel, HOST_TARGET)
    await waitForOverlay(preview, app, HOST_TARGET, CHILD_STEP.frameUrlIncludes)
    await clickElement(app, 'child-note', 'left', IN_CHILD)
    await hostChrome.saveNewComment('Twice-P7: seen in both', CHILD)
    expect(await fsp.readFile(path.join(testProject.path, CHILD), 'utf-8')).toContain('Twice-P7')

    // Both previews reloaded the file and resolved the new block to an element.
    await expect
      .poll(
        async () => {
          const loads = await commentLoads(app)
          return (['page', 'frame'] as const).map(scope => {
            const load = newestLoad(loads, CHILD, scope)
            return load !== undefined && load.blocks.length === 1 && load.blocks[0].token !== undefined
          })
        },
        { timeout: PREVIEW_BUDGET_MS, message: 'not both previews of child.html carry the new block' }
      )
      .toEqual([true, true])
    await expectPin(app, 'child-note', true, IN_CHILD)
    // The other tab: its own page shows the pin too.
    await previewTabs(page).filter({ hasText: 'child.html' }).click()
    await expectPin(app, 'child-note', true, childTarget)
  })

  test('E-025 a Vue-style hydrated page: the block goes before the app root, hydration still matches, the pin stays on the clicked element', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const target = HtmlPreviewPage.target(VUE)
    const file = path.join(testProject.path, VUE)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = await diskBytes(file)

    const panelId = await openCommentPage(preview, app, VUE, '-HPC-VUE-')
    expect(await preview.eval('document.body.dataset.hydrated', target)).toBe('ok')
    await chrome.modeOn(app, panelId, target)
    await clickElement(app, 'price', 'left', target)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await chrome.saveNewComment('Vue-P7: show the old price struck through', VUE)

    const inserted = singleBlockInsert(before, await diskBytes(file))
    expect(inserted, 'not exactly one block inserted').not.toBeNull()
    // Before the app's root container, never inside the hydrated tree (R3-11).
    expect(before.subarray(inserted?.offset ?? 0).toString('utf-8').startsWith('<div id="app"')).toBe(true)
    await waitForCommentLoad(app, VUE, 'page', 1)
    await expect.poll(() => preview.eval('document.body.dataset.hydrated', target), { timeout: PREVIEW_BUDGET_MS }).toBe('ok')
    await expectPin(app, 'price', true, target)
  })
})
