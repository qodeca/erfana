// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – performance records (docs/designs/comments/
 * html-preview-comments.md §12.2 F-001 – F-003, §5.8, §19 R3-6, R3-12).
 *
 * Each test RECORDS its numbers – as a `HPC-PERF {…}` line on stdout and as a
 * test annotation – and asserts that every sample was taken. Only F-001 is
 * also gated, and only where §12.2 says:
 *
 * - **F-001** save → pin visible on the `slide-deck/` fixture, 20 samples,
 *   P95. Gated < 1,000 ms on macOS and Linux (§12.2, §16); on the emulated
 *   x64 Windows host it is record only (docs/windows/known-flakes.md, the
 *   perf rows). Timed from the Save click to the first capture that shows the
 *   new pin's body, so a sample includes one capture's latency.
 * - **F-002** the cost of a load on main for 0.5, 1, ~4 and ~25 MB pages (25 MB
 *   is the comment file limit, §19 Rev 4; three reloads of it per kind, five of
 *   the others) and a page
 *   with 10 same-project frames: the event-loop busy time (`performance.
 *   eventLoopUtilization`) and the longest stall (a 1 ms main-side probe)
 *   between a reload and its instrumented load(s) being registered. An upper
 *   bound of the parse's main-thread share: it also counts the load's IPC and
 *   this test's own polling. The control is the same page without its block,
 *   served raw with HTML comments turned off (OD-01 instruments every page
 *   while they are on). The unit-level gate on main-thread time per call
 *   is `commentFileJobs.perf.test.ts` (R3-12).
 * - **F-003** right-click → the element menu shown with the still frame in
 *   place (≤ 150 ms budget, R3-6), 20 samples; and 200 pins on a page while
 *   the pointer sweeps it at 60 Hz: long tasks over 50 ms and the longest
 *   animation-frame gap.
 *
 * Local gate only: e2e is disabled in CI. Waits are condition-based; the one
 * timer is the input cadence of the hover sweep (KNOWN_WAIT below).
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { commentLoads, newestLoad, waitForCommentLoad } from './pages/html-preview.comments'
import {
  CommentChrome,
  PIN_DRAWN_COVERAGE,
  centreOf,
  expectPin,
  clickElement,
  elementBox,
  mouseAt,
  openCommentPage,
  pinCoverage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  viewShown,
  waitForBox,
  waitForViewShown
} from './pages/html-preview.comments-ui'
import { manyCommentsPage, sizedPage } from './fixtures/html-preview-comments-pages'

const CORPUS = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'comments')
const corpus = (rel: string): string => fs.readFileSync(path.join(CORPUS, rel), 'utf-8')

const DECK = 'comments/slide-deck/index.html'
const STATIC = 'comments/static-design/index.html'
const MANY = 'comments/many.html'
const MB = 1024 * 1024
/** Timed reloads per page and kind (instrumented, raw). */
const RUNS = 5
/** Longest a timed reload of a page up to 4 MB may take: a guard, not a wait for state. */
const RELOAD_GUARD_MS = 20_000
/**
 * The 25 MB page (about 240,000 paragraphs) on the emulated Windows box: a
 * reload took 45–60 s served raw and 74–103 s instrumented, and the page's
 * renderer is too busy to answer a read for most of it. So it gets three runs
 * per kind, a 300 s reload guard and 300 s to show its title the first time.
 */
const LARGEST = { runs: 3, guardMs: 300_000, openMs: 300_000 }
const SMALL = { runs: RUNS, guardMs: RELOAD_GUARD_MS, openMs: PREVIEW_BUDGET_MS }
/**
 * The emulated Windows box (x64 Electron on a Windows 11 ARM VM) stalls main in
 * native code for 2–26 s on a 4 MB reload – with comments OFF as much as on;
 * a main-process CPU profile shows Erfana's own JS idle through it (spec 024
 * F-002, 2026-10-30, docs/windows/known-flakes.md). F-002 asserts no time –
 * it records – so there the guards and the first open are long enough to let
 * every run finish; the runs and what they record are unchanged.
 */
