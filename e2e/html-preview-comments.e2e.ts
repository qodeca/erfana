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
 * E-002 is the guaranteed keyboard route (§10.8) on a page that already holds
 * comments: the list button, the drawer's one-stop filter, checkbox and list
 * (arrows, Home), a row's Open into the window, and the Esc order inside it –
 * Esc first backs out of an open edit (keeping its text), and only then
 * closes the window, focus going back to the row's Open.
 *
 * E-003 is the unsaved-source guard (decision 13): with the page's file open
 * "as source" and edited, the new-comment window blocks Save behind the
 * warning banner; "Save {file}" writes the tab and the banner turns into
 * "Saved. You can add your comment now."; "Go to tab" closes the window and
 * leaves focus in the editor. Autosave writes 2 s after the last keystroke,
 * so each dirty-then-open step is retried with a fresh edit when autosave
 * got there first (the pattern of html-preview-same-tab.history.e2e.ts).
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
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

test.use({
  testProjectFiles: {
    [PAGE]: PAGE_TEXT,
    [REVIEW]: REVIEWED.text,
    'notes.md': '# Notes\n'
  }
})

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

  test('E-002 keyboard route: list button → drawer filter, checkbox, rows → Open → Esc backs out of an edit, then closes', async ({
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

  test('E-003 an unsaved source tab blocks Save; Save {file} clears it; Go to tab leaves for the editor', async ({
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
