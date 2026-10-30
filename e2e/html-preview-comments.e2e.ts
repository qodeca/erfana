// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the reviewer's path through the real UI
 * (docs/designs/comments/html-preview-comments.md §13 P6 "e2e exit", §10.3, §10.4,
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
 * keyboard-only path), E-016b (the shortcut with focus on dockview's group
 * element, as a tab switch leaves it – `usePreviewGroupKeys`), E-021 (Settings changes the author of new comments
 * only), E-024 (`git diff` after add, edit and delete on a line-start
 * target), E-026 (a tab switch away from an open drawer leaves the other
 * preview live, with its own drawer and count) and E-028 (Open in source
 * closes the window and shows the line; one button size; the window stays
 * with its tab – §19 Rev 4 "open in source and button sizes"). E-029 (with
 * the drawer open beside the page, a full-width element's pin is drawn and
 * hit inside the page's visible width, not under its scrollbar – §19 Rev 4
 * "pins at the right edge"). Helpers: `pages/html-preview.comments-ui.ts`.
 *
 * Every test that sets the identity puts the worker home's comment settings
 * back in `afterEach`, so E-001 always starts with the identity unset.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { runGit } from './utils/git-helpers'
import {
  CommentChrome,
  clickElement,
  clickPin,
  diskBytes,
  elementBox,
  expectPin,
  globalSetting,
  openCommentPage,
  pinPoint,
  pressInPage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  singleBlockInsert,
  viewShown,
  waitForOverlay,
  waitForViewShown
} from './pages/html-preview.comments-ui'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { bringAppToFront, focusState } from './pages/html-preview.focus'
import { dismissAllToasts, previewTabs } from './pages/html-preview.navigation'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { commentedPage } from '../src/main/services/preview/comments/__test-helpers__/commentedPages'
import { PIN_BOX_PX, PIN_EDGE_INSET_PX } from '../src/preload/previewPageComments/constants'
import { fullWidthCommentPage } from './fixtures/html-preview-comments-pages'
import {
  OVERLAY_HOST_EXPR,
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
    // C-15: the count is a labelled text button, "1 comment".
    await expect(page.getByTestId('preview-band-comments')).toHaveAccessibleName('1 comment', {
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
    await expect(listButton).toHaveAccessibleName('2 comments', { timeout: PREVIEW_BUDGET_MS })
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

    // Then the checkbox, the sort menu (C-15, beside it in the controls), then the list ONCE: arrows and Home move in it.
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('comment-drawer-show-icons')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId(TEST_IDS.COMMENT_DRAWER_SORT)).toBeFocused()
    await page.keyboard.press('Tab')
    const mains = drawer.getByTestId('comment-drawer-row-main')
    await expect(mains.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(mains.nth(1)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(mains.nth(0)).toBeFocused()
    // (Enter on a row opens its thread, R-10; the unit tests cover it.)

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

    // Resolve. C-13: with two open comments in the file the stepper shows and Resolve is
    // "Resolve and next": the thread is written resolved and the window steps to the other
    // open comment (em#when), saying where it landed; the pin goes.
    await page.getByTestId('comment-resolve-next').click()
    await expect(win.getByTestId('comment-window-polite')).toHaveText(/^Comment 1 of 2, on element, line \d+\.$/, { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByRole('heading', { level: 2 })).toHaveText('Comment on element') // A-02: the selector stays in the context line
    await expect.poll(async () => (await fsp.readFile(file, 'utf-8')).split('"status":"resolved"').length - 1, { timeout: PREVIEW_BUDGET_MS }).toBe(2)
    await page.getByTestId('comment-close').click()
    await expect(win).toHaveCount(0)
    await expectPin(app, 'cta', false, target)

    // The drawer lists it under Resolved.
    await chrome.openDrawer()
    await chrome.filter('resolved').click()
    // C-10: a row is named by its first comment's words; its Open button still names the element.
    // R-10: only the active row keeps its Open button, so find the row by its selector label.
    const resolvedRow = chrome.drawerRows().filter({ hasText: 'button#cta.btn' })
    await expect(resolvedRow).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.filter('resolved')).toContainText('Resolved 2')

    // Re-open from the drawer: the pin comes back and the thread is open again.
    await resolvedRow.getByTestId('comment-drawer-row-main').click() // R-10: a row click opens its thread
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-reopen').click()
    // C-19.4: the status action is spelled "Reopen".
    await expect(chrome.announce()).toHaveText('Comment reopened.', { timeout: PREVIEW_BUDGET_MS })
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

    // The picker starts on the hovered element. Hover it now, with the window
    // gone and the view shown again: where the pointer last was – or a real
    // cursor resting on the page – must not set the start.
    await clickElement(app, 'unlimited', 'none', STATIC_TARGET)
    // Alt+↑ is its parent, Alt+↓ back down the same path: each step is said in
    // the panel's polite region (the page holds no screen-reader text, E-022), by
    // the tag and line main parsed – never the page's ids or classes (S-L-A).
    // C-10 (HTML): the kind from main's table and the first words from main's own parse of the file (never the
    // page's text), as the Markdown picker says it; the first steps add the keys.
    expect(await pressInPage(app, 'Up', ['alt'], STATIC_TARGET)).toBe(true)
    await expect(chrome.announce()).toHaveText('Paragraph, line 24: “For one person. Every plan includes unlimited previews.”. Enter to comment, Shift+F10 for the menu.', { timeout: PREVIEW_BUDGET_MS })
    expect(await pressInPage(app, 'Down', ['alt'], STATIC_TARGET)).toBe(true)
    await expect(chrome.announce()).toHaveText('Element, line 24: “unlimited”. Enter to comment, Shift+F10 for the menu.', { timeout: PREVIEW_BUDGET_MS })
    // Enter opens the window on the element the picker stopped at.
    expect(await pressInPage(app, 'Enter', [], STATIC_TARGET)).toBe(true)
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(win).toContainText(`em#unlimited · ${STATIC}, line `)
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0)
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

  test('E-014 C-20 (HTML) the drawer checkbox hides and shows the pins; the toolbar has no icons toggle', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'e002.html')
    const target = HtmlPreviewPage.target(REVIEW)
    await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    await expectPin(app, 'cta', true, target)
    await expect(chrome.iconsButton()).toHaveCount(0)

    await chrome.openDrawer()
    const check = chrome.drawer().getByTestId('comment-drawer-show-icons')
    await expect(check).toBeChecked()
    await check.uncheck()
    await expectPin(app, 'cta', false, target)
    await expectPin(app, 'when', false, target)
    await check.check()
    await expect(check).toBeChecked({ timeout: PREVIEW_BUDGET_MS })
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

    // The picker starts under the pointer (else at the viewport's centre), and a
    // keyboard user's pointer is still somewhere: park it on a known element, so
    // a pointer left over the page's white margin cannot set the start.
    await clickElement(app, 'starter-name', 'none', STATIC_TARGET)
    // Tab moves the picker along the level, each step said in the polite region; Enter opens the window.
    // C-10 (HTML): the kind from main's table and the first words from main's own parse of the file (never the
    // page's text), as the Markdown picker says it; the first steps add the keys.
    expect(await pressInPage(app, 'Tab', [], STATIC_TARGET)).toBe(true)
    await expect(chrome.announce()).toHaveText('Paragraph, line 24: “For one person. Every plan includes unlimited previews.”. Enter to comment, Shift+F10 for the menu.', { timeout: PREVIEW_BUDGET_MS })
    expect(await pressInPage(app, 'Tab', [], STATIC_TARGET)).toBe(true)
    await expect(chrome.announce()).toHaveText('Button, line 25: “Buy now”. Enter to comment, Shift+F10 for the menu.', { timeout: PREVIEW_BUDGET_MS })
    expect(await pressInPage(app, 'Enter', [], STATIC_TARGET)).toBe(true)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expect(win).toContainText(`button#buy.cta · ${STATIC}, line `)
    const field = page.getByTestId('comment-new-field')
    await expect(field).toBeFocused()
    await page.keyboard.type(TYPED)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.announce()).toHaveText(`Comment saved to ${STATIC}.`, { timeout: PREVIEW_BUDGET_MS })
    expect(insertedText(before, await diskBytes(file)).text).toContain(TYPED)
  })

  test('E-016b the shortcut works with focus on the dockview group, where a tab switch leaves it – not in the page', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'e001.html')
    const target = HtmlPreviewPage.target(PAGE)
    // Opened from the tree; nothing clicks into the page or the panel chrome.
    const panelId = await openCommentPage(preview, app, PAGE, TITLE)
    await expect(chrome.modeButton()).not.toHaveAttribute('aria-disabled', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'false')

    // Where `group.focus()` leaves focus on a tab switch: dockview's group
    // element, outside the panel root (the preview renders in the overlay layer).
    const group = page.locator('.dv-groupview.dv-active-group', { has: preview.tab('e001.html') })
    // The preview may hold native focus after the open (it does on Windows). A
    // DOM focus cannot take the keyboard back from a native view, so hand native
    // focus to the host's own contents first – what a click on the host does.
    await bringAppToFront(app)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.focus())
    await expect
      .poll(async () => (await focusState(app, target))?.host, { timeout: PREVIEW_BUDGET_MS })
      .toBe(true)
    await group.focus()
    await expect(group).toBeFocused()
    // Main's forwarder hears keys only while the page has focus; it must not here,
    // or this test would pass through the forwarder instead of the group route.
    const focus = await focusState(app, target)
    expect(focus).not.toBeNull()
    expect(focus?.preview).toBe(false)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+m' : 'Control+Alt+m')
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expect
      .poll(async () => (await commentPanelState(app, panelId))?.mode, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'main never turned comment mode on'
      })
      .toBe(true)
  })

  test('E-016c a pick made with the page holding the keyboard opens the window with the keyboard in its field; Ctrl/Cmd+Enter saves', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    // §19 "Rev 4 – owner test: comment window focus and save key". Playwright's
    // `page.keyboard` types into the host renderer whatever holds NATIVE focus,
    // so E-016 could pass while a real reader's keys still went to the page.
    // This test pins native focus itself, read main-side (`focusState`).
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    const TYPED = 'Typed-P7-Fc31 with no click'
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))
    const before = await diskBytes(file)
    const panelId = await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    await chrome.modeOn(app, panelId, STATIC_TARGET)

    // The reader is in the page: it holds native focus, as after a real click
    // (`sendInputEvent` alone moves no OS focus, so hand it over explicitly).
    await bringAppToFront(app)
    await app.evaluate(({ webContents }, urlIncludes) => {
      webContents
        .getAllWebContents()
        .find(c => !c.isDestroyed() && c.getURL().startsWith('erfana-preview://') && c.getURL().includes(urlIncludes ?? ''))
        ?.focus()
    }, STATIC_TARGET.urlIncludes)
    await expect
      .poll(async () => await focusState(app, STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS })
      .toEqual({ preview: true, host: false })

    await clickElement(app, 'team-copy', 'left', STATIC_TARGET)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    // Main handed the keyboard to the host before it opened the window …
    await expect
      .poll(async () => await focusState(app, STATIC_TARGET), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the page kept the keyboard after the comment window opened'
      })
      .toEqual({ preview: false, host: true })
    // … and the window put it in the field: no click before typing.
    const field = page.getByTestId('comment-new-field')
    await expect(field).toBeFocused()
    await page.keyboard.type(TYPED)
    await expect(field).toHaveValue(TYPED)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(win).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expect(chrome.announce()).toHaveText(`Comment saved to ${STATIC}.`, { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'team-copy', true, STATIC_TARGET)
    const { text, tail } = insertedText(before, await diskBytes(file))
    expect(text).toContain(TYPED)
    expect(tail.startsWith('<p id="team-copy">')).toBe(true)
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

  test('E-026 a tab switch away from an open drawer leaves the other preview live – no still frame, clicks reach it – with its own drawer and count', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const other = new CommentChrome(page, preview, 'index.html')
    const reviewed = new CommentChrome(page, preview, 'e002.html')
    const reviewTarget = HtmlPreviewPage.target(REVIEW)
    /** The dockview tab of `basename`, only while it is the active one. */
    const activeTab = (basename: string): Locator =>
      page.locator('.dv-tab.dv-active-tab', { has: preview.tab(basename) })

    // Two preview tabs of one project: the static page (no comments), then
    // the reviewed page (two open) – the owner's index.html and decisions.html.
    await openCommentPage(preview, app, STATIC, STATIC_TITLE)
    const reviewPanel = await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    await expect(activeTab('e002.html')).toHaveCount(1)
    await expect(reviewed.listButton()).toHaveAccessibleName('2 comments', { timeout: PREVIEW_BUDGET_MS })

    // The drawer open on the reviewed page, its two comments listed, and comment mode on.
    await reviewed.openDrawer()
    await expect(reviewed.drawerRows()).toHaveCount(2)
    await reviewed.modeOn(app, reviewPanel, reviewTarget)

    // Switch to the other preview tab.
    await preview.tab('index.html').click()
    await expect(activeTab('index.html')).toHaveCount(1)

    // It is LIVE: the native view is shown, no still frame stands in for it,
    // and the hidden tab's view is the one hidden.
    await waitForViewShown(app, STATIC_TARGET)
    await expect(preview.stillFrame('index.html')).toHaveCount(0)
    await expect.poll(() => viewShown(app, reviewTarget), { timeout: PREVIEW_BUDGET_MS }).toBe(false)
    expect(await preview.eval('document.title', STATIC_TARGET)).toBe(STATIC_TITLE)
    // A click reaches the page's own handler: the tab is not in comment mode,
    // and nothing over it swallows the input.
    await clickElement(app, 'buy', 'left', STATIC_TARGET)
    await expect
      .poll(() => preview.eval('String(window.__clicks ?? 0)', STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS })
      .toBe('1')
    await expect(other.window()).toHaveCount(0)
    // It still renders frames after the click (a still picture never would).
    await expect(preview.stillFrame('index.html')).toHaveCount(0)
    expect(await viewShown(app, STATIC_TARGET)).toBe(true)

    // Its chrome is its own: no drawer, no count, mode off …
    await expect(other.drawer()).toHaveCount(0)
    await expect(other.listButton()).toHaveAttribute('aria-expanded', 'false')
    await expect(other.listButton()).toHaveAccessibleName('Comments')
    await expect(other.modeButton()).toHaveAttribute('aria-pressed', 'false')
    // … and the hidden tab kept its own: drawer open, mode on.
    await expect(reviewed.listButton()).toHaveAttribute('aria-expanded', 'true')
    await expect(reviewed.modeButton()).toHaveAttribute('aria-pressed', 'true')

    // Back to the reviewed tab: its drawer and its two comments are still
    // there, and the static page's view is the hidden one now. Its own view
    // shows unless its drawer is a full-width sheet (a panel under 640 px),
    // which covers the page by design.
    await preview.tab('e002.html').click()
    await expect(activeTab('e002.html')).toHaveCount(1)
    await expect(reviewed.drawer()).toBeVisible()
    await expect(reviewed.drawerRows()).toHaveCount(2)
    await expect.poll(() => viewShown(app, STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe(false)
    const sheet = await reviewed.drawer().evaluate(el => el.classList.contains('erf-comment-drawer--full'))
    await expect.poll(() => viewShown(app, reviewTarget), { timeout: PREVIEW_BUDGET_MS }).toBe(!sheet)

    // A wide panel (the terminal put away): the drawer is a side panel
    // beside the live page. Hiding its tab must not turn it into a sheet – a
    // tab dockview hides measures 0×0 – nor hide the tab switched to.
    await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await expect(byTestId(page, TEST_IDS.TERMINAL_PANEL)).toBeHidden({ timeout: 10_000 })
    await expect(reviewed.drawer(), 'the panel is still under 640 px with the terminal put away').not.toHaveClass(
      /erf-comment-drawer--full/,
      { timeout: PREVIEW_BUDGET_MS }
    )
    await waitForViewShown(app, reviewTarget)

    await preview.tab('index.html').click()
    await expect(activeTab('index.html')).toHaveCount(1)
    await waitForViewShown(app, STATIC_TARGET)
    await expect(preview.stillFrame('index.html')).toHaveCount(0)
    await expect(reviewed.drawer()).not.toHaveClass(/erf-comment-drawer--full/)
    await clickElement(app, 'buy', 'left', STATIC_TARGET)
    await expect
      .poll(() => preview.eval('String(window.__clicks ?? 0)', STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS })
      .toBe('2')
  })
  test('E-028 Open in source closes the comment window and shows the line; the window keeps one button size and never follows to another tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'e002.html')
    const tabs = new TabBarPage(page)
    const target = HtmlPreviewPage.target(REVIEW)
    const DRAFT = 'Draft-E028-Kp3v: half a thought'
    await setGlobalSetting(page, 'comments', reviewer(NAME_A))

    await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    await expectPin(app, 'cta', true, target)
    await clickPin(app, 'cta', target)
    const win = chrome.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-message')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })

    // One button size (owner test): every text button is a Dialog.css button – no compact action among them.
    const textButtons = win.locator('button:not(.erf-comment-icon-btn)')
    const count = await textButtons.count()
    expect(count).toBeGreaterThan(2)
    for (let i = 0; i < count; i += 1) {
      await expect(textButtons.nth(i)).toHaveClass(/\bdialog-btn\b/)
      await expect(textButtons.nth(i)).not.toHaveClass(/\berf-comment-action\b/)
    }

    // A reply typed, then Open in source: the window is gone and the editor shows the element's line.
    await page.getByTestId('comment-reply-field').fill(DRAFT)
    // C-13 / C-19: with the stepper shown, Open in source is under More actions.
    await chrome.moreAction('comment-open-in-source')
    await expect(win).toHaveCount(0)
    await tabs.waitForTab('e002.html')
    await tabs.expectActive('e002.html')
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    await monaco.waitForReady()
    await expect.poll(() => monaco.visibleText(), { timeout: PREVIEW_BUDGET_MS }).toContain('id="cta"')

    // Back on the preview, the same pin: the reply text came back with the window (session drafts).
    await preview.tab('e002.html').click()
    await clickPin(app, 'cta', target)
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await expect(page.getByTestId('comment-reply-field')).toHaveValue(DRAFT)

    // The window belongs to its tab: not drawn over the editor tab, back with its own.
    // The window is modal (§10.4), so a pointer cannot reach the tab strip; a tab
    // change without the pointer (an agent opening the file) is what can happen.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      await tabs.tab('e002.html').dispatchEvent(type, { button: 0, isPrimary: true })
    }
    await tabs.expectActive('e002.html')
    await expect(win).toHaveCount(0)
    await preview.tab('e002.html').click()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-close').click()
    await expect(win).toHaveCount(0)
  })
})

