// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 P1 latency gate: how long one outside write takes to show in an open
 * tab (plan § 5.4; baseline taken at S0, gate since S20).
 *
 * Each case writes 30 times, each with a unique marker; `t0` is `Date.now()`
 * right after the write call returns, and the seen time is the page's own
 * `Date.now()` when the marker first appears (`FileFreshnessPage`'s recorder;
 * for the HTML preview, the page stamps its load time into its title, and for
 * its linked stylesheet, the time the new style first applies). The
 * next write waits for the previous marker, so runs never overlap. Every case
 * writes a JSON record with `writeBenchRecord('file-freshness-p1-<case>')`.
 *
 * - Editor, image and Markdown preview image: p50 ≤ 250 ms and p95 ≤ 400 ms.
 *   At S0 they were ~650 ms (editor, image) and ~400 ms (Markdown image), so
 *   they started as gap tests; S20 made them this plain gate (T1).
 * - HTML preview: must not get slower. Its S0 numbers ({@link HTML_PREVIEW_S0})
 *   plus the owner-accepted settle cost give the reference
 *   ({@link HTML_PREVIEW_REFERENCE}); the gate is p50 ≤ reference + max(15 %, 20 ms),
 *   asserted on local Windows only, where the reference was taken. A change to
 *   the page's linked stylesheet (C3) is held to the same gate.
 *
 * The `timing` project runs this alone, with one worker:
 * `npx playwright test --project=timing --no-deps e2e/file-freshness-latency.timing.e2e.ts`.
 * The burst and partial-file gates (P2, P3) are in
 * `file-freshness-burst.timing.e2e.ts`.
 * Waits are condition-based only.
 */
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { ImageViewerPage } from './pages/image-viewer.page'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { machine, summarise, writeBenchRecord, type LatencySummary } from './utils/bench-stats'
import { runGit } from './utils/git-helpers'
import { writeInPlace, writeTempRename } from './utils/freshness-writers'

const RUNS = 30
/** P1 budget for editor, image and Markdown preview image tabs. */
const P50_BUDGET_MS = 250
const P95_BUDGET_MS = 400
/** One write showing at all; far above the gate, so a miss reports its number. */
const RUN_TIMEOUT_MS = 10_000
const CASE_TIMEOUT_MS = 240_000
/** One warm-up write showing, before the next is tried. */
const WARM_RETRY_MS = 3_000

/**
 * The HTML preview's P1 reference, taken at S0 on the machine below; the
 * preview must not get slower than this (plus margin) after #478.
 */
const HTML_PREVIEW_S0 = {
  p50: 138,
  p95: 153,
  os: 'Windows 11 Pro 10.0.26300 (win32-x64)',
  commit: '866cb76a',
  date: '2026-11-17'
} as const

/**
 * The reference the gate holds the HTML preview to. #478 adds the settle wait
 * that keeps a half-written page from showing, which costs about 14 ms over
 * {@link HTML_PREVIEW_S0} (median p50 151.5 ms over 20 Windows runs). The owner
 * accepted that cost on 2026-11-19 (ADR 0013, technical-debt #72), so the
 * reference is the measured #478 level; the gate still fails on any slowdown
 * beyond its margin.
 */
const HTML_PREVIEW_REFERENCE = {
  p50: 152,
  os: HTML_PREVIEW_S0.os,
  date: '2026-11-19',
  acceptedOver: HTML_PREVIEW_S0
} as const

test.use({
  testProjectFiles: {
    'notes.md': '# Notes\n\nstart\n',
    'icon.svg': svg('img-start'),
    'with-image.md': '# With image\n\n![pic](pic.svg)\n',
    'pic.svg': svg('pic-start'),
    'page.html': html('page-start'),
    'styled.html': styledHtml(),
    'style.css': css('css-start')
  }
})

