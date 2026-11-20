// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 burst and partial-file gates (plan § 5.4, step S20).
 *
 * - **P2** – an agent rewrites a file every 150 ms for 10 s while its tab is
 *   visible (editor, Markdown preview, image, HTML preview). The tab shows
 *   its first version within 1 s of the first write, never goes more than
 *   1 s without showing a newer one, and ends on the last version written.
 *   An unedited editor keeps its scroll position and cursor line, and the
 *   Markdown preview keeps its scroll, through the whole burst (F15).
 * - **P3** – a tab never shows a partial file: temp file + rename bursts, a
 *   slow in-place stream (200 KB in 20 chunks, 20 ms apart) and a 7 s stream,
 *   longer than the write gate's 5 s cap (F8). Every version a tab shows
 *   carries its `END-` tag; the final one is complete.
 *
 * What a tab shows is recorded page-side by `VersionSamplerPage` (editor
 * model, preview text, image bytes); the HTML preview page logs its own loads
 * into `window.name`, which outlives a reload of the same page. The `timing` project runs this alone, with one worker:
 * `npx playwright test --project=timing --no-deps e2e/file-freshness-burst.timing.e2e.ts`.
 * Waits are condition-based only; the writers' own pacing is the scenario.
 */
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { ImageViewerPage } from './pages/image-viewer.page'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { VersionSamplerPage, type VersionSample } from './pages/version-sampler.page'
import { writeBenchRecord } from './utils/bench-stats'
import { longestPause, writeBurst, writeStream, writeTempRename } from './utils/freshness-writers'
import {
  HTML_LOAD_LOG_KEY,
  burstVerdict,
  linesForBytes,
  versionId,
  versionedDoc,
  versionedHtml,
  versionedSvg,
  type BurstVerdict,
  type HtmlLoad
} from './utils/freshness-docs'

/** P2: one write every 150 ms for 10 s. */
const BURST_EVERY_MS = 150
const BURST_WRITES = 67
/** P2: first version shown, and longest time between two shown versions. */
const BURST_GAP_BUDGET_MS = 1_000
/** How long the last version of a burst or stream is given to show. */
const SETTLE_BUDGET_MS = 5_000
/** P2 document: long enough to scroll well past its version tag. */
const BURST_DOC_LINES = 400
/** P2 editor: PageDown presses that take the cursor and the view well past the tag. */
const PAGE_DOWNS = 5
/** P3: 200 KB written in 20 chunks, 20 ms apart. */
const STREAM_BYTES = 200_000
const STREAM_CHUNKS = 20
const STREAM_GAP_MS = 20
/** P3 (F8): a stream longer than the 5 s write-gate cap, with gaps well under the 75 ms settle. */
const LONG_STREAM_MS = 7_000
const LONG_STREAM_GAP_MS = 25
/** P3 temp + rename burst: versions and pacing. */
const RENAME_WRITES = 10
const RENAME_EVERY_MS = 150
const CASE_TIMEOUT_MS = 120_000

test.use({
  testProjectFiles: {
    'burst.md': versionedDoc('start', BURST_DOC_LINES),
    'big.md': versionedDoc('start', linesForBytes(STREAM_BYTES)),
    'burst.svg': versionedSvg('start'),
    'big.svg': versionedSvg('start', STREAM_BYTES),
    'burst.html': versionedHtml('start')
  }
})

/** Opens a Markdown file from the tree and waits for the panel. */
async function openMarkdown(page: Page, name: string): Promise<EditorPanelPage> {
  await new ProjectTreePage(page).fileRow(name).click()
  await new TabBarPage(page).waitForTab(name)
  const panel = new EditorPanelPage(page)
  await panel.waitForReady()
  return panel
}

/** Records the verdict, then asserts the P2 budget on it. */
async function expectBurstGate(name: string, ids: readonly string[], verdict: BurstVerdict): Promise<void> {
  await writeBenchRecord(`file-freshness-p2-${name}`, { summary: verdict, writes: ids.length, everyMs: BURST_EVERY_MS })
  expect(verdict.partial, `P2 ${name}: partial versions shown`).toEqual([])
  expect(verdict.firstShownMs, `P2 ${name}: first version shown after ${verdict.firstShownMs} ms`).toBeLessThanOrEqual(
    BURST_GAP_BUDGET_MS
  )
  expect(verdict.longestGapMs, `P2 ${name}: ${verdict.longestGapMs} ms without a newer version`).toBeLessThanOrEqual(
    BURST_GAP_BUDGET_MS
  )
  expect(verdict.lastShown, `P2 ${name}: last version shown`).toBe(ids[ids.length - 1])
}

/**
 * P3: nothing partial was shown, and the last version showed complete.
 * `streams` are the chunk times of each stream written: a failure names the
 * longest writer pause, since a pause past the 75 ms settle is a documented
 * limit rather than a defect.
 */
