// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Native-dependency in-process smoke (SD-019, issue #19 — Wave A).
 *
 * Always-on hard gate collected by the `vitest.main.ts` glob. Runs the
 * deterministic, headless subset of the spike:
 *   - better-sqlite3 in-process: `sqlite_compileoption_used('ENABLE_FTS5')`
 *     and an FTS5 create/insert/MATCH returning exactly one row (AC#1 logic);
 *   - the MCP `InMemoryTransport` round-trip: `listTools` contains the tool
 *     and `callTool` returns the expected result (AC#4).
 *
 * The worker_thread + packaged-load authority lives in the packaged mac/win
 * smoke and the Node harness (#4); this file asserts the logic, not the ABI.
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5, §12
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMcpRoundtripSmoke } from './mcpInMemoryRoundtripSmoke'
import { runNativeDepsSmoke } from './nativeDepsSmoke'
import { SQLITE_SMOKE_SUCCESS_TOKEN, type SqliteSmokeResult } from '../services/workers/sqlite-smoke.worker'
import type { SmokeCheck } from './types'

describe('native-deps smoke — better-sqlite3 (in-process)', () => {
  it('has FTS5 compiled into the loaded binary', () => {
    const db = new Database(':memory:')
    try {
      const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as {
        enabled: number
      }
      expect(row.enabled).toBe(1)
    } finally {
      db.close()
    }
  })

  it('creates an FTS5 table and MATCHes exactly one known row', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE VIRTUAL TABLE docs USING fts5(body)')
      db.prepare('INSERT INTO docs(body) VALUES (?)').run('the quick brown fox')
      db.prepare('INSERT INTO docs(body) VALUES (?)').run('a lazy dog sleeps')
      const rows = db.prepare('SELECT rowid FROM docs WHERE docs MATCH ?').all('brown')
      expect(rows).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})

describe('native-deps smoke — MCP SDK in-memory round-trip', () => {
  it('advertises the registered tool via listTools and returns its result via callTool', async () => {
    const checks = await runMcpRoundtripSmoke()

    const listTools = checks.find((c) => c.name === 'mcp:listTools')
    const callTool = checks.find((c) => c.name === 'mcp:callTool')

    expect(listTools, listTools?.detail).toBeDefined()
    expect(listTools?.passed, listTools?.detail).toBe(true)
    expect(callTool, callTool?.detail).toBeDefined()
    expect(callTool?.passed, callTool?.detail).toBe(true)
  })
})

/**
 * Fail-closed contract of the orchestrator. Collaborators are INJECTED (a fake
 * worker result + fake MCP checks), so these assertions exercise the
 * aggregation + gating logic deterministically — they do NOT spawn the built
 * worker and therefore do NOT themselves prove two-handle coexistence: only the
 * MAIN-process `better-sqlite3` handle is real here; the worker's handle is
 * faked. The genuine simultaneous-coexistence proof is the local unpacked
 * Electron run (real worker + real main DB) and the real-worker fail-closed
 * test in `runSqliteWorker.test.ts` (FIX 3). What `main:concurrent-db` verifies
 * on this path is that the real main-process handle stays usable across the
 * awaited (faked) worker step.
 */
describe('native-deps smoke — fail-closed orchestrator (runNativeDepsSmoke)', () => {
  const passingWorker = (): Promise<SqliteSmokeResult> =>
    Promise.resolve({
      ok: true,
      token: SQLITE_SMOKE_SUCCESS_TOKEN,
      loadedBinaryPath: '/fake/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
      checks: [
        { name: 'sqlite:load', passed: true },
        { name: 'sqlite:fts5-compileoption', passed: true },
        { name: 'sqlite:fts5-match', passed: true },
        { name: 'sqlite:prebuild-path', passed: true, informational: true },
      ],
    })

  const passingMcp = (): Promise<SmokeCheck[]> =>
    Promise.resolve([
      { name: 'mcp:listTools', passed: true },
      { name: 'mcp:callTool', passed: true },
    ])

  it('exits 0 and reports a passing, real concurrency check on the success path', async () => {
    const outcome = await runNativeDepsSmoke({ runWorker: passingWorker, runMcp: passingMcp })

    expect(outcome.code, outcome.summary).toBe(0)
    const concurrency = outcome.checks.find((c) => c.name === 'main:concurrent-db')
    expect(concurrency, 'concurrency check must be present').toBeDefined()
    expect(concurrency?.passed, concurrency?.detail).toBe(true)
    expect(outcome.loadedBinaryPath).toContain('prebuilds/darwin-arm64.node')
  })

  it('exits 1 when an expected worker check is missing (even with a valid token)', async () => {
    const missingFts5 = (): Promise<SqliteSmokeResult> =>
      Promise.resolve({
        ok: true,
        token: SQLITE_SMOKE_SUCCESS_TOKEN,
        loadedBinaryPath: '/fake/prebuilds/darwin-arm64.node',
        checks: [
          { name: 'sqlite:load', passed: true },
          { name: 'sqlite:fts5-compileoption', passed: true },
          // 'sqlite:fts5-match' deliberately absent.
        ],
      })

    const outcome = await runNativeDepsSmoke({ runWorker: missingFts5, runMcp: passingMcp })

    expect(outcome.code).toBe(1)
    expect(outcome.summary).toContain('sqlite:fts5-match')
    // The concurrency check itself still ran and passed — the failure is the
    // missing worker check, not a collateral crash.
    expect(outcome.checks.find((c) => c.name === 'main:concurrent-db')?.passed).toBe(true)
  })

  it('exits 1 when the success token is absent', async () => {
    const noToken = (): Promise<SqliteSmokeResult> =>
      Promise.resolve({
        ok: false,
        token: null,
        loadedBinaryPath: '/fake/prebuilds/darwin-arm64.node',
        checks: [
          { name: 'sqlite:load', passed: true },
          { name: 'sqlite:fts5-compileoption', passed: true },
          { name: 'sqlite:fts5-match', passed: true },
        ],
      })

    const outcome = await runNativeDepsSmoke({ runWorker: noToken, runMcp: passingMcp })

    expect(outcome.code).toBe(1)
    expect(outcome.summary).toContain('token=MISSING')
  })

  it('exits 1 when the success token is mismatched', async () => {
    const wrongToken = (): Promise<SqliteSmokeResult> =>
      Promise.resolve({
        ok: true,
        token: 'NOT_THE_REAL_TOKEN',
        loadedBinaryPath: '/fake/prebuilds/darwin-arm64.node',
        checks: [
          { name: 'sqlite:load', passed: true },
          { name: 'sqlite:fts5-compileoption', passed: true },
          { name: 'sqlite:fts5-match', passed: true },
        ],
      })

    const outcome = await runNativeDepsSmoke({ runWorker: wrongToken, runMcp: passingMcp })

    expect(outcome.code).toBe(1)
    expect(outcome.summary).toContain('token=MISSING')
  })

  it('exits 1 when a worker rejection removes the expected sqlite checks', async () => {
    const rejecting = (): Promise<SqliteSmokeResult> => Promise.reject(new Error('worker exited with code 7'))

    const outcome = await runNativeDepsSmoke({ runWorker: rejecting, runMcp: passingMcp })

    expect(outcome.code).toBe(1)
    // Fail-closed: the rejection is captured as a synthetic failing check.
    expect(outcome.checks.find((c) => c.name === 'sqlite:worker')?.passed).toBe(false)
  })

  it('exits 1 when an MCP check fails, and does NOT gate on the informational prebuild-path', async () => {
    const failingMcp = (): Promise<SmokeCheck[]> =>
      Promise.resolve([
        { name: 'mcp:listTools', passed: true },
        { name: 'mcp:callTool', passed: false, detail: 'callTool returned <none>' },
      ])
    // Worker loaded from build/Release/ → prebuild-path.passed=false but
    // informational, so it must NOT be the reason the run reds.
    const buildReleaseWorker = (): Promise<SqliteSmokeResult> =>
      Promise.resolve({
        ok: true,
        token: SQLITE_SMOKE_SUCCESS_TOKEN,
        loadedBinaryPath: '/fake/build/Release/better_sqlite3.node',
        checks: [
          { name: 'sqlite:load', passed: true },
          { name: 'sqlite:fts5-compileoption', passed: true },
          { name: 'sqlite:fts5-match', passed: true },
          { name: 'sqlite:prebuild-path', passed: false, informational: true },
        ],
      })

    const outcome = await runNativeDepsSmoke({ runWorker: buildReleaseWorker, runMcp: failingMcp })

    expect(outcome.code).toBe(1)
    expect(outcome.summary).toContain('mcp:callTool')
    // The informational prebuild-path failure must not appear in the failed set.
    expect(outcome.summary).not.toContain('sqlite:prebuild-path')
  })

  it('exits 0 with an informational build/Release prebuild-path (path recorded, not gated)', async () => {
    const buildReleaseWorker = (): Promise<SqliteSmokeResult> =>
      Promise.resolve({
        ok: true,
        token: SQLITE_SMOKE_SUCCESS_TOKEN,
        loadedBinaryPath: '/fake/build/Release/better_sqlite3.node',
        checks: [
          { name: 'sqlite:load', passed: true },
          { name: 'sqlite:fts5-compileoption', passed: true },
          { name: 'sqlite:fts5-match', passed: true },
          { name: 'sqlite:prebuild-path', passed: false, informational: true },
        ],
      })

    const outcome = await runNativeDepsSmoke({ runWorker: buildReleaseWorker, runMcp: passingMcp })

    expect(outcome.code, outcome.summary).toBe(0)
    const pathCheck = outcome.checks.find((c) => c.name === 'sqlite:prebuild-path')
    expect(pathCheck?.informational).toBe(true)
  })
})