/** An SVG carrying `marker` in `data-marker`. */
function svg(marker: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="64" height="64" viewBox="0 0 64 64">` +
    '<rect width="64" height="64" fill="#1f1f1f"/></svg>\n'
  )
}

/** A page titled `marker`, which appends its load time (`@<ms>`) to its title. */
function html(marker: string): string {
  return (
    `<!doctype html><html><head><title>${marker}</title>` +
    '<script>document.title = document.title + "@" + Date.now()</script>' +
    `</head><body><p>${marker}</p></body></html>\n`
  )
}

/**
 * A page linked to `style.css`. Every frame it reads the stylesheet's
 * `--marker`; when that changes (first load, an in-place swap or a reload),
 * it sets its title to `<marker>@<ms>`, the time the new style applied.
 */
function styledHtml(): string {
  return (
    '<!doctype html><html><head><title>styled</title><link rel="stylesheet" href="style.css">' +
    '<script>(function () { var last = ""; function tick() {' +
    ' var m = getComputedStyle(document.documentElement).getPropertyValue("--marker").trim();' +
    ' if (m && m !== last) { last = m; document.title = m + "@" + Date.now() }' +
    ' requestAnimationFrame(tick) } requestAnimationFrame(tick) })()</script>' +
    '</head><body><p>styled</p></body></html>\n'
  )
}

/** A stylesheet carrying `marker` (a CSS identifier) in `--marker`. */
function css(marker: string): string {
  return `:root { --marker: ${marker}; }\n`
}

/** Commit the run was taken on. */
function commit(): string {
  return runGit(join(__dirname, '..'), 'rev-parse', '--short', 'HEAD')
}

/** Records the run, then returns its summary. */
async function record(name: string, samples: number[]): Promise<LatencySummary> {
  const summary = summarise(samples)
  await writeBenchRecord(`file-freshness-p1-${name}`, {
    summary,
    samples,
    machine: machine(),
    commit: commit(),
    date: new Date().toISOString()
  })
  return summary
}

/**
 * Writes `RUNS` versions with `write(marker)` and measures each one until
 * the page shows it.
 */
async function measure(fresh: FileFreshnessPage, prefix: string, write: (marker: string) => Promise<void>): Promise<number[]> {
  await fresh.installSeenRecorder()
  const samples: number[] = []
  for (let run = 0; run < RUNS; run++) {
    const marker = `${prefix}-${run}-${Date.now()}`
    await fresh.armMarker(marker)
    await write(marker)
    const t0 = Date.now()
    const seenAt = await fresh.waitForSeen(marker, RUN_TIMEOUT_MS)
    samples.push(Math.max(0, seenAt - t0))
  }
  return samples
}

/** The P1 gate for editor, image and Markdown preview image tabs. */
function expectP1(label: string, summary: LatencySummary): void {
  expect(summary.p50, `P1 ${label}: p50 ${summary.p50} ms > ${P50_BUDGET_MS}`).toBeLessThanOrEqual(P50_BUDGET_MS)
  expect(summary.p95, `P1 ${label}: p95 ${summary.p95} ms > ${P95_BUDGET_MS}`).toBeLessThanOrEqual(P95_BUDGET_MS)
}

/**
 * Waits until the preview's title reads `<marker>@<ms>` and returns `<ms>`,
 * the page's own time for it.
 */
async function waitForTitleStamp(preview: HtmlPreviewPage, marker: string, timeout = RUN_TIMEOUT_MS): Promise<number> {
  let stampedAt = Number.NaN
  await expect
    .poll(
      async () => {
        const title = (await preview.livePreviews()).map((p) => p.docTitle).find((t) => t.startsWith(`${marker}@`))
        stampedAt = title ? Number(title.slice(marker.length + 1)) : Number.NaN
        return Number.isFinite(stampedAt)
      },
      { timeout, intervals: [20], message: `the preview never showed ${marker}` }
    )
    .toBe(true)
  return stampedAt
}

/** The HTML preview's P1 gate: p50 within the accepted reference plus margin. */
function expectHtmlPreviewP1(label: string, summary: LatencySummary): void {
  // The reference was taken on local Windows; elsewhere the numbers are recorded only
  if (process.platform !== 'win32' || process.env.CI) return
  const allowed = HTML_PREVIEW_REFERENCE.p50 + Math.max(HTML_PREVIEW_REFERENCE.p50 * 0.15, 20)
  expect(summary.p50, `P1 ${label}: p50 ${summary.p50} ms > ${allowed} (accepted reference + margin)`).toBeLessThanOrEqual(allowed)
}

/** Opens a Markdown file from the tree in its default (preview) view. */
async function openMarkdown(page: Page, name: string): Promise<void> {
  await new ProjectTreePage(page).fileRow(name).click()
  await new TabBarPage(page).waitForTab(name)
  await new EditorPanelPage(page).waitForReady()
}

function freshness(page: Page, app: ElectronApplication): FileFreshnessPage {
  return new FileFreshnessPage(page, app)
}

test.describe('#478 P1: one outside write reaching a visible tab', () => {
  test('visible editor, in-place write', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const fresh = freshness(page, app)
    await openMarkdown(page, 'notes.md')
    const file = join(testProject.path, 'notes.md')
    const samples = await measure(fresh, 'edit-in-place', (marker) => writeInPlace(file, `# Notes\n\n${marker}\n`))
    expectP1('editor in place', await record('editor-in-place', samples))
  })

  test('visible editor, temp file + rename', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const fresh = freshness(page, app)
    await openMarkdown(page, 'notes.md')
    const file = join(testProject.path, 'notes.md')
    const samples = await measure(fresh, 'edit-rename', (marker) => writeTempRename(file, `# Notes\n\n${marker}\n`))
    expectP1('editor temp rename', await record('editor-temp-rename', samples))
  })

  test('visible image, in-place write', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const fresh = freshness(page, app)
    await new ImageViewerPage(page).openFromTree('icon.svg')
    const file = join(testProject.path, 'icon.svg')
    const samples = await measure(fresh, 'img', (marker) => writeInPlace(file, svg(marker)))
    expectP1('image in place', await record('image-in-place', samples))
  })

  test('Markdown preview image, in-place write', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const fresh = freshness(page, app)
    await openMarkdown(page, 'with-image.md')
    await fresh.installSeenRecorder()
    await fresh.armMarker('pic-start')
    await fresh.waitForSeen('pic-start')
    const file = join(testProject.path, 'pic.svg')
    const samples = await measure(fresh, 'pic', (marker) => writeInPlace(file, svg(marker)))
    expectP1('markdown image in place', await record('markdown-image-in-place', samples))
  })

  test('HTML preview, in-place write', async ({ windowWithTestProject: page, appWithTestProject: app, testProject }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const preview = new HtmlPreviewPage(page, app)
    await preview.open('page.html')
    await preview.waitForTitled('page-start@')
    const file = join(testProject.path, 'page.html')
    const samples: number[] = []
    for (let run = 0; run < RUNS; run++) {
      const marker = `page-${run}-${Date.now()}`
      await writeInPlace(file, html(marker))
      const t0 = Date.now()
      const loadedAt = await waitForTitleStamp(preview, marker)
      samples.push(Math.max(0, loadedAt - t0))
    }
    expectHtmlPreviewP1('HTML preview', await record('html-preview-in-place', samples))
  })

  test('HTML preview, linked stylesheet in-place write (C3)', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const preview = new HtmlPreviewPage(page, app)
    await preview.open('styled.html')
    await waitForTitleStamp(preview, 'css-start', PREVIEW_BUDGET_MS)
    const file = join(testProject.path, 'style.css')
    // Warm-up, not measured: a write that lands before the page's sub-file
    // watches are armed is not seen, so retry until one shows
    let warm = 0
    await expect(async () => {
      const marker = `css-warm-${++warm}`
      await writeInPlace(file, css(marker))
      await waitForTitleStamp(preview, marker, WARM_RETRY_MS)
    }).toPass({ timeout: PREVIEW_BUDGET_MS })
    const samples: number[] = []
    for (let run = 0; run < RUNS; run++) {
      const marker = `css-${run}-${Date.now()}`
      await writeInPlace(file, css(marker))
      const t0 = Date.now()
      const appliedAt = await waitForTitleStamp(preview, marker)
      samples.push(Math.max(0, appliedAt - t0))
    }
    expectHtmlPreviewP1('HTML preview stylesheet', await record('html-preview-css-in-place', samples))
  })
})