/** The owner's page: one open comment on a `div.doc` that spans the page (E-029). */
const EDGE = 'comments/full-width.html'
const EDGE_TITLE = '-HPC-EDGE-'

/** What {@link edgeHitsExpr} reports: where along one row the overlay host takes the hit. */
interface EdgeHits {
  visible: number
  inner: number
  first: number | null
  last: number | null
}

/**
 * A page expression (main world): along row `y`, from 80 px left of the
 * visible edge to the window's edge (scrollbar included), the x of each point
 * `elementFromPoint` answers with the overlay host – a hit inside its closed
 * shadow root is retargeted to it, and only a pin takes pointer events there.
 */
function edgeHitsExpr(y: number): string {
  return `(() => {
    const root = document.documentElement
    const host = ${OVERLAY_HOST_EXPR}
    const hits = []
    for (let x = Math.max(0, root.clientWidth - 80); host && x < innerWidth; x += 1) {
      if (document.elementFromPoint(x, ${y}) === host) hits.push(x)
    }
    return JSON.stringify({ visible: root.clientWidth, inner: innerWidth, first: hits[0] ?? null, last: hits.at(-1) ?? null })
  })()`
}

test.describe('HTML Preview comments – the pin at the page edge (§19 Rev 4 owner test)', () => {
  test.use({ testProjectFiles: { [EDGE]: fullWidthCommentPage(EDGE_TITLE), 'notes.md': '# Notes\n' } })

  test('E-029 with the drawer open beside the page, a full-width element’s pin is drawn and hit inside the page’s visible width – not under its scrollbar', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'full-width.html')
    const target = HtmlPreviewPage.target(EDGE)

    await openCommentPage(preview, app, EDGE, EDGE_TITLE)
    await expect(chrome.listButton()).toHaveAccessibleName('1 comment', { timeout: PREVIEW_BUDGET_MS })

    // The owner's layout: the drawer as a side panel, the page view narrower
    // beside it. With the terminal put away the panel is wide enough for one
    // (under 640 px the drawer is a full-width sheet over the page – E-026).
    await byTestId(page, TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).click()
    await expect(byTestId(page, TEST_IDS.TERMINAL_PANEL)).toBeHidden({ timeout: 10_000 })
    await chrome.openDrawer()
    await expect(chrome.drawer()).not.toHaveClass(/erf-comment-drawer--full/, { timeout: PREVIEW_BUDGET_MS })
    await waitForViewShown(app, target)

    // The pin's row: the overlay host takes the hit along a whole 24 px box,
    // and the box ends 4 px inside the visible width. Before the fix the box
    // was clamped to innerWidth, so it ran under the scrollbar and only a
    // sliver of it was left of the scrollbar's edge. Polled: the view settles
    // its new width after the drawer opens.
    let hits: EdgeHits | null = null
    await expect
      .poll(
        async () => {
          const box = await elementBox(app, 'doc', target)
          if (box === null) return 'no #doc yet'
          const raw = await preview.eval(edgeHitsExpr(pinPoint(box).y), target)
          if (raw === null) return 'the page is mid-load'
          const now = JSON.parse(raw) as EdgeHits
          hits = now
          if (now.first === null || now.last === null) return `no pin along its row (visible ${now.visible} of ${now.inner} px)`
          const whole = now.last - now.first + 1 >= PIN_BOX_PX - 1
          const inside = now.last < now.visible - PIN_EDGE_INSET_PX
          return whole && inside ? 'inside' : `pin hit at x ${now.first}–${now.last}, visible width ${now.visible} of ${now.inner} px`
        },
        { timeout: PREVIEW_BUDGET_MS, message: 'the full-width element’s pin is not wholly inside the page’s visible width' }
      )
      .toBe('inside')
    const seen = hits as EdgeHits | null
    test.info().annotations.push({
      type: 'scrollbar',
      description: seen === null ? 'unread' : `${seen.inner - seen.visible} px (0 under overlay scrollbars)`
    })

    // #doc spans the page: its top-right corner is on the visible edge, where
    // the pin's tail would have put it under the scrollbar.
    const box = await elementBox(app, 'doc', target)
    expect(box, '#doc vanished').not.toBeNull()
    if (box === null) return
    expect(box.right).toBeGreaterThanOrEqual(box.visibleWidth - 1)

    // Painted where it is hit: the pin's fill covers its body in the view's capture.
    await expectPin(app, 'doc', true, target)
    // And a real click there opens its thread.
    await clickPin(app, 'doc', target)
    await expect(chrome.window()).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-close').click()
    await expect(chrome.window()).toHaveCount(0)
  })
})