const EMULATED_WINDOWS = process.platform === 'win32'
const WIN_SMALL = { runs: RUNS, guardMs: 120_000, openMs: 120_000 }
const WIN_LARGEST = { runs: 3, guardMs: 600_000, openMs: 600_000 }
const small = EMULATED_WINDOWS ? WIN_SMALL : SMALL
const largest = EMULATED_WINDOWS ? WIN_LARGEST : LARGEST
const SIZES = [
  { label: '0.5 MB', rel: 'comments/size-05.html', bytes: MB / 2, ...small },
  { label: '1 MB', rel: 'comments/size-1.html', bytes: MB, ...small },
  // Just under the comment file limit before §19 Rev 4 (4 MB): the size the R3-12 gates were set at.
  { label: '4 MB', rel: 'comments/size-4.html', bytes: 4 * MB - 64 * 1024, ...small },
  // Just under the comment file limit (25 MB, `PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES`), so the page is still instrumented.
  { label: '25 MB', rel: 'comments/size-25.html', bytes: 25 * MB - 64 * 1024, ...largest }
] as const
const FRAMES = 10
const FRAME_HOST = 'comments/frames-10.html'
/** F-001's P95 budget, save → pin visible (§12.2). */
const F001_BUDGET_MS = 1_000
/** §12.2: F-001 is gated on macOS and Linux; the emulated Windows box records it only. */
const F001_GATED = process.platform !== 'win32'

const files: Record<string, string> = {
  [DECK]: corpus('slide-deck/index.html'),
  'comments/slide-deck/deck.js': corpus('slide-deck/deck.js'),
  [STATIC]: corpus('static-design/index.html'),
  [MANY]: manyCommentsPage(200),
  [FRAME_HOST]: [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>-HPC-FRAMES10-</title></head>',
    '<body>',
    ...Array.from({ length: FRAMES }, (_, i) => `  <iframe id="f${i}" src="frame-${i}.html" width="300" height="120"></iframe>`),
    '</body></html>',
    ''
  ].join('\n')
}
/** The raw control copy of a generated page: the same bytes without its block. */
const rawOf = (rel: string): string => rel.replace(/\.html$/, '.raw.html')
for (const size of SIZES) {
  files[size.rel] = sizedPage(size.bytes, `-HPC-SIZE-${size.label}-`)
  files[rawOf(size.rel)] = sizedPage(size.bytes, `-HPC-RAW-${size.label}-`, false)
}
for (let i = 0; i < FRAMES; i += 1) {
  files[`comments/frame-${i}.html`] = sizedPage(100 * 1024, `-HPC-FRAME-${i}-`)
  files[`comments/frame-${i}.raw.html`] = sizedPage(100 * 1024, `-HPC-RAW-FRAME-${i}-`, false)
}
files[rawOf(FRAME_HOST)] = files[FRAME_HOST]
  .replace('-HPC-FRAMES10-', '-HPC-RAW-FRAMES10-')
  .replace(/src="frame-(\d+)\.html"/g, 'src="frame-$1.raw.html"')

test.use({ testProjectFiles: { ...files, 'notes.md': '# Notes\n' } })

/** Nearest-rank percentile. */
function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

function median(samples: readonly number[]): number {
  return percentile(samples, 0.5)
}

/** Record one measurement: stdout (`HPC-PERF {…}`) and a test annotation. */
function record(info: TestInfo, id: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({ id, platform: process.platform, arch: process.arch, ...data })
  console.log(`HPC-PERF ${line}`)
  info.annotations.push({ type: id, description: line })
}

/** What one timed reload cost the main process. */
interface ReloadCost {
  /** Reload to the page's `did-finish-load` (frames included). */
  wallMs: number
  /** The longest gap between runs of a 1 ms main-side probe timer. */
  maxStallMs: number
  /** Probe gaps beyond 16 ms, summed: busy time above Windows' timer floor (~15.6 ms). */
  overFloorMs: number
}

/**
 * Reload the preview whose URL contains `needle` from main – as the watcher's
 * reload does – and time it there, in one call: no polling of the test's own
 * runs on main during the window. A 1 ms probe timer measures how long the
 * loop could not run; Node's event-loop utilisation reads 0 inside Electron's
 * main loop, so it cannot be used.
 */
