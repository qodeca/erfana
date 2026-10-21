// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Benchmark: how the Markdown live preview behaves while the user types.
 *
 * Not a test – it asserts only that the run was valid (the typed text reached
 * the preview) and records numbers. It is excluded from the normal e2e run and
 * runs only through the env-gated `bench` project:
 *
 * ```sh
 * npx electron-vite build
 * ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after npx playwright test --project=bench
 * ```
 *
 * Each run launches a fresh app on a fresh project holding a deterministic
 * ~3,000-line document (`fixtures/previewBenchDocument.ts`), opens it in split
 * view, waits until the window is quiet, then types 50 characters into Monaco at
 * a fixed cadence and records:
 *
 * - **per keystroke**: the Event Timing API's input-to-next-paint duration for
 *   each key interaction (entries below the API's 16 ms floor count as 0);
 * - **main thread**: every long task (>50 ms) during typing and settling, and
 *   total blocking time (the sum of each long task's time past 50 ms);
 * - **preview renders**: count and duration of committed preview body renders
 *   (`utils/previewRenderTiming.ts`), plus abandoned render passes;
 * - **settle**: time from the last key press to the commit that shows it.
 *
 * Raw results go to `$ERFANA_BENCH_OUT` (default `.local/bench/`) as one JSON
 * file per run; the summary is printed to stdout.
 *
 * @see docs/performance/2026-10-21-deferred-preview.md
 */

import * as fs from 'fs'
import * as path from 'path'

import { test, expect } from './fixtures/index'
import { buildPreviewBenchDocument, PREVIEW_BENCH_OTHER } from './fixtures/previewBenchDocument'
import { EditorPanelPage } from './pages/editor-panel.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { MonacoPage } from './pages/monaco.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import type { PreviewRenderSample } from '../src/renderer/src/utils/previewRenderTiming'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'

/** Characters typed per run – 50, all plain letters and spaces, no block changes. */
const TYPED = 'the quick brown fox jumps over the lazy dog abcdef'
/** Gap between key presses: ~12 characters a second, a fast typist. */
const KEY_DELAY_MS = 80
/** A window is "quiet" once no long task has started for this long. */
const QUIET_MS = 1500
/** Runs per invocation; each is a fresh app launch. */
const RUNS = Number(process.env.ERFANA_BENCH_RUNS ?? 3)
const LABEL = process.env.ERFANA_BENCH_LABEL ?? 'unlabelled'
const OUT_DIR = process.env.ERFANA_BENCH_OUT ?? path.join(__dirname, '..', '.local', 'bench')

const DOC_NAME = 'bench.md'
/** Document size; 3,000 lines by default. Smaller values are for debugging the harness. */
const DOC_LINES = Number(process.env.ERFANA_BENCH_LINES ?? 3000)
const DOC = buildPreviewBenchDocument(DOC_LINES)
const MERMAID_COUNT = DOC.split('```mermaid').length - 1

test.use({
  testProjectFiles: {
    [DOC_NAME]: DOC,
    'other.md': PREVIEW_BENCH_OTHER
  }
})

/** What the in-page recorder hands back after a run. */
interface RecorderReport {
  keydowns: number[]
  events: Array<{ name: string; interactionId: number; startTime: number; duration: number }>
  longTasks: Array<{ startTime: number; duration: number }>
  starts: number
  samples: PreviewRenderSample[]
}

declare global {
  interface Window {
    __erfanaBench?: { report: () => RecorderReport; stop: () => void }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

const round = (n: number): number => Math.round(n * 10) / 10

for (let run = 1; run <= RUNS; run++) {
  test(`preview typing benchmark – run ${run}`, async ({ windowWithTestProject: page }) => {
    test.setTimeout(240_000)

    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const keyboard = new KeyboardHelper(page)
    const monaco = new MonacoPage(page, keyboard)

    // Switch render timing on before the document opens, so the first render
    // (the "don't delay the first render" guarantee) is captured too.
    await page.evaluate(() => {
      window.__erfanaPreviewRenderTiming = { starts: 0, samples: [] }
    })

    const openedAt = await page.evaluate(() => performance.now())
    await tree.fileRow(DOC_NAME).click()
    await tabs.waitForTab(DOC_NAME)
    await panel.waitForReady()
    await expect(panel.previewPane()).toContainText('Typing anchor paragraph.', { timeout: 30_000 })
    // The commit that put the document on screen: the newest one by the time
    // its text is visible. Earlier ones (if any) rendered an empty buffer.
    const openSamples = await page.evaluate(() => window.__erfanaPreviewRenderTiming?.samples ?? [])
    const firstRender = openSamples[openSamples.length - 1] ?? null

    await panel.setViewMode('split')
    await monaco.waitForReady()
    // Every diagram rendered = the expensive one-off work is over.
    await expect(panel.previewPane().locator('.mermaid-diagram svg')).toHaveCount(MERMAID_COUNT, { timeout: 60_000 })

    // Wait for a quiet main thread – a condition, polled in the page, not a sleep.
    await page.evaluate(
      (quietMs) =>
        new Promise<void>((resolve) => {
          let last = performance.now()
          const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) last = Math.max(last, e.startTime + e.duration)
          })
          obs.observe({ type: 'longtask' })
          const tick = (): void => {
            if (performance.now() - last >= quietMs) {
              obs.disconnect()
              resolve()
            } else {
              setTimeout(tick, 100)
            }
          }
          tick()
        }),
      QUIET_MS
    )

    // Put the cursor at the end of the anchor paragraph. Clicking its rendered
    // line is exact; arrow keys move by wrapped visual line and drift.
    await monaco.getEditor().locator('.view-line', { hasText: 'Typing anchor paragraph.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Space')

    // The document's length as React state holds it (the stats bar reads the
    // same `currentFile.content` the preview renders).
    const readChars = async (): Promise<number> =>
      Number(((await byTestId(page, TEST_IDS.STATS_CHARACTERS).locator('.stat-value').textContent()) ?? '').replace(/\D/g, ''))
    const charsBefore = await readChars()

    // Start recording only now: the setup above is not part of the measurement.
    await page.evaluate(() => {
      const keydowns: number[] = []
      const events: RecorderReport['events'] = []
      const longTasks: RecorderReport['longTasks'] = []
      const onKey = (e: KeyboardEvent): void => {
        keydowns.push(e.timeStamp)
      }
      window.addEventListener('keydown', onKey, { capture: true })
      const eventObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as PerformanceEventTiming[]) {
          events.push({
            name: e.name,
            interactionId: e.interactionId ?? 0,
            startTime: e.startTime,
            duration: e.duration
          })
        }
      })
      // 16 ms is the lowest threshold the Event Timing API accepts.
      eventObs.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
      const ltObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push({ startTime: e.startTime, duration: e.duration })
      })
      ltObs.observe({ type: 'longtask' })
      window.__erfanaPreviewRenderTiming = { starts: 0, samples: [] }
      window.__erfanaBench = {
        stop: () => {
          eventObs.disconnect()
          ltObs.disconnect()
          window.removeEventListener('keydown', onKey, { capture: true })
        },
        report: () => ({
          keydowns,
          events,
          longTasks,
          starts: window.__erfanaPreviewRenderTiming?.starts ?? 0,
          samples: window.__erfanaPreviewRenderTiming?.samples ?? []
        })
      }
    })

    const typingStart = Date.now()
    // One key press per character with a fixed gap: the cadence is the input
    // being benchmarked, not a wait for a condition.
    await page.keyboard.type(TYPED, { delay: KEY_DELAY_MS })
    const typingWallMs = Date.now() - typingStart

    // The run is valid once every keystroke the editor kept has reached the
    // state the preview renders. Keystrokes can be LOST (the editor briefly
    // rolls back to an older buffer under main-thread load and the cursor jumps
    // to the end of the file), so the count of characters that arrived is a
    // result, not a precondition.
    await expect(panel.previewPane()).toContainText('Typing anchor paragraph. t', { timeout: 30_000 })
    // Let deferred work (link checks, Mermaid, scroll map) finish inside the window.
    await page.evaluate(
      (quietMs) =>
        new Promise<void>((resolve) => {
          let last = performance.now()
          const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) last = Math.max(last, e.startTime + e.duration)
          })
          obs.observe({ type: 'longtask' })
          const tick = (): void => {
            if (performance.now() - last >= quietMs) {
              obs.disconnect()
              resolve()
            } else {
              setTimeout(tick, 100)
            }
          }
          tick()
        }),
      QUIET_MS
    )

    const charsAfter = await readChars()
    const typedIntact = (await panel.previewPane().textContent())?.includes(`Typing anchor paragraph. ${TYPED}`) ?? false

    const report = await page.evaluate(() => {
      window.__erfanaBench?.stop()
      return window.__erfanaBench?.report() ?? null
    })
    expect(report).not.toBeNull()
    const r = report as RecorderReport

    // Per keystroke: the longest Event Timing entry carrying that key's
    // interactionId (keydown/keypress/keyup share one). Keys with no entry
    // finished under the 16 ms floor and count as 0.
    const perInteraction = new Map<number, number>()
    for (const e of r.events) {
      if (e.interactionId > 0 && /^key/.test(e.name)) {
        perInteraction.set(e.interactionId, Math.max(perInteraction.get(e.interactionId) ?? 0, e.duration))
      }
    }
    const keyDurations = [...perInteraction.values()]
    while (keyDurations.length < TYPED.length) keyDurations.push(0)
    keyDurations.sort((a, b) => a - b)

    const lastKey = r.keydowns[r.keydowns.length - 1] ?? 0
    const lastCommit = r.samples[r.samples.length - 1]
    const renderDurations = r.samples.map((s) => s.duration).sort((a, b) => a - b)
    const tbt = r.longTasks.reduce((acc, t) => acc + Math.max(0, t.duration - 50), 0)

    const summary = {
      label: LABEL,
      run,
      date: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      keystrokes: r.keydowns.length,
      // Characters that never reached the document, and whether the phrase
      // arrived in one piece where it was typed.
      keystrokesLost: TYPED.length - (charsAfter - charsBefore),
      typedIntact,
      keyDelayMs: KEY_DELAY_MS,
      typingWallMs,
      inp: {
        p50: percentile(keyDurations, 50),
        p95: percentile(keyDurations, 95),
        max: keyDurations[keyDurations.length - 1] ?? 0,
        over50: keyDurations.filter((d) => d > 50).length,
        over200: keyDurations.filter((d) => d > 200).length
      },
      longTasks: {
        count: r.longTasks.length,
        totalMs: round(r.longTasks.reduce((a, t) => a + t.duration, 0)),
        tbtMs: round(tbt),
        maxMs: round(Math.max(0, ...r.longTasks.map((t) => t.duration)))
      },
      previewRenders: {
        committed: r.samples.length,
        started: r.starts,
        totalMs: round(r.samples.reduce((a, s) => a + s.duration, 0)),
        medianMs: round(percentile(renderDurations, 50)),
        maxMs: round(renderDurations[renderDurations.length - 1] ?? 0)
      },
      settleMs: lastCommit ? round(lastCommit.committedAt - lastKey) : null,
      firstRender: firstRender
        ? { durationMs: round(firstRender.duration), afterClickMs: round(firstRender.committedAt - openedAt) }
        : null,
      openSamples: openSamples.length
    }

    await fs.promises.mkdir(OUT_DIR, { recursive: true })
    const file = path.join(OUT_DIR, `preview-typing-${LABEL}-run${run}.json`)
    await fs.promises.writeFile(file, JSON.stringify({ summary, raw: r }, null, 2), 'utf-8')
    console.log(`[bench] ${JSON.stringify(summary)}`)
  })
}
