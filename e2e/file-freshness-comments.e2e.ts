// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 C4: the comment watch on a document follows outside edits. A comment
 * block removed by another tool takes its icon with it and the drawer says so;
 * the block written back outside is listed again – without reopening the tab.
 * (Rewriting a block's text by hand breaks its integrity data, which the
 * drawer rightly reports as a problem, so the round trip uses whole blocks.)
 *
 * Kept beside, not inside, `markdown-preview-comments.e2e.ts` (already
 * ~1,100 lines); it reuses that suite's Page Object and settings helpers.
 * Condition-based waits only.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { test, expect } from './fixtures/index'
import { MarkdownCommentsPage, MD_COMMENT_BUDGET_MS } from './pages/markdown-comments.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { setGlobalSetting } from './pages/html-preview.comments-ui'
import { writeInPlace } from './utils/freshness-writers'

const FILE = 'review.md'
const TEXT = '# Review\n\nFirst paragraph of the review.\n\nClosing paragraph.\n'
const NAME = 'Reviewer Fr478 Qx31'
const NOTE = 'Note-478-before: tighten this paragraph'

test.use({ testProjectFiles: { [FILE]: TEXT } })

test.describe('#478 C4: comments follow the document on disk', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await setGlobalSetting(windowWithTestProject, 'comments', { identityNoticeSeen: false })
  })

  test('a comment block removed outside goes from the preview; written back outside, it is listed again', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const file = join(testProject.path, FILE)
    const md = new MarkdownCommentsPage(page)
    await new ProjectTreePage(page).fileRow(FILE).click()
    await md.editor.waitForReady()
    await expect(md.target('p', 3)).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.waitForComments()

    await md.modeOn()
    await md.target('p', 3).click()
    await expect(md.window()).toBeVisible({ timeout: MD_COMMENT_BUDGET_MS })
    await md.saveNewComment(NOTE, FILE, NAME)
    await expect(md.icons()).toHaveCount(1, { timeout: MD_COMMENT_BUDGET_MS })
    await md.modeButton().click()

    const withComment = await readFile(file, 'utf-8')
    expect(withComment, 'setup: the note is on disk').toContain(NOTE)

    // Another tool drops the block (a branch switch, an agent cleaning up): the icon goes,
    // and the drawer says the comment was removed outside Erfana
    await writeInPlace(file, TEXT)
    await expect(md.icons(), 'C4: the icon stayed after the block was removed outside').toHaveCount(0, {
      timeout: MD_COMMENT_BUDGET_MS
    })
    await md.listButton().click()
    await expect(md.drawer()).toContainText('was removed from review.md outside Erfana', { timeout: MD_COMMENT_BUDGET_MS })

    // The block written back outside (the branch switched back): the comment is listed again
    await writeInPlace(file, withComment)
    await expect(md.icons(), 'C4: the comment written back outside never came back').toHaveCount(1, {
      timeout: MD_COMMENT_BUDGET_MS
    })
    await expect(md.drawer()).toContainText(NOTE, { timeout: MD_COMMENT_BUDGET_MS })
  })
})