async function timedReload(app: ElectronApplication, needle: string, guardMs = RELOAD_GUARD_MS): Promise<ReloadCost> {
  const cost = await app.evaluate(async ({ webContents }, { n, guardMs: guard }) => {
    const wc = webContents.getAllWebContents().find(c => c.getURL().startsWith('erfana-preview://') && c.getURL().includes(n))
    if (!wc) return null
    const started = performance.now()
    let last = started
    let max = 0
    let over = 0
    const probe = setInterval(() => {
      const now = performance.now()
      max = Math.max(max, now - last)
      over += Math.max(0, now - last - 16)
      last = now
    }, 1)
    try {
      await new Promise<void>((resolve, reject) => {
        // A guard against a reload that never finishes, not a wait for state.
        const timer = setTimeout(() => reject(new Error('the reload never finished')), guard)
        wc.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
        wc.reload()
      })
    } finally {
      clearInterval(probe)
    }
    return { wallMs: Math.round(performance.now() - started), maxStallMs: Math.round(max * 10) / 10, overFloorMs: Math.round(over * 10) / 10 }
  }, { n: needle, guardMs })
  if (cost === null) throw new Error(`no preview for ${needle}`)
  return cost
}

/**
 * Open a sized page and wait for its title. An instrumented page up to 4 MB
 * through `openCommentPage`; a page with a longer `openMs`, or the raw
 * control (comments off, so no comment panel), gets the same title wait with
 * its own budget.
 */
async function openSized(
  preview: HtmlPreviewPage,
  app: ElectronApplication,
  rel: string,
  title: string,
  openMs: number,
  commented: boolean
): Promise<void> {
  if (commented && openMs <= PREVIEW_BUDGET_MS) {
    await openCommentPage(preview, app, rel, title)
    return
  }
  await preview.open(rel)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(rel)))?.docTitle, {
        timeout: openMs,
        message: `${rel} never showed its ${title} title`
      })
      .toBe(title)
  )
}

/**
 * Turn HTML comments on or off before a view is built. Since spec 024 OD-01
 * every page is instrumented while comments are on – a page without a block
 * too – so F-002's raw control is served raw only with the feature off. The
 * view's session policy is chosen when it is built, so call this with no
 * preview open. `afterEach` turns the feature back on.
 */
async function setCommentsFlag(page: Page, enabled: boolean): Promise<void> {
  await setGlobalSetting(page, 'htmlPreview', { enabled: true, comments: { enabled } })
}

