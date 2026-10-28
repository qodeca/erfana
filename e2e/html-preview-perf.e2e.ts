// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AC24 save-to-visible-change gate (sd-074b §8).
 *
 * The original design named this file (`e2e/html-preview.perf.spec.ts`) as the
 * AC24 gate and it was never written — the corpus suite's header claims "AC24
 * perf" but contains no perf test. This is it, and it is parameterised by the
 * number of open previews, because sd-074b lets several run at once: the budget
 * has to hold when the watcher pool and the main-thread entry parse are shared.
 *
 * WHAT IS TIMED: the clock starts at the `fs.writeFile` that changes the
 * stylesheet, and stops when the running page's computed background actually
 * reflects it. That is the user-visible round trip — watcher, coalescing,
 * classification, CSS hot-swap, paint — not an internal milestone.
 *
 * Local gate only: E2E is disabled in CI, and shared runners flake on perf
 * floors (sd-074 §10). A regression shows up on `npm run test:e2e`.
 *
 * @see docs/html-preview/README.md#auto-refresh
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'

const CORPUS_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus')

function corpus(relPath: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, relPath), 'utf-8')
}

/** AC24: save-to-visible-change, 95th percentile. */
const AC24_P95_BUDGET_MS = 300

/** How many saves each measurement runs. The design specifies 20. */
const SAMPLE_COUNT = 20

/** Longest a single save is allowed to take before the run is abandoned. */
const SAMPLE_TIMEOUT_MS = 5_000

/** The measured page, addressed by its project-relative path (several are open). */
const MEASURED = HtmlPreviewPage.target('multi-file/index.html')

/** Read the measured preview page's computed body background, main-side. */
async function bodyBackground(preview: HtmlPreviewPage): Promise<string> {
  return (await preview.eval('getComputedStyle(document.body).backgroundColor', MEASURED)) ?? ''
}

/** The 95th-percentile value of a sample set, nearest-rank. */
function percentile95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * sorted.length)
  return sorted[Math.max(0, rank - 1)]
}

/**
 * Time one save: write a new `--page-bg`, then poll the running page until its
 * computed background matches. Returns the elapsed milliseconds.
 */
async function timeOneCssSave(
  preview: HtmlPreviewPage,
  cssPath: string,
  colour: { hex: string; rgb: string }
): Promise<number> {
  const source = await fsp.readFile(cssPath, 'utf-8')
  const next = source.replace(/--page-bg:\s*#[0-9a-fA-F]{3,8};/, `--page-bg: ${colour.hex};`)

  const startedAt = Date.now()
  await fsp.writeFile(cssPath, next, 'utf-8')

  const deadline = startedAt + SAMPLE_TIMEOUT_MS
  for (;;) {
    if ((await bodyBackground(preview)) === colour.rgb) {
      return Date.now() - startedAt
    }
    if (Date.now() > deadline) {
      throw new Error(`CSS save did not become visible within ${SAMPLE_TIMEOUT_MS} ms`)
    }
  }
}

/** Two colours to alternate between, so every save is a real change. */
const COLOURS = [
  { hex: '#112233', rgb: 'rgb(17, 34, 51)' },
  { hex: '#445566', rgb: 'rgb(68, 85, 102)' }
]

test.use({
  testProjectFiles: {
    'multi-file/index.html': corpus('multi-file/index.html'),
    'multi-file/styles.css': corpus('multi-file/styles.css'),
    'multi-file/app.js': corpus('multi-file/app.js'),
    'multi-file/logo.svg': corpus('multi-file/logo.svg'),
    'self-contained/index.html': corpus('self-contained/index.html'),
    'links/index.html': corpus('links/index.html'),
    'links/target.html': corpus('links/target.html')
  }
})

test.describe('HTML preview — AC24 save-to-visible-change', () => {
  test('stays under the 300 ms P95 with one preview open', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('multi-file/index.html')
    const cssPath = path.join(testProject.path, 'multi-file', 'styles.css')

    // Settle: the first swap after load also warms the watch set.
    await expect
      .poll(async () => (await bodyBackground(preview)).length > 0, {
        timeout: PREVIEW_BUDGET_MS
      })
      .toBe(true)
    await timeOneCssSave(preview, cssPath, COLOURS[0])

    const samples: number[] = []
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await timeOneCssSave(preview, cssPath, COLOURS[i % 2]))
    }

    const p95 = percentile95(samples)

    console.log(`[AC24] 1 preview — P95 ${p95} ms over ${samples.length} saves`)
    expect(p95).toBeLessThan(AC24_P95_BUDGET_MS)
  })

  test('still holds the budget with the live-view budget saturated', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    // Three previews is `PREVIEW.MAX_LIVE_VIEWS`: the most that ever run at once.
    // Open the measured one FIRST so it is the least recently used, then open two
    // more — this is the worst realistic case for the shared watcher pool and the
    // shared asset-read limiter.
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('multi-file/index.html')
    await preview.open('self-contained/index.html')
    await preview.open('links/index.html')

    const cssPath = path.join(testProject.path, 'multi-file', 'styles.css')

    await expect
      .poll(async () => (await bodyBackground(preview)).length > 0, {
        timeout: PREVIEW_BUDGET_MS
      })
      .toBe(true)
    await timeOneCssSave(preview, cssPath, COLOURS[0])

    const samples: number[] = []
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await timeOneCssSave(preview, cssPath, COLOURS[i % 2]))
    }

    const p95 = percentile95(samples)

    console.log(`[AC24] 3 previews — P95 ${p95} ms over ${samples.length} saves`)
    expect(p95).toBeLessThan(AC24_P95_BUDGET_MS)
  })
})
