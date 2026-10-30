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

const FILE = 'review.md'
const TEXT = [
  '# Review',
  '',
  'First paragraph of the review.',
  '',
  '- alpha',
  '- beta',
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
    await expect(md.announce()).toHaveText('Comment re-opened.', { timeout: MD_COMMENT_BUDGET_MS })

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
    await expect(md.announce()).toHaveText('Showing paragraph, line 3.')
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

    // Focus came back to the list item; Esc leaves comment mode for the toggle.
    await expect(md.target('li', 5)).toBeFocused({ timeout: MD_COMMENT_BUDGET_MS })
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
})
