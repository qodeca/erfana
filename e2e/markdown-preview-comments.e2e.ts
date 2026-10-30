// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments, end to end (spec 024 commit 13): the real app,
 * the real file on disk.
 *
 * - **Round trip** – comment mode, a click on a paragraph, the identity step,
 *   Save: the `<!-- erfana:comment v1 … -->` block is on disk and an icon is
 *   drawn; the icon opens the thread: reply, resolve, re-open, delete – and
 *   the file is the original again, byte for byte.
 * - **024-AC-029** – keyboard only: the mode shortcut, Tab and Alt+Down to a
 *   list item, Enter, Ctrl/Cmd+Enter to save, Esc to leave.
 * - **024-AC-006** – the comment tools and the overlay live in the
 *   preview-only view only; the editor and split views show none, and turning
 *   "Comments in Markdown preview" off removes them. This is E-020's
 *   successor ("has a comment entry when the setting is on, none when off").
 * - **024-AC-016** – an unsaved edit pauses comments: the band offers Save
 *   {file}, the toggle is unavailable, and saving brings comment mode back.
 * - **024-AC-005** (commit 14) – words selected and commented from the
 *   right-click menu, and by a drag in comment mode and the Comment button:
 *   `anchor.sel` is on disk and the words are marked.
 * - **C-15, C-20, C-22 (Markdown)** (commit 14) – the quieter toolbar and the
 *   drawer's icons checkbox, the three-cell filter and the sort menu, and a
 *   click on a commented paragraph opening its thread.
 * - **024-AC-001 (Markdown)** – the Playwright half of the shared overlay
 *   suite: each pin sits where the shared pin rule puts it for its block and
 *   takes the hit there, and commented words carry the underline mark.
 *
 * Local gate only (e2e is not a required check). Condition-based waits only.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { test, expect } from './fixtures/index'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MarkdownCommentsPage, MD_COMMENT_BUDGET_MS } from './pages/markdown-comments.page'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { reviewer, setGlobalSetting } from './pages/html-preview.comments-ui'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { PIN_BOX_PX, placePin, type Box } from '../src/shared/comments/overlayCore/pinLayout'

const FILE = 'review.md'
const TEXT = [
  '# Review',
  '',
  'First paragraph of the review.',
  '',
  '- alpha',
  '- beta release notes',
  '',
  'Closing paragraph.',
  ''
].join('\n')

const NAME = 'Reviewer Md13 Kq52'
const NOTE = 'MdNote-13-Hv38: tighten this paragraph'
const REPLY = 'MdReply-13-Pz04: agreed'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const MODE_KEY = process.platform === 'darwin' ? 'Meta+Alt+KeyM' : 'Control+Alt+KeyM'

test.use({ testProjectFiles: { [FILE]: TEXT } })

