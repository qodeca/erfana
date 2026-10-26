// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the reviewer's path through the real UI
 * (docs/designs/html-preview-comments.md §13 P6 "e2e exit", §10.3, §10.4,
 * §10.7, §12.2 E-001).
 *
 * Real Chromium, real preload, real main, real renderer: no stub and no
 * bridge calls standing in for a control. The test does what a reviewer does
 * – turns comment mode on in the toolbar, hovers an element and right-clicks
 * it, chooses "Add comment", answers the first-comment identity step (the
 * identity starts unset), types and saves – then checks the two outcomes that
 * matter: the pin is drawn on the element, and the file on disk is the file
 * before with exactly one comment block inserted, right before the element.
 *
 * The right-click is a trusted input event into the native view
 * (`rightClickAt`), because Playwright's own mouse cannot reach a
 * `WebContentsView`; everything after it is Erfana's DOM and is driven with
 * Playwright locators.
 *
 * E-018 is the guaranteed keyboard route (§10.8) on a page that already holds
 * comments, and focus in and out of the drawer and the window: the list
 * button, the drawer's one-stop filter, checkbox and list (arrows, Home), a
 * row's Open into the window, and the Esc order inside it – Esc first backs
 * out of an open edit (keeping its text), and only then closes the window,
 * focus going back to the row's Open. (Written in P6 as "E-002"; renamed to
 * the plan id it covers.)
 *
 * E-008 is the unsaved-source guard (decision 13): with the page's file open
 * "as source" and edited, the new-comment window blocks Save behind the
 * warning banner; "Save {file}" writes the tab and the banner turns into
 * "Saved. You can add your comment now."; "Go to tab" closes the window and
 * leaves focus in the editor. Autosave writes 2 s after the last keystroke,
 * so each dirty-then-open step is retried with a fresh edit when autosave
 * got there first (the pattern of html-preview-same-tab.history.e2e.ts).
 * (Written in P6 as "E-003"; renamed to the plan id it covers.)
 *
 * P7 adds the rest of the reviewer's journeys (§12.2): E-001b (a left-click
 * opens the window directly), E-002 (a pin outside comment mode: reply,
 * resolve, re-open), E-003 (edit, then delete: the bytes come back), E-004
 * (the whole cycle on a CRLF + BOM file, generated here as bytes), E-007
 * (clicks swallowed, Alt+↑/↓, Esc), E-014 (the pins toggle), E-016 (the
 * keyboard-only path), E-021 (Settings changes the author of new comments
 * only) and E-024 (`git diff` after add, edit and delete on a line-start
 * target). Helpers: `pages/html-preview.comments-ui.ts`.
 *
 * Every test that sets the identity puts the worker home's comment settings
 * back in `afterEach`, so E-001 always starts with the identity unset.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { runGit } from './utils/git-helpers'
import {
  CommentChrome,
  clickElement,
  clickPin,
  diskBytes,
  expectPin,
  globalSetting,
  openCommentPage,
  pressInPage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  singleBlockInsert,
  waitForOverlay
} from './pages/html-preview.comments-ui'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { dismissAllToasts, previewTabs } from './pages/html-preview.navigation'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { commentedPage } from '../src/main/services/preview/comments/__test-helpers__/commentedPages'
import {
  OVERLAY_HOSTS_EXPR,
  accentPixelsNear,
  commentPanels,
  commentPanelState,
  insertedStretch,
  rightClickAt,
  waitForCommentLoad,
  waitForCommentPanel
} from './pages/html-preview.comments'

const PAGE = 'comments/e001.html'
const TITLE = '-HPC-E001-'
/** Two open comments and one resolved, written by the real serializer. */
const REVIEW = 'comments/e002.html'
const REVIEW_TITLE = '-HPC-P3-'
const REVIEWED = commentedPage()
const NAME = 'Reviewer E001 Kq4Tz'
const NOTE = 'Note-E001-Wm93: make this paragraph shorter'

/** A small page: the element the reviewer comments on, with neighbours above and below it. */
const PAGE_TEXT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  `  <title>${TITLE}</title>`,
  '  <style>body { font: 16px/1.5 sans-serif; margin: 40px; } p { padding: 12px; }</style>',
  '</head>',
  '<body>',
  '  <h1 id="heading">Pricing</h1>',
  '  <p id="intro">Three plans, billed monthly.</p>',
  '  <p id="target">Every plan includes unlimited previews, comments and exports.</p>',
  '  <p id="after">Prices exclude VAT.</p>',
  '</body>',
  '</html>',
  ''
].join('\n')

