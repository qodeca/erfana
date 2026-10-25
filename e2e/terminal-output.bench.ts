// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Benchmark: a program that floods the terminal (finding [30]).
 *
 * Not a test – it asserts only that the run was valid (the end marker reached
 * xterm) and records numbers. It is excluded from the normal e2e run and runs
 * only through the env-gated `bench` project:
 *
 * ```sh
 * npx electron-vite build
 * ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after npx playwright test --project=bench e2e/terminal-output.bench.ts
 * ```
 *
 * Each run launches a fresh app with the fast e2e shell (`/bin/sh`), opens the
 * terminal, then runs `yes | head -c $ERFANA_BENCH_BYTES; echo DONE_$((1+1))`
 * (50,000,000 bytes by default) and records, from the moment Enter is pressed:
 *
 * - **IPC messages**: `terminal:data` messages the window received, and the
 *   characters they carried (one message per main-process send);
 * - **marker received**: when the end marker arrived over IPC;
 * - **marker parsed**: when xterm's buffer shows the marker line, i.e. the
 *   flood is fully on screen (polled every 100 ms through the e2e test hook);
 * - **renderer main thread**: long tasks (> 50 ms) and total blocking time;
 * - **renderer heap**: the largest `performance.memory.usedJSHeapSize` seen.
 *
 * The window stays in front. A minimised or covered window cannot be measured
 * through Playwright (it turns background throttling off and keeps the page
 * "visible"); `fixtures/terminalHiddenFloodDriver.cjs` runs that case from the
 * app's own main process (`ERFANA_BENCH_HIDE=minimize|cover` in the A/B script).
 *
 * Raw results go to `$ERFANA_BENCH_OUT` (default `.local/bench/`) as one JSON
 * file per run; the summary is printed to stdout.
 *
 * @see docs/performance/terminal-output-batching.md
 */

import * as fs from 'fs'
import * as path from 'path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import {
  waitForAppReady,
  openProject,
  terminal,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import type { Api } from '../src/preload/index'
import { E2E_CHROMIUM_ARGS } from './fixtures/isolation'

const BYTES = Number(process.env.ERFANA_BENCH_BYTES ?? 50_000_000)
const RUNS = Number(process.env.ERFANA_BENCH_RUNS ?? 3)
const LABEL = process.env.ERFANA_BENCH_LABEL ?? 'unlabelled'
const OUT_DIR = process.env.ERFANA_BENCH_OUT ?? path.join(__dirname, '..', '.local', 'bench')
/** Typed as an arithmetic expansion, so the echoed command line never matches the marker. */
const MARKER = 'DONE_2'
const COMMAND = `yes | head -c ${BYTES}; echo DONE_$((1+1))`

interface Recorder {
  messages: number
  chars: number
  markerAt: number | null
  longTasks: Array<{ startTime: number; duration: number }>
  peakHeap: number
}

declare global {
  interface Window {
    __terminalBench?: Recorder & { start: number; stop: () => void }
  }
}

/** Installs the in-page recorder. Runs in the page. */
function installRecorder(marker: string): void {
  const rec: Recorder & { start: number; stop: () => void } = {
    messages: 0,
    chars: 0,
    markerAt: null,
    longTasks: [],
    peakHeap: 0,
    start: performance.now(),
    stop: () => {}
  }
  // A marker can be split across two messages; keep a short tail to search
  let tail = ''
  const api = (window as unknown as {
    api: { terminal: { onData: (cb: (d: { data: string }) => void) => () => void } }
  }).api
  const off = api.terminal.onData(({ data }) => {
    rec.messages++
    rec.chars += data.length
    if (rec.markerAt === null) {
      const text = tail + data
      if (text.includes(marker)) rec.markerAt = performance.now() - rec.start
      tail = text.slice(-marker.length)
    }
  })
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      rec.longTasks.push({ startTime: entry.startTime - rec.start, duration: entry.duration })
    }
  })
  observer.observe({ type: 'longtask', buffered: false })
  const memory = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  const heapTimer = setInterval(() => {
    rec.peakHeap = Math.max(rec.peakHeap, memory()?.usedJSHeapSize ?? 0)
  }, 250)
  rec.stop = () => {
    off()
    observer.disconnect()
    clearInterval(heapTimer)
  }
  window.__terminalBench = rec
}