function expectNoPartial(
  name: string,
  samples: readonly VersionSample[],
  lastId: string,
  streams: Record<string, readonly number[]> = {}
): void {
  const pauses = Object.entries(streams).map(([stream, times]) => `${stream} ${longestPause(times)} ms`)
  const partial = samples.filter((s) => !s.complete)
  const detail = partial.map((s) => {
    const stream = Object.entries(streams).find(([, times]) => s.at >= times[0] - 50 && s.at <= times[times.length - 1] + 500)
    return `${s.id ?? '(no tag)'}@${stream ? `${stream[0]}+${s.at - stream[1][0]}ms` : s.at}`
  })
  expect(partial.map((s) => s.id ?? '(no tag)'), `P3 ${name}: partial versions shown (${detail.join(', ')}); longest writer pause: ${pauses.join(', ')}`).toEqual([])
  expect(samples[samples.length - 1], `P3 ${name}: final version`).toMatchObject({ id: lastId, complete: true })
}

/** Splits `text` into `count` nearly equal chunks. */
function chunks(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count)
  return Array.from({ length: count }, (_, i) => text.slice(i * size, (i + 1) * size)).filter((c) => c.length > 0)
}

/** Every load the HTML preview page logged. */
async function htmlLoads(preview: HtmlPreviewPage): Promise<HtmlLoad[]> {
  const raw = await preview.eval('window.name')
  if (!raw) return []
  const log = JSON.parse(raw) as Record<string, HtmlLoad[] | undefined>
  return log[HTML_LOAD_LOG_KEY] ?? []
}

/** Opens `burst.html` and waits until its first load is logged. */
async function openHtml(page: Page, preview: HtmlPreviewPage): Promise<void> {
  await preview.open('burst.html')
  await preview.waitForTitled('V-start')
  await expect
    .poll(async () => (await htmlLoads(preview)).length, { message: 'setup: the page logs its loads in window.name' })
    .toBeGreaterThan(0)
  await page.bringToFront()
}

/** Waits until the HTML preview logged a load of `id`, then returns every load as samples. */
async function htmlSamples(preview: HtmlPreviewPage, id: string): Promise<VersionSample[]> {
  await expect
    .poll(async () => (await htmlLoads(preview)).some((l) => l.id === id), {
      timeout: SETTLE_BUDGET_MS,
      message: `the HTML preview never loaded ${id}`
    })
    .toBe(true)
  return (await htmlLoads(preview)).map((l) => ({ at: l.at, id: l.id, complete: l.complete }))
}

test.describe('#478 P2: a burst of outside writes reaching a visible tab', () => {
  test('editor: shown at least every second, ends on the last write, keeps scroll and cursor line', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const panel = await openMarkdown(page, 'burst.md')
    await panel.setViewMode('editor')
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    await monaco.waitForReady()
    await monaco.focus()

    // Page well past the version tag: the cursor and the scroll move down together
    for (let i = 0; i < PAGE_DOWNS; i++) await page.keyboard.press('PageDown')
    await expect.poll(async () => (await monaco.viewState()).scrollTop, { message: 'setup: the editor scrolls' }).toBeGreaterThan(200)
    await expect.poll(async () => (await monaco.viewState()).cursorLine, { message: 'setup: the cursor moves down' }).toBeGreaterThan(20)
    const before = await monaco.viewState()

    const sampler = new VersionSamplerPage(page)
    await sampler.start('editor')
    const ids = Array.from({ length: BURST_WRITES }, (_, i) => versionId('p2e', i))
    const file = join(testProject.path, 'burst.md')
    const writtenAt = await writeBurst(file, BURST_WRITES, BURST_EVERY_MS, (i) => versionedDoc(ids[i], BURST_DOC_LINES))
    await sampler.waitForComplete(ids[ids.length - 1], SETTLE_BUDGET_MS)
    await expectBurstGate('editor', ids, burstVerdict(ids, writtenAt, await sampler.stop()))

    expect(await monaco.viewState(), 'F15: an unedited tab keeps its scroll position and cursor line').toEqual(before)
    await expect(new FileFreshnessPage(page, app).conflictNotice()).toHaveCount(0)
    await expect(panel.modifiedIndicator()).toHaveCount(0)
  })

  test('Markdown preview: shown at least every second, ends on the last write, keeps its scroll', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const panel = await openMarkdown(page, 'burst.md')
    await panel.setViewMode('preview')
    await expect(panel.previewPane()).toContainText('END-start')
    const top = await panel.scrollPreviewTo(2_000)
    expect(top, 'setup: the preview scrolls').toBeGreaterThan(500)

    const sampler = new VersionSamplerPage(page)
    await sampler.start('preview')
    const ids = Array.from({ length: BURST_WRITES }, (_, i) => versionId('p2m', i))
    const file = join(testProject.path, 'burst.md')
    const writtenAt = await writeBurst(file, BURST_WRITES, BURST_EVERY_MS, (i) => versionedDoc(ids[i], BURST_DOC_LINES))
    await sampler.waitForComplete(ids[ids.length - 1], SETTLE_BUDGET_MS)
    await expectBurstGate('markdown-preview', ids, burstVerdict(ids, writtenAt, await sampler.stop()))

    expect(Math.abs((await panel.previewScrollTop()) - top), 'F15: the preview keeps its scroll').toBeLessThanOrEqual(1)
  })

  test('image: shown at least every second, ends on the last write', async ({ windowWithTestProject: page, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    await new ImageViewerPage(page).openFromTree('burst.svg')
    const sampler = new VersionSamplerPage(page)
    await sampler.start('image')
    const ids = Array.from({ length: BURST_WRITES }, (_, i) => versionId('p2i', i))
    const file = join(testProject.path, 'burst.svg')
    const writtenAt = await writeBurst(file, BURST_WRITES, BURST_EVERY_MS, (i) => versionedSvg(ids[i]))
    await sampler.waitForComplete(ids[ids.length - 1], SETTLE_BUDGET_MS)
    await expectBurstGate('image', ids, burstVerdict(ids, writtenAt, await sampler.stop()))
  })

  test('HTML preview: shown at least every second, ends on the last write', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const preview = new HtmlPreviewPage(page, app)
    await openHtml(page, preview)
    const ids = Array.from({ length: BURST_WRITES }, (_, i) => versionId('p2h', i))
    const file = join(testProject.path, 'burst.html')
    const writtenAt = await writeBurst(file, BURST_WRITES, BURST_EVERY_MS, (i) => versionedHtml(ids[i]))
    const samples = await htmlSamples(preview, ids[ids.length - 1])
    await expectBurstGate('html-preview', ids, burstVerdict(ids, writtenAt, samples))
  })
})

