// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – large-file timing (spec 024 024-NFR-001,
 * 024-AC-024): the Markdown half. HTML's half is the shipped gate F-001 in
 * `html-preview-comments.perf.e2e.ts`, which stays as it is.
 *
 * The fixture is the seeded generator of the main-side timing run
 * (`largeFixtures.ts`): about 1 MB of Markdown with 200 comments. Each of the
 * 20 samples opens the file in a fresh tab and saves one new comment:
 *
 * - **pins** – from the `erfana:comments:preview-rendered` mark (the preview
 *   committed the document) to `erfana:comments:pins-visible` (the overlay
 *   drew the list's icons);
 * - **save** – from `erfana:comments:save-start` (Save pressed) to
 *   `erfana:comments:saved-visible` (the new thread's icon is drawn).
 *
 * Every sample gets a cold comment read: the file is written again before
 * each open with one sample line appended, so main's parse cache (keyed by
 * the content) never answers from an earlier sample.
 *
 * The numbers are recorded first – an `MD-TIMING {…}` line on stdout, a test
 * annotation and a JSON attachment – then gated where 024-NFR-001 says: P50
 * and P95 of pins ≤ 500 ms and of save ≤ 1,000 ms on macOS and Linux. Windows
 * records only. Markdown is over budget for now (owner decision 2026-10-30;
 * verification/known-limits.md), so the macOS/Linux gate fails until the
 * owner sets the final budget.
 *
 * "Reading comments…" while the list loads is not checked here: the read now
 * runs while the preview renders, and the renderer is busy rendering until the
 * read is nearly done, so a click on the count lands after the answer (seen on
 * the Windows host). `MarkdownComments.timing.test.tsx` holds the read open and
 * checks the drawer says it.
 *
 * Local gate only (e2e is not a required check). Condition-based waits only:
 * every wait polls the marks or the DOM.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { MarkdownCommentsPage } from './pages/markdown-comments.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { reviewer, setGlobalSetting } from './pages/html-preview.comments-ui'
import { COMMENT_TIMING_MARKS } from '../src/renderer/src/components/Comments/overlay/commentTiming'
import { LARGE_FILE_COMMENTS, largeMarkdown } from '../src/main/services/comments/corpus/__test-helpers__/largeFixtures'

const FILE = 'large.md'
const NAME = 'Reviewer Timing Md24'
const SAMPLES = 20
/** 024-NFR-001: P50 and P95 of each measure. */
const PINS_BUDGET_MS = 500
const SAVE_BUDGET_MS = 1_000
/** 024-NFR-001 gates macOS and Linux; Windows numbers are recorded, not gated. */
const GATED = process.platform !== 'win32'
/**
 * Longest one open or one save may take before the sample is called lost: a
 * guard, not a wait for state. The Windows host reads the file's comments in
 * about 3.5 s main-side (verification/large-file-timing.md).
 */
const STEP_GUARD_MS = 60_000

const MARKS = Object.values(COMMENT_TIMING_MARKS)

test.use({ testProjectFiles: { [FILE]: '# Placeholder\n' } })

/** Nearest-rank percentile, as F-001 computes it. */
function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

const round = (ms: number): number => Math.round(ms * 10) / 10

/** Forget the four marks, so the next reads belong to this sample. */
async function clearMarks(page: Page): Promise<void> {
  await page.evaluate(names => names.forEach(name => performance.clearMarks(name)), MARKS)
}

/** The latest mark of `name`, `null` before there is one. */
async function markAt(page: Page, name: string): Promise<number | null> {
  return page.evaluate(n => performance.getEntriesByName(n, 'mark').at(-1)?.startTime ?? null, name)
}

/** Wait for the mark `name`; return its time. */
async function waitForMark(page: Page, name: string, what: string): Promise<number> {
  await expect.poll(() => markAt(page, name), { timeout: STEP_GUARD_MS, message: `no ${what} mark (${name})` }).not.toBeNull()
  return (await markAt(page, name)) as number
}

interface Summary {
  readonly samples: number[]
  readonly p50: number
  readonly p95: number
  readonly max: number
  readonly budgetMs: number
}

function summary(samples: number[], budgetMs: number): Summary {
  return { samples, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples), budgetMs }
}