test.describe('HTML Preview comments – performance records (P7)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('F-001 save → pin visible on the slide deck: 20 samples, P95 recorded (gated on macOS/Linux)', async ({
    windowWithTestProject,
    appWithTestProject
  }, testInfo) => {
    test.setTimeout(300_000)
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const target = HtmlPreviewPage.target(DECK)
    await setGlobalSetting(page, 'comments', reviewer('Reviewer Perf Fx01'))
    const panelId = await openCommentPage(preview, app, DECK, '-HPC-DECK-')
    await preview.eval("(location.hash = '#3', 'set')", target)
    await expect.poll(() => preview.eval('document.body.dataset.slide', target), { timeout: PREVIEW_BUDGET_MS }).toBe('3')
    await chrome.modeOn(app, panelId, target)
    await expect.poll(() => preview.eval('document.body.dataset.slide', target), { timeout: PREVIEW_BUDGET_MS }).toBe('3')

    const samples: number[] = []
    for (let i = 1; i <= 20; i += 1) {
      const id = `s3-p${i}`
      await expect
        .poll(() => preview.eval(`(document.getElementById('${id}').scrollIntoView({ block: 'center' }), 'ok')`, target), { timeout: PREVIEW_BUDGET_MS })
        .toBe('ok')
      await clickElement(app, id, 'left', target)
      await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
      await page.getByTestId('comment-new-field').fill(`Perf sample ${i}`)
      const started = Date.now()
      await page.getByTestId('comment-save').click()
      let elapsed = -1
      await expect
        .poll(
          async () => {
            const box = await elementBox(app, id, target)
            const coverage = box === null ? null : await pinCoverage(app, box, target)
            if (coverage !== null && coverage >= PIN_DRAWN_COVERAGE) elapsed = Date.now() - started
            return elapsed >= 0
          },
          { timeout: PREVIEW_BUDGET_MS, intervals: [0], message: `no pin at #${id}` }
        )
        .toBe(true)
      samples.push(elapsed)
      await waitForCommentLoad(app, DECK, 'page', i)
    }
    expect(samples).toHaveLength(20)
    const p95 = percentile(samples, 0.95)
    // Recorded first, so a P95 over budget still leaves its numbers behind.
    record(testInfo, 'F-001', {
      samples,
      p50: median(samples),
      p95,
      max: Math.max(...samples),
      budgetMs: F001_BUDGET_MS,
      gated: F001_GATED
    })
    if (F001_GATED) expect(p95, 'F-001 P95').toBeLessThan(F001_BUDGET_MS)
  })

  test('F-002 shared parse + instrumentation per load: 0.5 / 1 / 4 / 25 MB pages and a 10-frame page, main-thread cost recorded', async ({
    windowWithTestProject,
    appWithTestProject
  }, testInfo) => {
    // The 25 MB page takes a minute or more per load on the emulated Windows box (LARGEST); the others under 3 s.
    test.setTimeout(EMULATED_WINDOWS ? 5_400_000 : 1_800_000)
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const results: Record<string, unknown>[] = []
    const summary = (runs: readonly ReloadCost[]): Record<string, number> => ({
      wallMsMedian: median(runs.map(r => r.wallMs)),
      maxStallMsMedian: median(runs.map(r => r.maxStallMs)),
      overFloorMsMedian: median(runs.map(r => r.overFloorMs))
    })

    for (const size of SIZES) {
      const row: Record<string, unknown> = { page: size.label, bytes: Buffer.byteLength(files[size.rel]), runsPerKind: size.runs }
      // The instrumented page, then the same page without a block (served raw) as the control.
      for (const [kind, rel, title] of [
        ['instrumented', size.rel, `-HPC-SIZE-${size.label}-`],
        ['raw', rawOf(size.rel), `-HPC-RAW-${size.label}-`]
      ] as const) {
        const target = HtmlPreviewPage.target(rel)
        await setCommentsFlag(page, kind === 'instrumented')
        await openSized(preview, app, rel, title, size.openMs, kind === 'instrumented')
        if (kind === 'instrumented') await waitForCommentLoad(app, rel, 'page', 1)
        const newest = async (): Promise<string | undefined> => newestLoad(await commentLoads(app), rel, 'page')?.loadId
        const runs: ReloadCost[] = []
        for (let run = 0; run < size.runs; run += 1) {
          const was = await newest()
          runs.push(await timedReload(app, target.urlIncludes as string, size.guardMs))
          // Every instrumented reload registered a new load; the raw page never one.
          if (kind === 'instrumented') await expect.poll(newest, { timeout: PREVIEW_BUDGET_MS }).not.toBe(was)
          else expect(await newest()).toBeUndefined()
        }
        row[kind] = { ...summary(runs), runs }
        await preview.tabClose().click()
        await expect.poll(async () => (await preview.livePreviews()).length, { timeout: PREVIEW_BUDGET_MS }).toBe(0)
      }
      results.push(row)
    }

    // Ten frames, each its own instrumented load, against the same frames served raw.
    for (const [kind, rel, title] of [
      ['instrumented', FRAME_HOST, '-HPC-FRAMES10-'],
      ['raw', rawOf(FRAME_HOST), '-HPC-RAW-FRAMES10-']
    ] as const) {
      const target = HtmlPreviewPage.target(rel)
      await setCommentsFlag(page, kind === 'instrumented')
      await preview.open(rel)
      await preview.waitForTitled(title)
      const frameLoads = async (): Promise<number> => (await commentLoads(app)).filter(load => load.scope === 'frame').length
      if (kind === 'instrumented') await expect.poll(frameLoads, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThanOrEqual(FRAMES)
      const runs: ReloadCost[] = []
      for (let run = 0; run < RUNS; run += 1) runs.push(await timedReload(app, target.urlIncludes as string, small.guardMs))
      if (kind === 'instrumented') await expect.poll(frameLoads, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThanOrEqual(FRAMES)
      results.push({ page: `${FRAMES} frames × 100 KB`, kind, ...summary(runs), runs })
      await preview.tabClose().click()
      await expect.poll(async () => (await preview.livePreviews()).length, { timeout: PREVIEW_BUDGET_MS }).toBe(0)
    }
    expect(results).toHaveLength(SIZES.length + 2)
    record(testInfo, 'F-002', { runsPerPage: RUNS, results })
  })

  test('F-003 right-click → menu with the still in place (20 samples), and hover over a page of 200 pins', async ({
    windowWithTestProject,
    appWithTestProject
  }, testInfo) => {
    test.setTimeout(300_000)
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const target = HtmlPreviewPage.target(STATIC)
    await setGlobalSetting(page, 'comments', reviewer('Reviewer Perf Fx03'))
    const panelId = await openCommentPage(preview, app, STATIC, '-HPC-STATIC-')
    await chrome.modeOn(app, panelId, target)

    // The renderer notes when main's draft arrives, when the menu is up, and
    // when the menu and the still frame are both up. A sample whose still never
    // came is counted, not waited for: E-011 is the test that asserts it.
    await page.evaluate(() => {
      const w = window as unknown as {
        __hpcMenu: number[]
        __hpcStill: number[]
        __hpcDraft: number[]
        api: { previewComments: { onDraftOpened(cb: () => void): () => void } }
      }
      w.__hpcMenu = []
      w.__hpcStill = []
      w.__hpcDraft = []
      w.api.previewComments.onDraftOpened(() => {
        w.__hpcDraft.push(Date.now())
      })
      let menuOpen = false
      let bothOpen = false
      new MutationObserver(() => {
        const menu = document.querySelector('[data-testid="comment-context-menu"]') !== null
        const both = menu && document.querySelector('.html-preview-still-frame') !== null
        if (menu && !menuOpen) w.__hpcMenu.push(Date.now())
        if (both && !bothOpen) w.__hpcStill[w.__hpcMenu.length - 1] = Date.now()
        menuOpen = menu
        bothOpen = both
      }).observe(document.body, { childList: true, subtree: true, attributes: true })
    })
    const menuSamples: number[] = []
    const stillSamples: number[] = []
    const draftSamples: number[] = []
    let stillMissing = 0
    const sentTimes: number[] = []
    for (let i = 0; i < 20; i += 1) {
      // KNOWN_WAIT: the page takes at most 5 picks a second (SEC-06), so a sixth
      // right-click inside one second is dropped by design. Pace the samples to
      // that limit – 1,100 ms after the right-click five samples back.
      if (i >= 5) {
        const wait = sentTimes[i - 5] + 1_100 - Date.now()
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      }
      await waitForViewShown(app, target)
      const point = centreOf(await waitForBox(app, 'team-copy', target))
      expect(await mouseAt(app, point, 'none', target)).toBe(true)
      const sentAt = await app.evaluate(({ webContents }, { x, y, needle }) => {
        const wc = webContents.getAllWebContents().find(c => c.getURL().includes(needle))
        const at = Date.now()
        wc?.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
        wc?.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
        return at
      }, { ...point, needle: target.urlIncludes as string })
      sentTimes.push(sentAt)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __hpcMenu: number[] }).__hpcMenu.length), { timeout: PREVIEW_BUDGET_MS }).toBe(i + 1)
      // The still normally lands with the menu; allow it a short grace before counting it missing.
      const stillAt = async (): Promise<number | null> =>
        page.evaluate(n => (window as unknown as { __hpcStill: (number | undefined)[] }).__hpcStill[n] ?? null, i)
      await expect.poll(stillAt, { timeout: 2_000 }).not.toBeNull().catch(() => undefined)
      const at = await page.evaluate(n => {
        const w = window as unknown as { __hpcMenu: number[]; __hpcDraft: number[] }
        return { menu: w.__hpcMenu[n], draft: w.__hpcDraft[n] }
      }, i)
      const still = await stillAt()
      menuSamples.push(at.menu - sentAt)
      draftSamples.push(at.draft - sentAt)
      if (still === null) stillMissing += 1
      else stillSamples.push(still - sentAt)
      await page.keyboard.press('Escape')
      await expect(chrome.menu()).toHaveCount(0)
      await expect.poll(() => viewShown(app, target), { timeout: PREVIEW_BUDGET_MS }).toBe(true)
    }
    expect(menuSamples).toHaveLength(20)

    // 200 pins on a page, the pointer sweeping it at 60 Hz with a scroll
    // halfway: once with comment mode off (pins only – the control), once on.
    const many = new CommentChrome(page, preview, 'many.html')
    const manyTarget = HtmlPreviewPage.target(MANY)
    const manyPanel = await openCommentPage(preview, app, MANY, '-HPC-MANY-')
    await waitForCommentLoad(app, MANY, 'page', 200)
    const sweepOnce = async (): Promise<Record<string, number>> => {
      expect(
        await preview.eval(
          "(scrollTo(0, 0), window.__hpcLong = [], window.__hpcGaps = [], window.__hpcObs?.disconnect(), window.__hpcObs = new PerformanceObserver(list => list.getEntries().forEach(e => window.__hpcLong.push(Math.round(e.duration)))), window.__hpcObs.observe({ type: 'longtask' }), (() => { const run = ++window.__hpcRun || (window.__hpcRun = 1); let last = performance.now(); const tick = now => { if (window.__hpcRun !== run) return; window.__hpcGaps.push(now - last); last = now; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })(), 'armed')",
          manyTarget
        )
      ).toBe('armed')
      const box = await waitForBox(app, 'p-0', manyTarget)
      const moves = await app.evaluate(async ({ webContents }, { needle, x0, width, height }) => {
        const wc = webContents.getAllWebContents().find(c => c.getURL().includes(needle))
        if (!wc) return 0
        const count = 240
        for (let i = 0; i < count; i += 1) {
          const x = Math.round(x0 + ((i * 7) % Math.max(1, width)))
          const y = Math.round(20 + ((i * 13) % Math.max(1, height - 40)))
          wc.sendInputEvent({ type: 'mouseMove', x, y })
          if (i === count / 2) wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -2400 })
          // KNOWN_WAIT: the sweep's input cadence (one move per 60 Hz frame), not a
          // wait for state – a hover test needs moves spread over time.
          await new Promise(resolve => setTimeout(resolve, 16))
        }
        return count
      }, { needle: manyTarget.urlIncludes as string, x0: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.viewportHeight) })
      expect(moves).toBe(240)
      const read = JSON.parse(
        (await preview.eval("(window.__hpcRun += 1, JSON.stringify({ long: window.__hpcLong, gaps: window.__hpcGaps.slice(1).map(g => Math.round(g * 10) / 10) }))", manyTarget)) ?? '{}'
      ) as { long: number[]; gaps: number[] }
      expect(read.gaps.length).toBeGreaterThan(30)
      return {
        moves,
        longTasksOver50ms: read.long.filter(d => d > 50).length,
        longestTaskMs: read.long.length === 0 ? 0 : Math.max(...read.long),
        frames: read.gaps.length,
        frameGapP50Ms: median(read.gaps),
        frameGapP95Ms: percentile(read.gaps, 0.95),
        frameGapMaxMs: Math.max(...read.gaps)
      }
    }
    await expectPin(app, 'p-0', true, manyTarget)
    const control = await sweepOnce()
    await many.modeOn(app, manyPanel, manyTarget)
    const inMode = await sweepOnce()

    record(testInfo, 'F-003', {
      menu: {
        samples: menuSamples,
        p50: median(menuSamples),
        p95: percentile(menuSamples, 0.95),
        max: Math.max(...menuSamples),
        draftArrivedP50: median(draftSamples),
        draftArrivedP95: percentile(draftSamples, 0.95),
        menuWithStillSamples: stillSamples,
        menuWithStillP95: stillSamples.length === 0 ? null : percentile(stillSamples, 0.95),
        stillMissing,
        budgetMs: 150
      },
      hover: { pins: 200, modeOff: control, modeOn: inMode }
    })
  })
})