test.describe('#478 P3: a tab never shows a partial file', () => {
  test('editor: temp file + rename, a slow 200 KB stream and a 7 s stream', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const panel = await openMarkdown(page, 'big.md')
    await panel.setViewMode('editor')
    await new MonacoPage(page, new KeyboardHelper(page)).waitForReady()
    const sampler = new VersionSamplerPage(page)
    const file = join(testProject.path, 'big.md')
    const lines = linesForBytes(STREAM_BYTES)
    await sampler.start('editor')
    await sampler.waitForComplete('start')

    const renames = Array.from({ length: RENAME_WRITES }, (_, i) => versionId('p3r', i))
    await writeBurst(file, RENAME_WRITES, RENAME_EVERY_MS, (i) => versionedDoc(renames[i], lines), writeTempRename)
    await sampler.waitForComplete(renames[renames.length - 1], SETTLE_BUDGET_MS)

    const slow = await writeStream(file, chunks(versionedDoc('p3s000', lines), STREAM_CHUNKS), STREAM_GAP_MS)
    await sampler.waitForComplete('p3s000', SETTLE_BUDGET_MS)

    const long = versionedDoc('p3l000', lines)
    const longAt = await writeStream(file, chunks(long, Math.ceil(LONG_STREAM_MS / LONG_STREAM_GAP_MS)), LONG_STREAM_GAP_MS)
    await sampler.waitForComplete('p3l000', SETTLE_BUDGET_MS)
    expectNoPartial('editor', await sampler.stop(), 'p3l000', { slow, long: longAt })
  })

  test('image: temp file + rename and a slow 200 KB stream', async ({ windowWithTestProject: page, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const viewer = new ImageViewerPage(page)
    await viewer.openFromTree('big.svg')
    const sampler = new VersionSamplerPage(page)
    const file = join(testProject.path, 'big.svg')
    await sampler.start('image')
    await sampler.waitForComplete('start')

    const renames = Array.from({ length: RENAME_WRITES }, (_, i) => versionId('p3r', i))
    await writeBurst(file, RENAME_WRITES, RENAME_EVERY_MS, (i) => versionedSvg(renames[i], STREAM_BYTES), writeTempRename)
    await sampler.waitForComplete(renames[renames.length - 1], SETTLE_BUDGET_MS)

    const slow = await writeStream(file, chunks(versionedSvg('p3s000', STREAM_BYTES), STREAM_CHUNKS), STREAM_GAP_MS)
    await sampler.waitForComplete('p3s000', SETTLE_BUDGET_MS)
    expectNoPartial('image', await sampler.stop(), 'p3s000', { slow })
    await viewer.expectNoBanner()
  })

  test('HTML preview: temp file + rename', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const preview = new HtmlPreviewPage(page, app)
    await openHtml(page, preview)
    const ids = Array.from({ length: RENAME_WRITES }, (_, i) => versionId('p3h', i))
    const file = join(testProject.path, 'burst.html')
    await writeBurst(file, RENAME_WRITES, RENAME_EVERY_MS, (i) => versionedHtml(ids[i], STREAM_BYTES), writeTempRename)
    expectNoPartial('html-preview', await htmlSamples(preview, ids[ids.length - 1]), ids[ids.length - 1])
  })
})
