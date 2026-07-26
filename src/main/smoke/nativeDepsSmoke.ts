// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Native-dependency smoke orchestrator (SD-019, issue #19 — Wave A).
 *
 * Fail-closed driver for the packaged `ERFANA_SMOKE=native-deps` run
 * (src/main/index.ts dynamically imports this before window creation and
 * calls `app.exit(code)` with whatever it returns). Mirrors the fail-closed
 * contract of `GitStatusWorkerAdapter` (:45-50, :105-111): any worker error,
 * non-zero exit, or message timeout → failed result → exit 1, with **no
 * in-process fallback**.
 *
 * It aggregates three sources into one `checks[]`:
 *   1. the `sqlite-smoke.worker.js` worker_thread (AC#2),
 *   2. a *concurrent* main-process `better-sqlite3` DB opened while the
 *      worker holds its own — proving the context-aware / DB-per-worker
 *      claim in a single process (AC#1, SD-019 §5 "concurrent main + worker"),
 *   3. the MCP in-memory round-trip (AC#4).
 *
 * It requires the worker's explicit {@link SQLITE_SMOKE_SUCCESS_TOKEN} and
 * asserts that *every* expected check ran and passed before returning 0.
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import Database from 'better-sqlite3'
import {
  SQLITE_SMOKE_SUCCESS_TOKEN,
  SQLITE_SMOKE_GATING_CHECKS,
  type SqliteSmokeResult,
} from '../services/workers/sqlite-smoke.worker'
import type { SmokeCheck } from './types'
import { runMcpRoundtripSmoke } from './mcpInMemoryRoundtripSmoke'

/** Hard ceiling for the worker to report back. Beyond this we terminate + fail. */
export const WORKER_TIMEOUT_MS = 30_000

/**
 * Checks that MUST be present and passing for the smoke to exit 0. The sqlite
 * subset is imported from the worker ({@link SQLITE_SMOKE_GATING_CHECKS}) so the
 * gate cannot drift from the names the worker actually emits.
 * `sqlite:prebuild-path` is deliberately absent — it is informational (records
 * which .node loaded; SD-019 §2 [F6] / §5) and must never gate the run.
 */
const EXPECTED_CHECKS = [
  ...SQLITE_SMOKE_GATING_CHECKS,
  'main:concurrent-db',
  'mcp:listTools',
  'mcp:callTool',
] as const

/** Injectable collaborators — defaults run the real worker + MCP round-trip. */
export interface NativeDepsSmokeDeps {
  /** Spawns the built sqlite worker and resolves its result (fail-closed). */
  runWorker?: () => Promise<SqliteSmokeResult>
  /** Runs the MCP in-memory round-trip and resolves its checks. */
  runMcp?: () => Promise<SmokeCheck[]>
}

/** Aggregated outcome returned to the `index.ts` guard. */
export interface NativeDepsSmokeOutcome {
  code: 0 | 1
  checks: SmokeCheck[]
  loadedBinaryPath: string | null
  summary: string
}

/**
 * Factory for the sqlite smoke Worker. Injectable so the fail-closed paths of
 * {@link runSqliteWorker} (timeout, `error`, non-zero/clean `exit`) are unit-
 * testable without a real worker script; production passes no argument and the
 * default spawns the real built worker (FIX 3).
 */
export type SqliteWorkerFactory = (workerPath: string) => Worker

/**
 * Spawn the built `sqlite-smoke.worker.js` and resolve its result, mirroring
 * the timeout/terminate + fail-on-exit semantics of GitStatusWorkerAdapter.
 * Rejects (fail-closed) on worker error, non-zero exit, timeout, or a clean
 * exit that posted no result — never falls back to an in-process run.
 */
export function runSqliteWorker(
  createWorker: SqliteWorkerFactory = (path) => new Worker(path)
): Promise<SqliteSmokeResult> {
  const workerPath = join(__dirname, 'sqlite-smoke.worker.js')
  return new Promise<SqliteSmokeResult>((resolve, reject) => {
    const worker = createWorker(workerPath)
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`sqlite smoke worker timed out after ${WORKER_TIMEOUT_MS}ms`)))
    }, WORKER_TIMEOUT_MS)

    worker.on('message', (msg: { type: string } & SqliteSmokeResult) => {
      if (msg?.type === 'result') finish(() => resolve(msg))
    })
    worker.on('error', (error: Error) => finish(() => reject(error)))
    // Fail-closed on ANY exit before a result was posted (FIX 6): a clean exit
    // (code 0) that never posted a result would otherwise wait the full timeout.
    // `finish` no-ops once settled, so a normal success (message → terminate →
    // exit) still resolves and this handler is a harmless no-op.
    worker.on('exit', (exitCode: number) => {
      finish(() =>
        reject(
          new Error(
            exitCode !== 0
              ? `sqlite smoke worker exited with code ${exitCode}`
              : 'sqlite smoke worker exited before posting a result'
          )
        )
      )
    })

    worker.postMessage({ type: 'run' })
  })
}

