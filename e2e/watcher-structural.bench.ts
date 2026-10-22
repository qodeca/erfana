// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Benchmark: what 50 content-only saves cost on a 25,000-file project.
 *
 * Not a test – it records numbers. Runs only through the env-gated `bench`
 * project:
 *
 * ```sh
 * npx electron-vite build
 * ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after npx playwright test --project=bench watcher-structural
 * ```
 *
 * The project is generated once outside the repository (250 folders × 100
 * Markdown files, plus a root README) and reused: under `os.tmpdir()`, or
 * `~/.cache/erfana-bench` on macOS, or `$ERFANA_BENCH_PROJECT_PARENT`. Each
 * run launches a fresh app on it, waits for the first tree and the watcher,
 * then appends a line to 50 different files
 * from outside the app, 400 ms apart – past the main-process throttle and the
 * renderer debounce, so every save is its own `directory-watch:changed`
 * broadcast. It counts, in the main process:
 *
 * - `file:readDirectory` invokes, their total handler time, and the JSON size
 *   of the trees they return (the payload cloned to the renderer);
 * - `directory-watch:changed` sends and their JSON size;
 * - `git:getStatus` invokes, to show the badges still refresh.
 *
 * The handlers are wrapped through Electron's private `ipcMain._invokeHandlers`
 * map – acceptable for a benchmark, never for a test. Raw results go to
 * `$ERFANA_BENCH_OUT` (default `.local/bench/`).
 *
 * @see docs/performance/watcher-structural-refresh.md
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeApp, createTempUserDataDir, openProject, waitForAppReady } from './utils/helpers'

const FOLDERS = 250
const FILES_PER_FOLDER = 100
const SAVES = 50
const SAVE_GAP_MS = 400
/** Quiet time after the last save, so its refresh lands before the counters are read. */
const SETTLE_MS = 3000
/** Wait after the first tree for the watcher to start and finish its first scan. */
const WATCHER_WARMUP_MS = 8000
const RUNS = Number(process.env.ERFANA_BENCH_RUNS ?? 3)
const LABEL = process.env.ERFANA_BENCH_LABEL ?? 'unlabelled'
const OUT_DIR = process.env.ERFANA_BENCH_OUT ?? path.join(__dirname, '..', '.local', 'bench')
// Erfana refuses a project under a system folder, and on macOS `os.tmpdir()`
// resolves to one (`/private/var/folders`), so the default there is ~/.cache
const PROJECT_PARENT =
  process.env.ERFANA_BENCH_PROJECT_PARENT ??
  (process.platform === 'darwin' ? path.join(os.homedir(), '.cache', 'erfana-bench') : os.tmpdir())
const PROJECT = path.join(PROJECT_PARENT, `erfana-bench-25k-${FOLDERS}x${FILES_PER_FOLDER}`)

interface BenchCounters {
  reads: number
  readMs: number
  readBytes: number
  changedSends: number
  changedBytes: number
  gitStatusCalls: number
}

function ensureProject(): void {
  // Outside the project, so the tree does not show it
  const marker = `${PROJECT}.complete`
  if (fs.existsSync(marker)) return
  fs.rmSync(PROJECT, { recursive: true, force: true })
  fs.mkdirSync(PROJECT, { recursive: true })
  // A root file: openProject waits for a file node, and folders start collapsed
  fs.writeFileSync(path.join(PROJECT, 'README.md'), '# Bench project\n')
  for (let d = 0; d < FOLDERS; d++) {
    const dir = path.join(PROJECT, `folder-${String(d).padStart(3, '0')}`)
    fs.mkdirSync(dir, { recursive: true })
    for (let f = 0; f < FILES_PER_FOLDER; f++) {
      fs.writeFileSync(path.join(dir, `note-${String(f).padStart(3, '0')}.md`), `# Note ${d}/${f}\n`)
    }
  }
  fs.writeFileSync(marker, '')
}

/** Wrap the three channels in the main process; counters live on globalThis. */
async function instrument(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as { __bench: BenchCounters }
    g.__bench = { reads: 0, readMs: 0, readBytes: 0, changedSends: 0, changedBytes: 0, gitStatusCalls: 0 }
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })
      ._invokeHandlers
    const read = handlers.get('file:readDirectory')
    const git = handlers.get('git:getStatus')
    if (!read || !git) throw new Error('bench: handler not found')
    handlers.set('file:readDirectory', async (...args: unknown[]) => {
      const start = performance.now()
      const result = await read(...args)
      g.__bench.reads++
      g.__bench.readMs += performance.now() - start
      g.__bench.readBytes += Buffer.byteLength(JSON.stringify(result))
      return result
    })
    handlers.set('git:getStatus', async (...args: unknown[]) => {
      g.__bench.gitStatusCalls++
      return git(...args)
    })
    for (const win of BrowserWindow.getAllWindows()) {
      const send = win.webContents.send.bind(win.webContents)
      win.webContents.send = (channel: string, ...args: unknown[]) => {
        if (channel === 'directory-watch:changed') {
          g.__bench.changedSends++
          g.__bench.changedBytes += Buffer.byteLength(JSON.stringify(args[0]))
        }
        send(channel, ...args)
      }
    }
  })
}

async function readCounters(app: ElectronApplication): Promise<BenchCounters> {
  return app.evaluate(() => (globalThis as unknown as { __bench: BenchCounters }).__bench)
}

test.describe('Watcher structural refresh benchmark', () => {
  test.describe.configure({ retries: 0, timeout: 15 * 60_000 })

  test(`${SAVES} content-only saves on a ${FOLDERS * FILES_PER_FOLDER}-file project`, async () => {
    ensureProject()
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const results: Array<BenchCounters & { wallMs: number; run: number }> = []

    for (let run = 1; run <= RUNS; run++) {
      const { userDataDir, cleanup } = await createTempUserDataDir(`bench-structural-${run}`)
      let app: ElectronApplication | undefined
      let window: Page | undefined
      try {
        app = await electron.launch({
          args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
          env: { ...process.env, NODE_ENV: 'development', ERFANA_E2E_FAST_SHELL: '1' }
        })
        window = await app.firstWindow()
        await waitForAppReady(window)
        await openProject(window, PROJECT)
        await new Promise((resolve) => setTimeout(resolve, WATCHER_WARMUP_MS))
        await instrument(app)

        const start = Date.now()
        for (let i = 0; i < SAVES; i++) {
          const folder = `folder-${String(i % FOLDERS).padStart(3, '0')}`
          fs.appendFileSync(path.join(PROJECT, folder, 'note-000.md'), `edit ${run}.${i}\n`)
          await new Promise((resolve) => setTimeout(resolve, SAVE_GAP_MS))
        }
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
        const counters = await readCounters(app)
        results.push({ ...counters, wallMs: Date.now() - start, run })
        console.log(`[bench ${LABEL}] run ${run}: ${JSON.stringify(counters)}`)
        expect(counters.changedSends).toBeGreaterThan(0)
      } finally {
        if (app && window) await closeApp(app, window)
        else if (app) await app.close().catch(() => {})
        await cleanup()
      }
    }

    const file = path.join(OUT_DIR, `watcher-structural-${LABEL}-${Date.now()}.json`)
    fs.writeFileSync(file, JSON.stringify({ label: LABEL, project: { folders: FOLDERS, filesPerFolder: FILES_PER_FOLDER }, saves: SAVES, results }, null, 2))
    console.log(`[bench ${LABEL}] wrote ${file}`)
  })
})