/** The committed static design page (`e2e/fixtures/html-preview-corpus/comments/static-design/`). */
const STATIC = 'comments/static-design/index.html'
const STATIC_TITLE = '-HPC-STATIC-'
const STATIC_TEXT = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'html-preview-corpus', 'comments', 'static-design', 'index.html'),
  'utf-8'
)
/** The CRLF + BOM page E-004 writes as bytes at test time (never committed). */
const CRLF = 'comments/crlf-bom.html'
const CRLF_TITLE = '-HPC-CRLF-'

test.use({
  testProjectFiles: {
    [PAGE]: PAGE_TEXT,
    [REVIEW]: REVIEWED.text,
    [STATIC]: STATIC_TEXT,
    'notes.md': '# Notes\n'
  }
})

/** The static page's preview target. */
const STATIC_TARGET = HtmlPreviewPage.target(STATIC)

/**
 * Open the page and wait for its title and its comment panel. A page with no
 * comments yet is served raw until comment mode is on (main then reloads it
 * instrumented), so this waits for the panel only – not for a commentable
 * frame.
 */
async function openPage(
  preview: HtmlPreviewPage,
  app: ElectronApplication,
  relPath = PAGE,
  title = TITLE
): Promise<string> {
  await preview.open(relPath)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(relPath)))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: `${relPath} never showed its ${title} title`
      })
      .toBe(title)
  )
  let panelId: string | undefined
  await expect
    .poll(
      async () => {
        const panels = await commentPanels(app)
        panelId = panels.length === 1 ? panels[0].panelId : undefined
        return panelId !== undefined
      },
      { timeout: PREVIEW_BUDGET_MS, message: `no comment panel for ${relPath}` }
    )
    .toBe(true)
  return panelId as string
}

/** Comment mode on with the toolbar button, and the overlay up in the page. */
async function turnOnCommentMode(
  preview: HtmlPreviewPage,
  page: Page,
  app: ElectronApplication,
  panelId: string
): Promise<void> {
  const modeButton = page.getByTestId('preview-band-comment-mode')
  // Usable once the page has loaded (R-010).
  await expect(modeButton).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
  await expect(modeButton).toHaveAttribute('aria-pressed', 'false')
  await modeButton.click()
  await expect(modeButton).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
  await expect
    .poll(async () => (await commentPanelState(app, panelId))?.mode, {
      timeout: PREVIEW_BUDGET_MS,
      message: 'main never turned comment mode on'
    })
    .toBe(true)
  // Main reloads the page instrumented; it says hello as a commentable frame.
  expect((await waitForCommentPanel(app)).panelId).toBe(panelId)
  await preview.withReadError(
    expect
      .poll(() => preview.eval(OVERLAY_HOSTS_EXPR, HtmlPreviewPage.target(PAGE)), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the overlay never came up in comment mode'
      })
      .toBe('[true]')
  )
}