/** Whether the newest terminal's buffer ends with the marker line. Runs in the page. */
async function markerParsed(marker: string): Promise<boolean> {
  const hook = window.__erfanaTest
  if (!hook) throw new Error('e2e test hook missing (ERFANA_E2E_TEST_HOOKS=1)')
  // The page exposes the whole preload object; the renderer's `Window['api']` type leaves `terminal` out.
  const listed = await (window.api as Api).terminal.list()
  const id = listed.success ? listed.terminals.at(-1)?.id : undefined
  if (!id) return false
  const text = hook.terminalText(id) ?? ''
  return text.split('\n').some((line) => line.trim() === marker)
}

test.describe('terminal output flood benchmark', () => {
  test.skip(process.platform === 'win32', 'drives /bin/sh with yes and head')

  for (let run = 1; run <= RUNS; run++) {
    test(`flood run ${run} (${LABEL})`, async () => {
      test.setTimeout(10 * 60_000)
      const { projectPath, cleanup: cleanupProject } = await createTestProject({ 'notes.md': '# Notes\n' })
      const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('terminal-bench')
      let app: ElectronApplication | undefined
      let page: Page | undefined
      try {
        app = await electron.launch({
          args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
          env: {
            ...process.env,
            NODE_ENV: 'development',
            ERFANA_E2E_FAST_SHELL: '1',
            ERFANA_E2E_TEST_HOOKS: '1'
          }
        })
        page = await app.firstWindow()
        await waitForAppReady(page)
        await openProject(page, projectPath)
        await terminal.open(page)

        await page.evaluate(installRecorder, MARKER)
        await terminal.sendCommand(page, COMMAND, false)
        // Count from Enter: the echo of the typed command is not part of the flood
        await expect
          .poll(() => page!.evaluate(() => window.__terminalBench!.chars), { intervals: [50] })
          .toBeGreaterThanOrEqual(COMMAND.length)
        await page.evaluate(() => {
          const r = window.__terminalBench!
          r.messages = 0
          r.chars = 0
          r.longTasks = []
          r.start = performance.now()
        })
        const pressedAt = Date.now()
        await page.keyboard.press('Enter')

        // `markerParsed` is async, so it is polled from here rather than with waitForFunction
        await expect
          .poll(() => page!.evaluate(markerParsed, MARKER), { intervals: [100], timeout: 9 * 60_000 })
          .toBe(true)
        const parsedMs = Date.now() - pressedAt
        const rec = await page.evaluate(() => {
          const r = window.__terminalBench!
          r.stop()
          return { messages: r.messages, chars: r.chars, markerAt: r.markerAt, longTasks: r.longTasks, peakHeap: r.peakHeap }
        })
        expect(rec.markerAt, 'the marker should arrive over IPC').not.toBeNull()

        const blocking = rec.longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)
        const result = {
          label: LABEL,
          run,
          bytes: BYTES,
          host: { platform: process.platform, arch: process.arch },
          ipcMessages: rec.messages,
          ipcChars: rec.chars,
          meanCharsPerMessage: Math.round(rec.chars / Math.max(1, rec.messages)),
          markerReceivedMs: Math.round(rec.markerAt ?? -1),
          markerParsedMs: parsedMs,
          longTasks: rec.longTasks.length,
          longestTaskMs: Math.round(Math.max(0, ...rec.longTasks.map((t) => t.duration))),
          totalBlockingMs: Math.round(blocking),
          peakHeapMb: Math.round(rec.peakHeap / 1024 / 1024)
        }
        fs.mkdirSync(OUT_DIR, { recursive: true })
        fs.writeFileSync(
          path.join(OUT_DIR, `terminal-output-${LABEL}-${run}-${Date.now()}.json`),
          JSON.stringify(result, null, 2)
        )
        console.log(`[terminal-bench] ${JSON.stringify(result)}`)
      } finally {
        if (app) await closeApp(app)
        await cleanupProject()
        await cleanupUserData()
      }
    })
  }
})