/**
 * Prove that a MAIN-process `better-sqlite3` handle and the worker's own handle
 * coexist in the same OS process. The caller opens `mainDb` and keeps it alive
 * across `await runSqliteWorker()` (which spawns a worker that opens its own
 * `Database`); we then re-SELECT the row inserted before the worker ran. A
 * successful read AFTER the worker's handle came and went proves the two
 * handles were simultaneously open without a cross-instance ABI conflict.
 *
 * Fail-closed: any throw here surfaces as `passed: false`, which reds the run.
 */
function assertMainDbStillUsable(mainDb: Database.Database): SmokeCheck {
  try {
    const row = mainDb.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string } | undefined
    return {
      name: 'main:concurrent-db',
      passed: row?.v === 'main-process',
      detail: 'main-process better-sqlite3 handle stayed usable across the worker run (both handles open in one process)',
    }
  } catch (error) {
    return {
      name: 'main:concurrent-db',
      passed: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

/**
 * Run the full native-dependency smoke and return an aggregated outcome.
 * Fail-closed: worker rejection, a missing/mismatched success token, or any
 * expected (non-informational) check that did not run or did not pass yields
 * `code: 1`. Collaborators are injectable for tests; defaults spawn the real
 * worker + MCP round-trip.
 */
export async function runNativeDepsSmoke(deps: NativeDepsSmokeDeps = {}): Promise<NativeDepsSmokeOutcome> {
  const runWorker = deps.runWorker ?? runSqliteWorker
  const runMcp = deps.runMcp ?? runMcpRoundtripSmoke

  const checks: SmokeCheck[] = []
  let loadedBinaryPath: string | null = null
  let tokenValid = false

  // Open the main-process DB and KEEP IT OPEN across the worker run so both
  // handles are provably live in one process at once (FIX 1 / SD-019 §7).
  let mainDb: Database.Database | null = null
  let mainCheck: SmokeCheck
  try {
    mainDb = new Database(':memory:')
    mainDb.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    mainDb.prepare('INSERT INTO t (v) VALUES (?)').run('main-process')

    // Kick off the worker + MCP round-trip WHILE the main handle stays open.
    const workerPromise = runWorker()
    const mcpPromise = runMcp()

    try {
      const workerResult = await workerPromise
      checks.push(...workerResult.checks)
      loadedBinaryPath = workerResult.loadedBinaryPath
      tokenValid = workerResult.token === SQLITE_SMOKE_SUCCESS_TOKEN
    } catch (error) {
      checks.push({
        name: 'sqlite:worker',
        passed: false,
        detail: error instanceof Error ? error.message : 'worker failed',
      })
    }

    // Main handle is still open here; assert it is usable after the worker's
    // handle opened and closed — the genuine coexistence proof.
    mainCheck = assertMainDbStillUsable(mainDb)
    checks.push(...(await mcpPromise))
  } catch (error) {
    mainCheck = {
      name: 'main:concurrent-db',
      passed: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    }
  } finally {
    mainDb?.close()
  }
  checks.push(mainCheck)

  // Fail-closed assertion: every expected check must be present and passing.
  // Informational checks (e.g. sqlite:prebuild-path) are excluded from the gate.
  const byName = new Map(checks.map((c) => [c.name, c]))
  const missing = EXPECTED_CHECKS.filter((name) => !byName.has(name))
  const failed = checks.filter((c) => !c.passed && !c.informational).map((c) => c.name)
  const ok = tokenValid && missing.length === 0 && failed.length === 0

  const summary = ok
    ? `native-deps smoke PASSED (${checks.length} checks); better_sqlite3 loaded from ${loadedBinaryPath ?? 'unknown'}`
    : `native-deps smoke FAILED — token=${tokenValid ? 'ok' : 'MISSING'}, missing=[${missing.join(', ')}], failed=[${failed.join(', ')}]`

  return { code: ok ? 0 : 1, checks, loadedBinaryPath, summary }
}

/**
 * Render a smoke outcome as a plain-text report: summary, one line per check,
 * and the loaded binary path. Used for BOTH the stderr write and the
 * `ERFANA_SMOKE_LOG` file so a GUI-subsystem OS (Windows), where the packaged
 * app's stderr never reaches the CI pipe, still leaves triageable evidence
 * (FIX 2). Callers append a trailing newline as needed.
 */
export function renderSmokeReport(outcome: NativeDepsSmokeOutcome): string {
  return [
    outcome.summary,
    ...outcome.checks.map(
      (c) => `  [${c.passed ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`
    ),
    `  loadedBinaryPath: ${outcome.loadedBinaryPath ?? 'unknown'}`,
  ].join('\n')
}