test.describe('HTML Preview comments – the reviewer path (P6 exit)', () => {
  // The worker's home outlives the app: identity unset and the feature on
  // again, so the next test (E-001 above all) starts from the defaults.
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('E-001 hover → right-click → Add comment → identity step → Save → pin visible; one block before the target on disk', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const file = path.join(testProject.path, PAGE)
    const before = await fsp.readFile(file, 'utf-8')

    const panelId = await openPage(preview, app)
    await turnOnCommentMode(preview, page, app, panelId)

    // Hover, then right-click the paragraph: Erfana's element menu opens with
    // exactly one item (R-001).
    const target = HtmlPreviewPage.target(PAGE)
    expect(await rightClickAt(app, 'target', target), '#target not found').toBe(true)
    const menu = page.getByTestId('comment-context-menu')
    await expect(menu).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expect(menu.getByRole('menuitem')).toHaveCount(1)
    await menu.getByTestId('comment-menu-add').click()

    // The identity is unset, so the first comment asks for a name first,
    // with the visibility notice (R-008).
    const commentWindow = page.getByTestId('comment-window')
    await expect(commentWindow).toHaveAttribute('data-view', 'identity', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByRole('dialog', { name: 'Before your first comment' })).toBeVisible()
    await page.getByTestId('comment-identity-name').fill(NAME)
    await page.getByTestId('comment-identity-continue').click()

    // Then the comment itself, about the element that was picked.
    await expect(commentWindow).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(commentWindow).toContainText(`p#target · ${PAGE}, line 11`)
    const field = page.getByTestId('comment-new-field')
    await expect(field).toBeFocused()
    await field.fill(NOTE)
    await page.getByTestId('comment-save').click()

    // Saved: the window closes and the polite region says where it went.
    await expect(commentWindow).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-announce')).toHaveText(`Comment saved to ${PAGE}.`, {
      timeout: PREVIEW_BUDGET_MS
    })

    // The pin is drawn on the element once the page has reloaded with the block.
    await waitForCommentLoad(app, PAGE, 'page', 1)
    await expect
      .poll(() => accentPixelsNear(app, 'target', target), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'no pin drawn at #target'
      })
      .toBeGreaterThanOrEqual(40)
    // Comment mode survived the save reload (R-023).
    await expect(page.getByTestId('preview-band-comment-mode')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('preview-band-comments')).toHaveAccessibleName('Comments, 1 open', {
      timeout: PREVIEW_BUDGET_MS
    })

    // On disk: the file before, with exactly one stretch inserted – one
    // comment block, by the name given, holding the note – right before the
    // target element and nowhere else.
    const after = await fsp.readFile(file, 'utf-8')
    const diff = insertedStretch(before, after)
    expect(diff, 'the write changed more than one place in the file').not.toBeNull()
    if (diff === null) return
    expect(diff.inserted.split('erfana:comment').length - 1).toBe(1)
    expect(diff.inserted).toContain(NOTE)
    expect(diff.inserted).toContain(NAME)
    expect(diff.inserted.trim().startsWith('<!--')).toBe(true)
    expect(diff.inserted.trim().endsWith('-->')).toBe(true)
    expect(diff.tail.trimStart().startsWith('<p id="target">')).toBe(true)
    expect(diff.head.trimEnd().endsWith('<p id="intro">Three plans, billed monthly.</p>')).toBe(true)
  })

  test('E-018 keyboard route and focus: list button → drawer filter, checkbox, rows → Open → Esc backs out of an edit, then closes', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const file = path.join(testProject.path, REVIEW)
    const before = await fsp.readFile(file, 'utf-8')
    await openPage(preview, app, REVIEW, REVIEW_TITLE)

    // The list button names what is there, and opens the drawer from the keyboard.
    const listButton = page.getByTestId('preview-band-comments')
    await expect(listButton).toHaveAccessibleName('Comments, 2 open', { timeout: PREVIEW_BUDGET_MS })
    await listButton.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByTestId('comment-drawer')
    await expect(drawer).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-drawer-close')).toBeFocused()

    // The filter is ONE Tab stop; arrows move the selection.
    await page.keyboard.press('Tab')
    const openFilter = page.getByTestId('comment-filter-open')
    const resolvedFilter = page.getByTestId('comment-filter-resolved')
    await expect(openFilter).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(resolvedFilter).toBeFocused()
    await expect(resolvedFilter).toHaveAttribute('aria-checked', 'true')
    await expect(drawer.getByTestId('comment-drawer-row')).toHaveCount(1)
    await page.keyboard.press('ArrowLeft')
    await expect(openFilter).toBeFocused()
    await expect(drawer.getByTestId('comment-drawer-row')).toHaveCount(2)

    // Then the checkbox, then the list ONCE: arrows and Home move in it.
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('comment-drawer-show-icons')).toBeFocused()
    await page.keyboard.press('Tab')
    const mains = drawer.getByTestId('comment-drawer-row-main')
    await expect(mains.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(mains.nth(1)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(mains.nth(0)).toBeFocused()
    // (Enter on a row – "Show on page" – is left to the unit tests: whether it
    // keeps the drawer depends on the panel's width, under 640px it closes it.)

    // Tab once more reaches the row's Open: the comment window, title focused.
    await page.keyboard.press('Tab')
    const openRow = drawer.getByTestId('comment-drawer-row-open').nth(0)
    await expect(openRow).toBeFocused()
    await page.keyboard.press('Enter')
    const commentWindow = page.getByTestId('comment-window')
    await expect(commentWindow).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-window-title')).toBeFocused()

    // Edit from the message's … menu, all by keyboard.
    const actions = commentWindow.getByTestId('comment-message-actions').first()
    const startEdit = async (): Promise<void> => {
      await actions.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused()
      await page.keyboard.press('Enter')
    }
    await startEdit()
    const edit = commentWindow.getByTestId('comment-edit-field')
    await expect(edit).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' – kept')

    // Esc #1 backs out of the edit only: the window stays, focus on the … button.
    await page.keyboard.press('Escape')
    await expect(edit).toHaveCount(0)
    await expect(commentWindow).toBeVisible()
    await expect(actions).toBeFocused()
    // The text Esc left comes back with the next Edit.
    await startEdit()
    await expect(edit).toHaveValue(/ – kept$/)
    await page.keyboard.press('Escape')
    await expect(edit).toHaveCount(0)

    // Esc #2 closes the window; focus returns to the row's Open that opened it.
    await page.keyboard.press('Escape')
    await expect(commentWindow).toHaveCount(0)
    await expect(openRow).toBeFocused()

    // Nothing was saved: the file is as it was.
    expect(await fsp.readFile(file, 'utf-8')).toBe(before)
  })

  test('E-008 an unsaved source tab blocks Save; Save {file} clears it; Go to tab leaves for the editor', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const file = path.join(testProject.path, PAGE)
    const target = HtmlPreviewPage.target(PAGE)
    const commentWindow = page.getByTestId('comment-window')
    const banner = page.getByTestId('comment-unsaved-banner')
    await dismissAllToasts(page)

    // The page's file as source first, then its preview with comment mode on.
    await tree.expandTo([path.posix.dirname(PAGE)])
    await tree.runContextMenuAction(tree.fileRow(PAGE), 'Open as source')
    await tabs.waitForTab('e001.html')
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    await monaco.waitForReady()
    const panelId = await openPage(preview, app)
    await turnOnCommentMode(preview, page, app, panelId)

    let attempt = 0
    let marker = ''
    /**
     * An unsaved edit in the source tab, then the new-comment window on
     * #target with its unsaved banner up – and `then` run while the edit is
     * still unsaved. Retried with a new edit when autosave saved it first.
     */
    const dirtyWindow = async (then: () => Promise<void>): Promise<void> => {
      await expect(async () => {
        if ((await commentWindow.count()) > 0) await page.keyboard.press('Escape')
        await expect(commentWindow).toHaveCount(0)
        marker = `E003UNSAVED${++attempt}`
        await tabs.activate('e001.html')
        await monaco.focus()
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
        // `insertText`: Monaco drops single keystrokes during re-layout (monaco.page.ts).
        await page.keyboard.insertText(`<!-- ${marker} -->`)
        await expect(tabs.dirtyDot('e001.html')).toBeVisible()
        await previewTabs(page).filter({ hasText: 'e001.html' }).click()
        await expect
          .poll(() => rightClickAt(app, 'target', target), { timeout: PREVIEW_BUDGET_MS })
          .toBe(true)
        await page.getByTestId('comment-menu-add').click()
        // The identity is unset on the first comment only.
        await expect(commentWindow).toHaveAttribute('data-view', /identity|new/)
        if ((await commentWindow.getAttribute('data-view')) === 'identity') {
          await page.getByTestId('comment-identity-name').fill(NAME)
          await page.getByTestId('comment-identity-continue').click()
        }
        await expect(commentWindow).toHaveAttribute('data-view', 'new')
        await expect(banner).toBeVisible({ timeout: 1000 })
        await then()
      }).toPass({ timeout: PREVIEW_BUDGET_MS })
    }

    // Save is blocked behind the banner; "Save e001.html" writes the source tab.
    await dirtyWindow(async () => {
      await expect(banner).toContainText('Save your edits first')
      await page.getByTestId('comment-new-field').fill(NOTE)
      await expect(page.getByTestId('comment-save')).toHaveAttribute('aria-disabled', 'true')
      await page.getByTestId('comment-unsaved-save').click({ timeout: 1000 })
    })
    const cleared = page.getByTestId('comment-unsaved-cleared')
    await expect(cleared).toHaveText('Saved. You can add your comment now.', { timeout: PREVIEW_BUDGET_MS })
    // Said out loud from inside the window, too (H1).
    await expect(page.getByTestId('comment-window-alert')).toHaveText(
      'Saved. You can add your comment now.'
    )
    await expect(tabs.dirtyDot('e001.html')).toHaveCount(0)
    expect(await fsp.readFile(file, 'utf-8')).toContain(marker)
    await page.getByTestId('comment-cancel').click()
    await expect(commentWindow).toHaveCount(0)

    // "Go to tab" closes the window and leaves focus in the source editor (H2).
    await dirtyWindow(async () => {
      await page.getByTestId('comment-unsaved-go-to-tab').click({ timeout: 1000 })
    })
    await expect(commentWindow).toHaveCount(0)
    await tabs.expectActive('e001.html')
    // Monaco's own focus class: its input is an EditContext element, not a textarea.
    await expect(monaco.getEditor().locator('.monaco-editor')).toHaveClass(/\bfocused\b/)
  })
})

