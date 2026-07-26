// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Node-ABI portability cross-check for the better-sqlite3 worker (SD-019 #19).
 *
 * Spawns the BUILT `out/main/sqlite-smoke.worker.js` in a real
 * `worker_threads.Worker` under the plain Node runtime (NOT Electron) and
 * exits non-zero on any failure. This is the always-on hard gate that
 * cross-checks the packaged mac/win authority: if the same worker bundle
 * loads and runs its FTS5 assertions under Node, the Node/Electron ABI is
 * portable. It is a cross-check only — never the AC#2 authority (that stays
 * the packaged mac/win smoke).
 *
 * Usage: run after `electron-vite build`.
 *   node scripts/smoke/sqlite-worker-smoke.mjs
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5 (verification matrix), §6 #4
 */

import { Worker } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { setTimeout, clearTimeout } from 'node:timers'

const EXPECTED_TOKEN = 'ERFANA_SQLITE_SMOKE_OK'
const TIMEOUT_MS = 30_000

const here = dirname(fileURLToPath(import.meta.url))
const workerPath = resolve(here, '..', '..', 'out', 'main', 'sqlite-smoke.worker.js')

if (!existsSync(workerPath)) {
  console.error(`[sqlite-worker-smoke] built worker not found at ${workerPath} — run \`electron-vite build\` first.`)
  process.exit(1)
}

// Expected gating check names — shared with the worker + orchestrator via the
// built module when available (FIX 5); falls back to the canonical literals so
// the hard gate never silently depends on the import succeeding. Importing the
// built worker in the main thread is side-effect-free (its parentPort listener
// only attaches inside a real Worker).
const FALLBACK_SQLITE_CHECKS = ['sqlite:load', 'sqlite:fts5-compileoption', 'sqlite:fts5-match']
let EXPECTED_SQLITE_CHECKS = FALLBACK_SQLITE_CHECKS
try {
  const workerModule = await import(pathToFileURL(workerPath).href)
  if (Array.isArray(workerModule.SQLITE_SMOKE_GATING_CHECKS) && workerModule.SQLITE_SMOKE_GATING_CHECKS.length > 0) {
    EXPECTED_SQLITE_CHECKS = workerModule.SQLITE_SMOKE_GATING_CHECKS
  }
} catch {
  // Bundled module did not expose the constant — keep the literal fallback.
}

/** Resolve the worker result or reject on error/exit/timeout (fail-closed). */
function runWorker() {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerPath)
    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error(`worker timed out after ${TIMEOUT_MS}ms`))), TIMEOUT_MS)
    worker.on('message', (msg) => {
      if (msg?.type === 'result') finish(() => resolvePromise(msg))
    })
    worker.on('error', (error) => finish(() => reject(error)))
    worker.on('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`worker exited with code ${code}`)))
    })
    worker.postMessage({ type: 'run' })
  })
}

try {
  const result = await runWorker()
  for (const check of result.checks ?? []) {
    console.log(`  [${check.passed ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
  }
  console.log(`[sqlite-worker-smoke] loaded binary: ${result.loadedBinaryPath ?? 'unknown'}`)
  // FIX 5: `ok` alone is not sufficient — assert the expected sqlite checks
  // actually RAN. A worker that emitted a truthy result but skipped a check
  // (e.g. a refactor that drops the FTS5 assertion) must fail this gate.
  const presentNames = new Set((result.checks ?? []).map((c) => c.name))
  const missing = EXPECTED_SQLITE_CHECKS.filter((name) => !presentNames.has(name))
  if (missing.length > 0) {
    console.error(`[sqlite-worker-smoke] FAILED — expected sqlite checks missing: [${missing.join(', ')}]`)
    process.exit(1)
  }
  if (!result.ok || result.token !== EXPECTED_TOKEN) {
    console.error(`[sqlite-worker-smoke] FAILED — ok=${result.ok}, token=${result.token ?? '<none>'}`)
    process.exit(1)
  }
  console.log('[sqlite-worker-smoke] PASSED (Node-ABI portability cross-check)')
  process.exit(0)
} catch (error) {
  console.error(`[sqlite-worker-smoke] FAILED — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