/** Record the run: stdout (`MD-TIMING {…}`), a test annotation and a JSON attachment. */
async function record(info: TestInfo, data: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ id: '024-AC-024', kind: 'markdown', platform: process.platform, arch: process.arch, gated: GATED, ...data })
  console.log(`MD-TIMING ${line}`)
  info.annotations.push({ type: '024-AC-024', description: line })
  const file = info.outputPath('markdown-comments-timing.json')
  await fsp.writeFile(file, `${line}\n`, 'utf-8')
  await info.attach('markdown-comments-timing', { path: file, contentType: 'application/json' })
}

test.describe('Markdown Preview comments – large-file timing (024-NFR-001)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await setGlobalSetting(windowWithTestProject, 'comments', { identityNoticeSeen: false })
    await setGlobalSetting(windowWithTestProject, 'markdownPreview', { comments: { enabled: true } })
  })

  test(`024-AC-024 Markdown: ${SAMPLES} samples on 1 MB with ${LARGE_FILE_COMMENTS} comments – pins after preview-rendered and Save to saved comment, P50 and P95 (gated on macOS/Linux)`, async ({
    windowWithTestProject,
    testProject
  }, testInfo) => {
    test.setTimeout(1_800_000)
    const page = windowWithTestProject
    const md = new MarkdownCommentsPage(page)
    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const file = path.join(testProject.path, FILE)
    const { text } = largeMarkdown()
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    await setGlobalSetting(page, 'markdownPreview', { comments: { enabled: true } })

    const pins: number[] = []
    const openToPins: number[] = []
    const saves: number[] = []
    for (let i = 1; i <= SAMPLES; i += 1) {
      // A fresh 200-comment file with this sample's own last line: a cold comment read every time.
      const content = `${text}\nTiming sample ${i}.\n`
      await fsp.writeFile(file, content, 'utf-8')
      await clearMarks(page)

      const openedAt = await page.evaluate(() => performance.now())
      await tree.fileRow(FILE).click()
      const pinsAt = await waitForMark(page, COMMENT_TIMING_MARKS.pinsVisible, 'pins-visible')
      const renderedAt = await waitForMark(page, COMMENT_TIMING_MARKS.previewRendered, 'preview-rendered')
      await expect(md.icons().first()).toBeVisible()
      pins.push(round(pinsAt - renderedAt))
      openToPins.push(round(pinsAt - openedAt))

      // Save one new comment on the first list item (no comment on it: the fixture comments paragraphs and headings).
      await md.modeOn()
      await md.content().locator('li').first().click()
      await md.passIdentity(NAME)
      await page.getByTestId('comment-new-field').fill(`Timing note ${i}`)
      await clearMarks(page)
      await page.getByTestId('comment-save').click()
      const savedAt = await waitForMark(page, COMMENT_TIMING_MARKS.savedVisible, 'saved-visible')
      const startedAt = await waitForMark(page, COMMENT_TIMING_MARKS.saveStart, 'save-start')
      saves.push(round(savedAt - startedAt))
      await expect(md.window()).toHaveCount(0, { timeout: STEP_GUARD_MS })
      await expect(md.announce()).toHaveText(`Comment saved to ${FILE}.`, { timeout: STEP_GUARD_MS })
      expect(await fsp.readFile(file, 'utf-8')).toContain(`Timing note ${i}`)

      await tabs.closeButton(FILE).click()
      await tabs.waitForTabGone(FILE)
    }

    expect(pins).toHaveLength(SAMPLES)
    expect(saves).toHaveLength(SAMPLES)
    const pinsSummary = summary(pins, PINS_BUDGET_MS)
    const saveSummary = summary(saves, SAVE_BUDGET_MS)
    // Recorded first, so a run over budget still leaves its numbers behind.
    await record(testInfo, {
      bytes: Buffer.byteLength(text, 'utf-8'),
      comments: LARGE_FILE_COMMENTS,
      pins: pinsSummary,
      save: saveSummary,
      openToPins: summary(openToPins, PINS_BUDGET_MS)
    })
    if (GATED) {
      expect(pinsSummary.p50, '024-NFR-001 pins P50').toBeLessThanOrEqual(PINS_BUDGET_MS)
      expect(pinsSummary.p95, '024-NFR-001 pins P95').toBeLessThanOrEqual(PINS_BUDGET_MS)
      expect(saveSummary.p50, '024-NFR-001 save P50').toBeLessThanOrEqual(SAVE_BUDGET_MS)
      expect(saveSummary.p95, '024-NFR-001 save P95').toBeLessThanOrEqual(SAVE_BUDGET_MS)
    }
  })
})