/** The text the oracle finds in an inserted block. */
function insertedText(before: Buffer, after: Buffer): { text: string; tail: string } {
  const found = singleBlockInsert(before, after)
  expect(found, 'the write was not exactly one comment block inserted').not.toBeNull()
  if (found === null) throw new Error('unreachable')
  return { text: found.inserted.toString('utf-8'), tail: before.subarray(found.offset).toString('utf-8') }
}

/** Every changed line of `git diff -U0` for one file, as `+…` / `-…`. */
function changedLines(repo: string, file: string): string[] {
  return runGit(repo, 'diff', '-U0', '--no-color', '--', file)
    .split(/\r?\n/)
    .filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
}

test.describe('HTML Preview comments – the reviewer journeys (P7)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  const NAME_A = 'Reviewer P7 Jx4Lr'
  const NOTE_A = 'Note-P7-Hq28: tighten this copy'

  test('E-001b a left-click in comment mode opens the comment window directly – no menu – and Save draws the pin', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))
    const before = await diskBytes(file)

    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'team-copy', 'left', STATIC_TARGET)

    // Decision 19: the window, straight away; the element menu never opened.
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.menu()).toHaveCount(0)
    await expect(chrome.window()).toContainText(`p#team-copy · ${STATIC}, line `)
    await chrome.saveNewComment(NOTE_A, STATIC)
    await expectPin(app, 'team-copy', true, STATIC_TARGET)

    const { text, tail } = insertedText(before, await diskBytes(file))
    expect(text).toContain(NOTE_A)
    expect(text).toContain(NAME_A)
    expect(tail.startsWith('<p id="team-copy">')).toBe(true)
  })

  test('E-002 a pin opens its thread outside comment mode; reply, resolve (pin hidden, drawer "Resolved"), re-open', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'e002.html')
    const target = HtmlPreviewPage.target(REVIEW)
    const file = path.join(testProject.path, REVIEW)
    const REPLY = 'Reply-P7-Tn51: agreed, and make it bigger'
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))

    await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    // Comment mode is off; pins are drawn anyway (decision 20). The resolved
    // thread on #title has none.
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'false', { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'cta', true, target)
    await expectPin(app, 'title', false, target)

    await clickPin(app, 'cta', target)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-message')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })

    // Reply.
    await page.getByTestId('comment-reply-field').fill(REPLY)
    await page.getByTestId('comment-reply').click()
    await expect(win.getByTestId('comment-message')).toHaveCount(2, { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-message-text').nth(1)).toHaveText(REPLY)
    expect(await fsp.readFile(file, 'utf-8')).toContain(REPLY)

    // Resolve: the thread folds, focus moves to Re-open, and the pin goes.
    await page.getByTestId('comment-resolve').click()
    await expect(win.getByTestId('comment-resolved-thread')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.announce()).toHaveText('Comment resolved.', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-reopen')).toBeFocused()
    await page.getByTestId('comment-close').click()
    await expect(win).toHaveCount(0)
    await expectPin(app, 'cta', false, target)

    // The drawer lists it under Resolved.
    await chrome.openDrawer()
    await chrome.filter('resolved').click()
    const resolvedRow = chrome.drawerRows().filter({ has: page.getByRole('button', { name: 'button#cta.btn', exact: true }) })
    await expect(resolvedRow).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.filter('resolved')).toContainText('Resolved 2')

    // Re-open from the drawer: the pin comes back and the thread is open again.
    await resolvedRow.getByTestId('comment-drawer-row-open').click()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-reopen').click()
    await expect(chrome.announce()).toHaveText('Comment re-opened.', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-reply-field')).toBeFocused({ timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-close').click()
    await expect(win).toHaveCount(0)
    await expect(chrome.filter('resolved')).toContainText('Resolved 1', { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.filter('open')).toContainText('Open 2')
    await expectPin(app, 'cta', true, target)
  })

  test('E-003 edit, then delete: the file comes back byte for byte', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    const EDITED = 'Edited-P7-Bw63: shorter still'
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))
    const original = await diskBytes(file)

    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'vat', 'left', STATIC_TARGET)
    await chrome.saveNewComment(NOTE_A, STATIC)
    await expectPin(app, 'vat', true, STATIC_TARGET)

    // Edit in place from the message's … menu.
    await clickPin(app, 'vat', STATIC_TARGET)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await chrome.messageAction(0, 'Edit')
    await page.getByTestId('comment-edit-field').fill(EDITED)
    await page.getByTestId('comment-edit-save').click()
    await expect(win.getByTestId('comment-message-text')).toHaveText(EDITED, { timeout: PREVIEW_BUDGET_MS })
    const edited = await fsp.readFile(file, 'utf-8')
    expect(edited).toContain(EDITED)
    expect(edited).not.toContain(NOTE_A)

    // Delete the only message: the thread goes, the window closes, and the
    // file is the original again – every byte (decision 24).
    await chrome.messageAction(0, 'Delete…')
    await expect(page.getByTestId('comment-delete-cancel')).toBeFocused()
    await page.getByTestId('comment-delete-confirm').click()
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(async () => (await diskBytes(file)).equals(original), { timeout: PREVIEW_BUDGET_MS }).toBe(true)
    await expectPin(app, 'vat', false, STATIC_TARGET)
  })

  test('E-004 the whole cycle on a CRLF + BOM file keeps its line endings and BOM, and ends on the original bytes', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'crlf-bom.html')
    const target = HtmlPreviewPage.target(CRLF)
    const file = path.join(testProject.path, CRLF)
    // Generated here, never committed (§12.3): BOM + CRLF throughout.
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(STATIC_TEXT.replace(STATIC_TITLE, CRLF_TITLE).replace(/\r?\n/g, '\r\n'), 'utf-8')
    ])
    await fsp.writeFile(file, original)
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))

    const panelId = await openCommentPage(preview, app, CRLF, CRLF_TITLE)
    await chrome.modeOn(app, panelId, target)
    await clickElement(app, 'intro', 'left', target)
    await chrome.saveNewComment(NOTE_A, CRLF)

    // Add: one block, on lines of its own ending in CRLF, the BOM still first.
    const added = await diskBytes(file)
    const { text } = insertedText(original, added)
    expect(text).toContain('\r\n')
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(added.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
    await expectPin(app, 'intro', true, target)

    // Reply, resolve, re-open, edit – all through the window.
    await clickPin(app, 'intro', target)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-reply-field').fill('Reply-P7-CRLF')
    await page.getByTestId('comment-reply').click()
    await expect(win.getByTestId('comment-message')).toHaveCount(2, { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-resolve').click()
    await expect(page.getByTestId('comment-reopen')).toBeFocused({ timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-reopen').click()
    await expect(page.getByTestId('comment-reply-field')).toBeFocused({ timeout: PREVIEW_BUDGET_MS })
    await chrome.messageAction(0, 'Edit')
    await page.getByTestId('comment-edit-field').fill('Edited-P7-CRLF')
    await page.getByTestId('comment-edit-save').click()
    await expect(win.getByTestId('comment-message-text').first()).toHaveText('Edited-P7-CRLF', { timeout: PREVIEW_BUDGET_MS })
    // Every write so far kept the file's own line endings and its BOM.
    const mid = await fsp.readFile(file)
    expect(mid.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
    expect(mid.toString('utf-8').replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)

    // Delete the thread (first message, with a reply): the original bytes.
    await chrome.messageAction(0, 'Delete…')
    await expect(page.getByTestId('comment-delete-confirm')).toHaveText('Delete thread')
    await page.getByTestId('comment-delete-confirm').click()
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(async () => (await diskBytes(file)).equals(original), { timeout: PREVIEW_BUDGET_MS }).toBe(true)
  })

  test('E-007 comment mode swallows the page\'s clicks; Alt+↑/↓ move the pick up and down; Esc leaves the mode', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))
    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    const win = chrome.window()

    // A click on the page's own button: Erfana's window, never the page's handler.
    await clickElement(app, 'buy', 'left', STATIC_TARGET)
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(win).toContainText('button#buy.cta')
    expect(await preview.eval('String(window.__clicks ?? 0)', STATIC_TARGET)).toBe('0')
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)

    /** Enter on the picked element, and the window's context line names it. */
    const enterNames = async (label: string): Promise<void> => {
      expect(await pressInPage(app, 'Enter', [], STATIC_TARGET)).toBe(true)
      await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
      await expect(win).toContainText(`${label} · ${STATIC}, line `)
      await page.keyboard.press('Escape')
      await expect(win).toHaveCount(0)
    }
    // The picker starts on the hovered element…
    await clickElement(app, 'unlimited', 'none', STATIC_TARGET)
    await enterNames('em#unlimited')
    // …Alt+↑ is its parent, Alt+↓ back down the same path.
    expect(await pressInPage(app, 'Up', ['alt'], STATIC_TARGET)).toBe(true)
    await enterNames('p#starter-copy')
    expect(await pressInPage(app, 'Down', ['alt'], STATIC_TARGET)).toBe(true)
    await enterNames('em#unlimited')
    // Still no click reached the page.
    expect(await preview.eval('String(window.__clicks ?? 0)', STATIC_TARGET)).toBe('0')

    // Esc in the page leaves comment mode, in main and in the toolbar.
    expect(await pressInPage(app, 'Escape', [], STATIC_TARGET)).toBe(true)
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'false', { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(async () => (await commentPanelState(app, panelId))?.mode, { timeout: PREVIEW_BUDGET_MS }).toBe(false)
    // Out of comment mode the page has its clicks back.
    await clickElement(app, 'buy', 'left', STATIC_TARGET)
    await expect.poll(() => preview.eval('String(window.__clicks ?? 0)', STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe('1')
    await expect(win).toHaveCount(0)
  })

  test('E-014 the pins toggle hides and shows the pins, from the toolbar and from the drawer', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'e002.html')
    const target = HtmlPreviewPage.target(REVIEW)
    await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    await expect(chrome.iconsButton()).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'cta', true, target)

    await chrome.iconsButton().click()
    await expect(chrome.iconsButton()).toHaveAttribute('aria-pressed', 'false')
    await expectPin(app, 'cta', false, target)
    await expectPin(app, 'when', false, target)

    // The drawer's checkbox is the same switch.
    await chrome.openDrawer()
    const check = chrome.drawer().getByTestId('comment-drawer-show-icons')
    await expect(check).not.toBeChecked()
    await check.check()
    await expect(chrome.iconsButton()).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'cta', true, target)
  })

  test('E-016 keyboard only: the shortcut → Tab picks an element → Enter → type → Ctrl/Cmd+Enter saves', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    const TYPED = 'Typed-P7-Kb90 from the keyboard'
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))
    const before = await diskBytes(file)
    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await expect(chrome.modeButton()).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })

    // The shortcut, typed with focus in the page: main forwards only this key.
    const mods: Array<'control' | 'alt' | 'meta'> = process.platform === 'darwin' ? ['meta', 'alt'] : ['control', 'alt']
    expect(await pressInPage(app, 'M', mods, STATIC_TARGET)).toBe(true)
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(async () => (await commentPanelState(app, panelId))?.commentableFrames ?? 0, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThan(0)
    await waitForOverlay(preview, app, STATIC_TARGET)

    // Tab moves the picker (it starts at the viewport's centre), Enter opens the window.
    expect(await pressInPage(app, 'Tab', [], STATIC_TARGET)).toBe(true)
    expect(await pressInPage(app, 'Tab', [], STATIC_TARGET)).toBe(true)
    expect(await pressInPage(app, 'Enter', [], STATIC_TARGET)).toBe(true)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    const field = page.getByTestId('comment-new-field')
    await expect(field).toBeFocused()
    await page.keyboard.type(TYPED)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.announce()).toHaveText(`Comment saved to ${STATIC}.`, { timeout: PREVIEW_BUDGET_MS })
    expect(insertedText(before, await diskBytes(file)).text).toContain(TYPED)
  })

  test('E-021 the Settings "Comments" section changes the author of new comments only', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    const FIRST = 'Author-One Pz31'
    const SECOND = 'Author-Two Qm47'

    /** Type a name into Settings → Comments, leave the field, and wait for main to hold it. */
    const setNameInSettings = async (name: string): Promise<void> => {
      await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
      await expect(byTestId(page, TEST_IDS.SETTINGS_OVERLAY)).toBeVisible({ timeout: 10_000 })
      const section = page.getByTestId('settings-section-comments')
      await section.scrollIntoViewIfNeeded()
      await expect(page.getByTestId('settings-comment-notice')).toBeVisible()
      const field = page.getByTestId('settings-comment-name')
      await field.fill(name)
      await field.blur()
      await expect
        .poll(async () => ((await globalSetting(page, 'comments')) as { authorName?: string } | undefined)?.authorName, { timeout: PREVIEW_BUDGET_MS })
        .toBe(name)
      await byTestId(page, TEST_IDS.SETTINGS_BTN_CLOSE).click()
      await expect(byTestId(page, TEST_IDS.SETTINGS_OVERLAY)).toHaveCount(0, { timeout: 10_000 })
    }

    await setNameInSettings(FIRST)
    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'intro', 'left', STATIC_TARGET)
    // The privacy notice is still shown once, with the name from Settings filled in (R-019).
    await expect(chrome.window()).toHaveAttribute('data-view', 'identity', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-identity-name')).toHaveValue(FIRST)
    await page.getByTestId('comment-identity-continue').click()
    await chrome.saveNewComment('First-P7-Settings', STATIC)
    await expect.poll(async () => (await fsp.readFile(file, 'utf-8')).includes(FIRST), { timeout: PREVIEW_BUDGET_MS }).toBe(true)

    await setNameInSettings(SECOND)
    await clickElement(app, 'vat', 'left', STATIC_TARGET)
    // No identity step this time: the notice was seen.
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-identity-line')).toContainText(SECOND)
    await chrome.saveNewComment('Second-P7-Settings', STATIC)

    const text = await fsp.readFile(file, 'utf-8')
    // The new comment is by the new name; the first keeps the name it was saved with.
    expect(text.split(`comment by ${SECOND}`).length - 1).toBe(1)
    expect(text.split(`comment by ${FIRST}`).length - 1).toBe(1)
    expect(text.indexOf(`comment by ${FIRST}`)).toBeLessThan(text.indexOf('<p id="intro">Three'))
    expect(text.indexOf(`comment by ${SECOND}`)).toBeLessThan(text.indexOf('<p id="vat">Prices'))
    expect(text.indexOf(`comment by ${SECOND}`)).toBeGreaterThan(text.indexOf('<p id="intro">Three'))
  })

  test('E-024 git diff after add, edit and delete on a line-start target shows only block lines – the target line is unchanged', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const repo = testProject.path
    const TARGET_LINE = '    <p id="intro">Three plans, billed monthly.</p>'
    runGit(repo, 'init', '-b', 'main')
    runGit(repo, 'config', 'user.email', 'e2e@erfana.test')
    runGit(repo, 'config', 'user.name', 'Erfana E2E')
    runGit(repo, 'config', 'core.autocrlf', 'false')
    runGit(repo, 'add', '-A')
    runGit(repo, 'commit', '-m', 'init')
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))

    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'intro', 'left', STATIC_TARGET)
    await chrome.saveNewComment(NOTE_A, STATIC)

    /** Changed lines are all inside the block: none is the target line, none is outside a block. */
    const expectOnlyBlockLines = (lines: string[], kinds: RegExp): void => {
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(line, `a changed line is not ${kinds}`).toMatch(kinds)
        expect(line.slice(1)).not.toBe(TARGET_LINE)
        expect(line).not.toContain('<p id="intro">Three')
      }
    }
    // Add: only added lines, together exactly one block.
    const added = changedLines(repo, STATIC)
    expectOnlyBlockLines(added, /^\+/)
    expect(added[0]).toMatch(/^\+ {4}<!-- erfana:comment v1 id=c-/)
    expect(added[added.length - 1]).toBe('+    -->')
    runGit(repo, 'commit', '-am', 'add comment')

    // Edit: removed and added lines, all inside the block.
    await expectPin(app, 'intro', true, STATIC_TARGET)
    await clickPin(app, 'intro', STATIC_TARGET)
    await expect(chrome.window()).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await chrome.messageAction(0, 'Edit')
    await page.getByTestId('comment-edit-field').fill('Edited-P7-Git')
    await page.getByTestId('comment-edit-save').click()
    await expect(chrome.window().getByTestId('comment-message-text')).toHaveText('Edited-P7-Git', { timeout: PREVIEW_BUDGET_MS })
    const edited = changedLines(repo, STATIC)
    expectOnlyBlockLines(edited, /^[+-] {4}/)
    expect(edited.some(line => line.startsWith('-'))).toBe(true)
    expect(edited.some(line => line.startsWith('+'))).toBe(true)
    runGit(repo, 'commit', '-am', 'edit comment')

    // Delete: only removed lines – the block goes, the target line stays.
    await chrome.messageAction(0, 'Delete…')
    await page.getByTestId('comment-delete-confirm').click()
    await expect(chrome.window()).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(() => changedLines(repo, STATIC).length, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThan(0)
    expectOnlyBlockLines(changedLines(repo, STATIC), /^-/)
    expect(runGit(repo, 'diff', 'HEAD~2', '--stat', '--', STATIC)).toBe('')
  })
})