test.describe('Markdown Preview comments', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    const page = windowWithTestProject
    await setGlobalSetting(page, 'comments', { identityNoticeSeen: false })
    await setGlobalSetting(page, 'markdownPreview', { comments: { enabled: true } })
  })

  /** Open the file from the tree: it lands in the preview-only view. */
  async function openReview(page: Parameters<typeof setGlobalSetting>[0]): Promise<MarkdownCommentsPage> {
    const md = new MarkdownCommentsPage(page)
    await new ProjectTreePage(page).fileRow(FILE).click()
    await md.editor.waitForReady()
    await expect(md.target('p', 3)).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.waitForComments()
    return md
  }

  test('add a comment on a paragraph, reply, resolve, re-open and delete: the file comes back byte for byte', async ({
    windowWithTestProject,
    testProject
  }) => {
    const page = windowWithTestProject
    const file = path.join(testProject.path, FILE)
    const original = await fsp.readFile(file)
    const md = await openReview(page)

    await md.modeOn()
    await md.target('p', 3).click()
    await expect(md.window()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.saveNewComment(NOTE, FILE, NAME)
    const written = await fsp.readFile(file, 'utf-8')
    expect(written).toContain('<!-- erfana:comment v1')
    expect(written).toContain(NOTE)
    expect(written).toContain(NAME)
    // A new block goes directly before its target, so the paragraph moved down by the block's lines.
    // (The block quotes the paragraph too, so the paragraph is the line that is nothing else.)
    const lines = written.split('\n')
    const paragraphLine = lines.indexOf('First paragraph of the review.') + 1
    expect(lines.findIndex(line => line.startsWith('<!-- erfana:comment v1')) + 1).toBeLessThan(paragraphLine)
    // The preview renders the block as nothing; one icon marks the paragraph.
    await expect(md.content()).not.toContainText('erfana:comment')
    await expect(md.icons()).toHaveCount(1, { timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.icons().first()).toHaveAccessibleName(`1 comment on paragraph, line ${paragraphLine}. Open.`)

    // The icon opens the thread outside comment mode too.
    await md.modeButton().click()
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'false')
    await md.icons().first().click()
    const win = md.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: MD_COMMENT_BUDGET_MS })
    await expect(win.getByTestId('comment-message')).toHaveCount(1)

    await page.getByTestId('comment-reply-field').fill(REPLY)
    await page.getByTestId('comment-reply').click()
    await expect(win.getByTestId('comment-message')).toHaveCount(2, { timeout: MD_COMMENT_BUDGET_MS })
    expect(await fsp.readFile(file, 'utf-8')).toContain(REPLY)

    await page.getByTestId('comment-resolve').click()
    await expect(win.getByTestId('comment-resolved-thread')).toHaveCount(1, { timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.announce()).toHaveText('Comment resolved.', { timeout: MD_COMMENT_BUDGET_MS })
    expect(await fsp.readFile(file, 'utf-8')).toContain(`status: resolved by ${NAME}`)
    await page.getByTestId('comment-reopen').click()
    await expect(md.announce()).toHaveText('Comment reopened.', { timeout: MD_COMMENT_BUDGET_MS })

    // Deleting the first message deletes the thread; the bytes come back.
    await md.messageAction(0, 'Delete…')
    await page.getByTestId('comment-delete-confirm').click()
    await expect(win).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await expect.poll(async () => (await fsp.readFile(file)).equals(original), { timeout: MD_COMMENT_BUDGET_MS }).toBe(true)
    await expect(md.icons()).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
  })

  test('024-AC-029 keyboard only: the shortcut, Tab and Alt+Down to a list item, Enter, save, Esc', async ({
    windowWithTestProject,
    testProject
  }) => {
    const page = windowWithTestProject
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const file = path.join(testProject.path, FILE)
    const md = await openReview(page)

    await page.keyboard.press(MODE_KEY)
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'true', { timeout: MD_COMMENT_BUDGET_MS })
    // Focus moves to the first target in view: the heading.
    await expect(md.target('h1', 1)).toBeFocused({ timeout: MD_COMMENT_BUDGET_MS })
    await page.keyboard.press('Tab')
    await expect(md.target('p', 3)).toBeFocused()
    // C-10: the step names the kind, line and opening words (was "Showing paragraph, line 3.").
    await expect(md.announce()).toHaveText(
      'Paragraph, line 3: “First paragraph of the review.”. Enter to comment, Shift+F10 for the menu.'
    )
    await page.keyboard.press('Tab')
    await expect(md.target('ul', 5)).toBeFocused()
    await page.keyboard.press('Alt+ArrowDown')
    await expect(md.target('li', 5)).toBeFocused()
    await expect(md.modeTab()).toHaveText('Comment mode · List item, line 5 · Esc to leave')

    await page.keyboard.press('Enter')
    const win = md.window()
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: MD_COMMENT_BUDGET_MS })
    await expect(win.getByTestId('comment-window-title')).toHaveText('New comment on list item')
    await expect(page.getByTestId('comment-new-field')).toBeFocused()
    await page.keyboard.insertText(NOTE)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect(win).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await expect.poll(async () => (await fsp.readFile(file, 'utf-8')).includes(NOTE), { timeout: MD_COMMENT_BUDGET_MS }).toBe(true)

    // Focus came back to the list item; Esc leaves comment mode for the toggle. The block went in above
    // the item, so the redraw after the save moves it down: find it by its words, not its line.
    await expect(md.content().locator('li', { hasText: 'alpha' })).toBeFocused({ timeout: MD_COMMENT_BUDGET_MS })
    await page.keyboard.press('Escape')
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'false')
    await expect(md.modeButton()).toBeFocused()
  })

  test('024-AC-006 comment tools show in the preview-only view only, and not at all with the setting off', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    await md.modeOn()

    await md.editor.setViewMode('split')
    await expect(md.modeButton()).toHaveCount(0)
    await expect(md.overlay()).toHaveCount(0)
    await md.editor.setViewMode('editor')
    await expect(md.modeButton()).toHaveCount(0)
    await md.editor.setViewMode('preview')
    await md.waitForComments()
    // Comment mode does not survive leaving the view.
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'false')

    await setGlobalSetting(page, 'markdownPreview', { comments: { enabled: false } })
    await expect(md.modeButton()).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.overlay()).toHaveCount(0)
    await expect(md.preview()).not.toHaveAttribute('tabindex', '0')
    await md.target('p', 3).click({ button: 'right' })
    await expect(page.getByTestId('comment-menu-comment-on')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await setGlobalSetting(page, 'markdownPreview', { comments: { enabled: true } })
    await md.waitForComments()
  })

  test('024-AC-016 an unsaved edit pauses comments; Save {file} brings them back', async ({ windowWithTestProject }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    const tabs = new TabBarPage(page)
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    const band = md.pausedBand()
    let attempt = 0

    // Autosave may write the edit first: retry with a fresh edit until the band is caught up.
    await expect(async () => {
      await md.editor.setViewMode('editor')
      await monaco.waitForReady()
      await monaco.focus()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
      // `insertText`: Monaco drops single keystrokes during re-layout (monaco.page.ts).
      await page.keyboard.insertText(`\nUnsaved line ${++attempt}.\n`)
      await expect(tabs.dirtyDot(FILE)).toBeVisible()
      await md.editor.setViewMode('preview')
      await expect(band).toBeVisible({ timeout: 1000 })
      await expect(band).toHaveAttribute('data-state', 'paused')
      await expect(band).toContainText(`${FILE} has unsaved changes – comments are read-only until you save.`)
      await expect(md.modeButton()).toHaveAttribute('aria-disabled', 'true')
      await expect(md.modeButton()).toHaveAttribute('title', /^Comment mode is unavailable: /)
      await band.getByTestId('comment-host-paused-save').click({ timeout: 1000 })
    }).toPass({ timeout: MD_COMMENT_BUDGET_MS * 2 })

    await expect(band).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await expect(tabs.dirtyDot(FILE)).toHaveCount(0)
    await expect(md.modeButton()).not.toHaveAttribute('aria-disabled', 'true')
    await md.modeOn()
  })

  test('024-AC-005 (a) select words, Comment on selection, save: anchor.sel is on disk and the words are marked', async ({
    windowWithTestProject,
    testProject
  }) => {
    const page = windowWithTestProject
    const file = path.join(testProject.path, FILE)
    const md = await openReview(page)

    const at = await md.selectWords('p', 3, 'paragraph of')
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await expect(page.getByRole('menu', { name: 'Selection' })).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await page.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION).click()
    await md.passIdentity(NAME)
    await expect(md.window().getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveText('Comment on: “paragraph of”')
    await md.saveNewComment(NOTE, FILE, NAME)

    const written = await fsp.readFile(file, 'utf-8')
    expect(written).toContain('"sel":{"exact":"paragraph of","prefix":"First ","suffix":" the review."}')
    await expect.poll(() => md.markedWords(), { timeout: MD_COMMENT_BUDGET_MS }).toEqual(['paragraph of'])
  })

  test('024-AC-005 (b) in comment mode a drag selects words in a list item; the Comment button saves them', async ({
    windowWithTestProject,
    testProject
  }) => {
    const page = windowWithTestProject
    const file = path.join(testProject.path, FILE)
    const md = await openReview(page)
    await md.modeOn()

    // A real drag across the list item's word: press at its start, release at its end.
    const item = md.target('li', 6)
    const box = (await item.boundingBox())!
    const word = await md.selectWords('li', 6, 'beta')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.mouse.move(box.x + 2, word.y)
    await page.mouse.down()
    await page.mouse.move(word.right + 1, word.y, { steps: 5 })
    await page.mouse.up()
    // A drag is no pick: no window, and the Comment button shows over the words.
    await expect(md.selectionButton()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.window()).toHaveCount(0)
    await md.selectionButton().click()
    await md.passIdentity(NAME)
    await expect(md.window().getByTestId(TEST_IDS.COMMENT_WORDS)).toContainText('beta')
    await md.saveNewComment(NOTE, FILE, NAME)

    const written = await fsp.readFile(file, 'utf-8')
    expect(written).toMatch(/"sel":\{"exact":"[^"]*beta"/)
  })

  /** Comment on a target in comment mode and leave the mode on. */
  async function commentOn(md: MarkdownCommentsPage, tag: string, line: number): Promise<void> {
    await md.modeOn()
    await md.target(tag, line).click()
    await expect(md.window()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.saveNewComment(NOTE, FILE, NAME)
  }

  test('C-20 (Markdown) a quieter toolbar: Comment mode and a labelled count; icons and underlines are the drawer checkbox', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    // No "Show comment icons" tool in the row; with no comments the count reads "Comments".
    await expect(md.editor.toolbar().getByTestId(TEST_IDS.COMMENT_TOOL_ICONS)).toHaveCount(0)
    await expect(md.listButton()).toHaveAccessibleName('Comments')
    await commentOn(md, 'li', 5)
    await expect(md.listButton()).toHaveAccessibleName('1 comment', { timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.listButton()).toContainText('1 comment')
    await expect(md.listButton()).not.toHaveAttribute('title')

    await md.listButton().click()
    await expect(md.listButton()).toHaveAttribute('aria-expanded', 'true')
    await expect(md.drawer()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await expect(md.icons()).toHaveCount(1)
    await md.iconsCheckbox().uncheck()
    await expect(md.icons()).toHaveCount(0)
    await md.iconsCheckbox().check()
    await expect(md.icons()).toHaveCount(1)
  })

  test('C-15 (Markdown) the drawer filter is three cells on one row, and the sort menu orders the rows', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    await commentOn(md, 'p', 3)
    await md.listButton().click()
    await expect(md.drawer()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })

    await expect(md.filter('open')).toHaveText('Open 1')
    await expect(md.filter('resolved')).toHaveText('Resolved 0')
    await expect(md.filter('cantEdit')).toHaveText("Can't edit 0")
    // One row, equal widths: every cell shares the first cell's top and width (within a pixel).
    const boxes = await Promise.all((['open', 'resolved', 'cantEdit'] as const).map(which => md.filter(which).boundingBox()))
    for (const box of boxes) {
      expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThanOrEqual(1)
    }
    await expect(md.drawer().getByRole('radiogroup', { name: 'Show' })).toBeVisible()

    await expect(md.sortButton()).toHaveText(/Sort: File order/)
    await md.sortButton().click()
    const menu = page.getByRole('menu', { name: 'Sort comments' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['File order', 'Changed first', 'Latest activity'])
    await menu.getByRole('menuitem', { name: 'Latest activity' }).click()
    await expect(md.sortButton()).toHaveText(/Sort: Latest activity/)
    await expect(md.sortButton()).toBeFocused()
  })

  test('C-22 (Markdown) in comment mode a click on a commented paragraph opens its thread, not a blank new comment', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    await commentOn(md, 'p', 3)
    // The block went in before the paragraph: find it again by its text.
    const paragraph = md.content().locator('p', { hasText: 'First paragraph of the review.' })
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'true')
    // C-22: the paragraph is "commented" once the list says so – "Comment saved" is said on the write's answer,
    // and the refreshed list (the icon) lands after it. A click before that is a click on an uncommented paragraph.
    await expect(md.icons()).toHaveCount(1, { timeout: MD_COMMENT_BUDGET_MS })
    await paragraph.click()
    const win = md.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: MD_COMMENT_BUDGET_MS })
    await expect(win.getByTestId('comment-message')).toHaveCount(1)
    await expect(win.getByTestId('comment-message').first()).toContainText(NOTE)
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    // A paragraph with no comment still opens a new one.
    await md.content().locator('p', { hasText: 'Closing paragraph.' }).click()
    await expect(win).toHaveAttribute('data-view', 'new', { timeout: MD_COMMENT_BUDGET_MS })
  })
  test('C-13 (Markdown) the stepper walks the open comments: Alt+F9, Resolve and next, then all resolved', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    await commentOn(md, 'p', 3)
    // A second comment, found by its text: the first block moved the lines.
    await md.content().locator('p', { hasText: 'Closing paragraph.' }).click()
    await expect(md.window()).toHaveAttribute('data-view', 'new', { timeout: MD_COMMENT_BUDGET_MS })
    await md.saveNewComment(NOTE, FILE, NAME)

    // C-22 / C-13: both comments are in the list (two icons) before the click opens their threads.
    await expect(md.icons()).toHaveCount(2, { timeout: MD_COMMENT_BUDGET_MS })
    await md.content().locator('p', { hasText: 'First paragraph of the review.' }).click()
    const win = md.window()
    await expect(win).toHaveAttribute('data-view', 'threads', { timeout: MD_COMMENT_BUDGET_MS })
    const stepper = win.getByTestId(TEST_IDS.COMMENT_STEPPER)
    await expect(stepper).toContainText('1 of 2')
    await page.keyboard.press('Alt+F9')
    await expect(stepper).toContainText('2 of 2')
    await expect(win.getByTestId(TEST_IDS.COMMENT_WINDOW_POLITE)).toHaveText(/Comment 2 of 2, on paragraph, line \d+\./)
    await expect(win.getByTestId(TEST_IDS.COMMENT_WINDOW_TITLE)).toBeFocused()
    await page.keyboard.press('Alt+Shift+F9')
    await expect(stepper).toContainText('1 of 2')

    // Resolve and next: one write, then the other comment – the last open one, so no stepper.
    await win.getByTestId(TEST_IDS.COMMENT_RESOLVE_NEXT).click()
    await expect(md.announce()).toHaveText('Comment resolved.', { timeout: MD_COMMENT_BUDGET_MS })
    await expect(stepper).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
    await win.getByTestId(TEST_IDS.COMMENT_RESOLVE).click()
    await expect(win.getByTestId(TEST_IDS.COMMENT_ALL_DONE)).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await expect(win.getByTestId(TEST_IDS.COMMENT_CLOSE)).toBeFocused()
  })

  test('C-18 (Markdown) the comment window is non-modal: F6 moves between it and the preview, Esc closes it', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)
    await md.modeOn()
    await md.target('p', 3).click()
    const win = md.window()
    await md.passIdentity(NAME)
    await expect(win).toHaveAttribute('role', 'dialog')
    await expect(win).not.toHaveAttribute('aria-modal', 'true')
    await expect(win).toHaveClass(/erf-comment-window--docked/)
    // C-18: placed in viewport pixels inside dockview's `contain: layout` grid, the window still overlaps the
    // preview pane – it once landed shifted right by the grid's offset, off the pane under the activity bar.
    const [winBox, paneBox] = [await win.boundingBox(), await md.preview().boundingBox()]
    expect(winBox).not.toBeNull()
    expect(paneBox).not.toBeNull()
    expect(winBox!.x).toBeLessThan(paneBox!.x + paneBox!.width)
    expect(winBox!.x + winBox!.width).toBeGreaterThan(paneBox!.x)
    // No occluder: the preview is not covered while the window is open.
    await expect(page.locator('.dialog-overlay')).toHaveCount(0)
    const field = win.getByTestId(TEST_IDS.COMMENT_NEW_FIELD)
    await expect(field).toBeFocused()
    await field.fill(NOTE)
    await page.keyboard.press('F6')
    await expect(md.preview()).toBeFocused()
    await page.keyboard.press('F6')
    await expect(field).toBeFocused()
    await expect(field).toHaveValue(NOTE)
    await page.keyboard.press('Escape')
    await expect(win).toHaveCount(0, { timeout: MD_COMMENT_BUDGET_MS })
  })

  test('024-AC-001 (Markdown) pins sit at their targets and commented words are underlined', async ({
    windowWithTestProject
  }) => {
    const page = windowWithTestProject
    const md = await openReview(page)

    // Words in the first paragraph, from the right-click menu; then the whole closing paragraph, picked in comment mode.
    const at = await md.selectWords('p', 3, 'paragraph of')
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await page.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION).click()
    await md.saveNewComment(NOTE, FILE, NAME)
    await md.modeOn()
    // The first block moved the lines: find the paragraph by its text.
    await md.content().locator('p', { hasText: 'Closing paragraph.' }).click()
    await expect(page.getByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.saveNewComment(NOTE, FILE, NAME)
    await md.modeButton().click()
    await expect(md.modeButton()).toHaveAttribute('aria-pressed', 'false')
    await expect(md.icons()).toHaveCount(2, { timeout: MD_COMMENT_BUDGET_MS })

    // Pins: each icon names its block (aria-details, C-11), and sits where the shared pin rule puts it
    // for that block's box – the HTML overlay's rule (overlayCore/pinLayout) – and takes the hit there.
    const drawn = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="comment-host-overlay"]')!.getBoundingClientRect()
      const box = (r: DOMRect) => ({ left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height })
      return {
        viewport: { width: host.width, height: host.height },
        pins: [...document.querySelectorAll<HTMLElement>('[data-testid="comment-host-icon"]')].map(icon => {
          const block = document.querySelector(`[aria-details="${icon.id}"]`)
          const r = icon.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return {
            icon: box(r),
            block: block === null ? null : box(block.getBoundingClientRect()),
            text: block?.textContent?.trim() ?? null,
            hit: hit !== null && icon.contains(hit)
          }
        })
      }
    })
    expect(drawn.pins.map(pin => pin.text)).toEqual(['First paragraph of the review.', 'Closing paragraph.'])
    const placed: Box[] = []
    for (const pin of drawn.pins) {
      const expected = placePin(pin.block!, placed, drawn.viewport, PIN_BOX_PX)
      expect(expected, `${pin.text}: the pin rule places no pin`).not.toBeNull()
      placed.push(expected!)
      for (const side of ['left', 'top', 'width', 'height'] as const) {
        expect(Math.abs(pin.icon[side] - expected![side]), `${pin.text}: pin ${side}`).toBeLessThanOrEqual(1)
      }
      expect(pin.hit, `${pin.text}: the pin does not take the hit at its centre`).toBe(true)
    }

    // The underline: the commented words – and only they – carry the comment mark, inside their paragraph,
    // and the mark is drawn as an underline (D-08: a CSS custom highlight in the Markdown Preview).
    await expect.poll(() => md.markedWords(), { timeout: MD_COMMENT_BUDGET_MS }).toEqual(['paragraph of'])
    const mark = await page.evaluate(() => {
      const range = [...CSS.highlights.get('erf-comment')!][0] as Range
      const words = range.getBoundingClientRect()
      const block = range.startContainer.parentElement!.closest('p')!.getBoundingClientRect()
      const rule = [...document.styleSheets]
        .flatMap(sheet => {
          try {
            return [...sheet.cssRules]
          } catch {
            return []
          }
        })
        .find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText.includes('::highlight(erf-comment)'))
      return {
        inBlock:
          words.width > 0 &&
          words.left >= block.left - 1 &&
          words.right <= block.right + 1 &&
          words.top >= block.top - 1 &&
          words.bottom <= block.bottom + 1,
        decoration: rule?.style.cssText ?? ''
      }
    })
    expect(mark.inBlock, 'the marked words are not inside their paragraph').toBe(true)
    expect(mark.decoration).toMatch(/text-decoration:\s*underline/)
  })
})
