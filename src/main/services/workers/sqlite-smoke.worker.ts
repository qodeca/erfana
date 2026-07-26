// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * better-sqlite3 worker-thread smoke (SD-019, issue #19 — Wave A).
 *
 * Proves that better-sqlite3@13 loads its native addon *inside a
 * `worker_thread`* (AC#2), that the bundled build has FTS5 compiled in
 * (AC#1), and — the key empirical output of the spike — records the
 * ABSOLUTE path of the `.node` that actually loaded so we can tell a
 * bundled `prebuilds/` binary apart from a `build/Release/` source build
 * (v13 dropped `prebuild-install`, so which binary loads is not an
 * assumption — see SD-019 §5 "which-binary-loaded").
 *
 * The module is import-safe: the `parentPort` message listener is only
 * attached when running as a real Worker, so the orchestrator (#2) and the
 * Node-ABI harness (#4) can import {@link SQLITE_SMOKE_SUCCESS_TOKEN} and
 * the message types without executing worker logic.
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5
 * @see GitStatusWorkerAdapter for the fail-closed worker pattern this mirrors
 */

import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3'
import type { SmokeCheck } from '../../smoke/types'

/**
 * Emitted only when every *gating* worker-side check passed. The orchestrator
 * (#2) and the Node harness (#4) both require this exact literal in the result
 * before treating the smoke as green — a truthy `ok` alone is not enough.
 * Informational checks (e.g. `sqlite:prebuild-path`) are excluded from the gate.
 */
export const SQLITE_SMOKE_SUCCESS_TOKEN = 'ERFANA_SQLITE_SMOKE_OK'

/**
 * Canonical names of the checks this worker emits. Kept in one place so the
 * orchestrator's gate ({@link nativeDepsSmoke.EXPECTED_CHECKS}) and the Node-ABI
 * harness (`scripts/smoke/sqlite-worker-smoke.mjs`) assert against the same
 * literals rather than each maintaining a private copy.
 */
export const SQLITE_SMOKE_CHECK_NAMES = {
  load: 'sqlite:load',
  fts5CompileOption: 'sqlite:fts5-compileoption',
  fts5Match: 'sqlite:fts5-match',
  prebuildPath: 'sqlite:prebuild-path',
} as const

/**
 * The GATING sqlite check names — every one MUST be present and passing for the
 * smoke to go green. `prebuildPath` is deliberately excluded (informational; it
 * records which `.node` loaded and never gates — SD-019 §2 [F6] / §5).
 */
export const SQLITE_SMOKE_GATING_CHECKS = [
  SQLITE_SMOKE_CHECK_NAMES.load,
  SQLITE_SMOKE_CHECK_NAMES.fts5CompileOption,
  SQLITE_SMOKE_CHECK_NAMES.fts5Match,
] as const

/** Worker → orchestrator result payload. */
export interface SqliteSmokeResult {
  ok: boolean
  /** Present iff every check passed (equals {@link SQLITE_SMOKE_SUCCESS_TOKEN}). */
  token: string | null
  checks: SmokeCheck[]
  /** Absolute path of the `.node` that actually loaded (empirical spike output). */
  loadedBinaryPath: string | null
  error?: string
}

/** Request message the orchestrator posts to kick off the checks. */
export interface SqliteSmokeRequest {
  type: 'run'
}

/**
 * The FTS5 fixture: a MATCHING and a NON-MATCHING document plus a token that
 * occurs in exactly one of them. Inserting both proves the MATCH actually
 * *filters* — a degenerate index that returned every row would fail the
 * `rows.length === 1 && the matching row` assertion below (SD-019 §6, FIX 4).
 */
const MATCHING_DOCUMENT = 'the quick brown fox jumps over the lazy dog'
const NON_MATCHING_DOCUMENT = 'a sleepy grey cat naps on the warm windowsill'
const KNOWN_TOKEN = 'brown'

/**
 * Matches a `better_sqlite3.node` resolved from a bundled prebuild
 * (`node_modules/better-sqlite3/prebuilds/<plat>-<arch>.node`).
 */
const PREBUILDS_PATH = /[/\\]node_modules[/\\]better-sqlite3[/\\]prebuilds[/\\]/

/** Matches a `.node` resolved from an on-machine source build. */
const BUILD_RELEASE_PATH = /[/\\]build[/\\](?:Release|Debug)[/\\]/

/**
 * Capture the absolute path of the native addon `better-sqlite3` dlopen's.
 *
 * The addon loads lazily on the first `new Database()`, not at `require`
 * time, so we wrap `process.dlopen` only for the duration of the DB open
 * and restore it immediately in a `finally`. This is the authoritative
 * "which binary loaded" probe — it records the real filename the loader
 * passed to `process.dlopen`, not a re-derived guess.
 */
function openDatabaseCapturingBinary(): { db: Database.Database; binaryPath: string | null } {
  type DlopenFn = (mod: { exports: unknown }, filename: string, flags?: number) => void
  const originalDlopen = process.dlopen.bind(process) as DlopenFn
  const captured: string[] = []
  process.dlopen = function (mod: { exports: unknown }, filename: string, flags?: number): void {
    captured.push(filename)
    // Preserve the caller's arity. Node's `.node` loader calls dlopen with two
    // args (no flags), and `process.dlopen` is a native binding with no JS
    // default for `flags` — so forwarding an explicit `undefined` third arg
    // makes libc `dlopen` reject the mode on Linux ("invalid mode for
    // dlopen(): Invalid argument"). Only pass `flags` when it was supplied.
    if (flags === undefined) {
      return originalDlopen(mod, filename)
    }
    return originalDlopen(mod, filename, flags)
  } as typeof process.dlopen

  let db: Database.Database
  try {
    db = new Database(':memory:')
  } finally {
    process.dlopen = originalDlopen as typeof process.dlopen
  }

  const binaryPath =
    captured.find((f) => /better[_-]sqlite3.*\.node$/i.test(f)) ?? captured.find((f) => f.endsWith('.node')) ?? null
  return { db, binaryPath }
}

/**
 * Run the four better-sqlite3 assertions in-thread and return a structured
 * result. Never throws — any failure is captured into the returned
 * `checks[]` + `error` so the orchestrator can fail closed on a message
 * rather than on an unhandled rejection.
 */
export function runSqliteChecks(): SqliteSmokeResult {
  const checks: SmokeCheck[] = []
  let loadedBinaryPath: string | null = null
  let db: Database.Database | null = null

  try {
    const opened = openDatabaseCapturingBinary()
    db = opened.db
    loadedBinaryPath = opened.binaryPath
    checks.push({
      name: SQLITE_SMOKE_CHECK_NAMES.load,
      passed: db !== null,
      detail: loadedBinaryPath ?? 'no dlopen path captured',
    })

    // AC#1: FTS5 must be compiled into the loaded binary.
    const compile = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as {
      enabled: number
    }
    checks.push({
      name: SQLITE_SMOKE_CHECK_NAMES.fts5CompileOption,
      passed: compile.enabled === 1,
      detail: `sqlite_compileoption_used('ENABLE_FTS5') = ${compile.enabled}`,
    })

    // AC#1: a real FTS5 virtual table round-trip that proves FILTERING — insert
    // one matching + one non-matching doc, MATCH a token present in only the
    // matching one, and assert exactly the matching row comes back (row count 1
    // AND it is the matching rowid + body). A MATCH that ignored the index and
    // returned both rows would fail here (FIX 4).
    db.exec('CREATE VIRTUAL TABLE docs USING fts5(body)')
    const matchingRowid = db.prepare('INSERT INTO docs(body) VALUES (?)').run(MATCHING_DOCUMENT).lastInsertRowid
    db.prepare('INSERT INTO docs(body) VALUES (?)').run(NON_MATCHING_DOCUMENT)
    const rows = db.prepare('SELECT rowid, body FROM docs WHERE docs MATCH ?').all(KNOWN_TOKEN) as Array<{
      rowid: number | bigint
      body: string
    }>
    const onlyMatchingRow =
      rows.length === 1 && Number(rows[0].rowid) === Number(matchingRowid) && rows[0].body === MATCHING_DOCUMENT
    checks.push({
      name: SQLITE_SMOKE_CHECK_NAMES.fts5Match,
      passed: onlyMatchingRow,
      detail: `MATCH '${KNOWN_TOKEN}' over 2 docs (1 matching, 1 not) returned ${rows.length} row(s); expected exactly the matching row (rowid ${String(matchingRowid)})`,
    })

    // Which binary loaded (SD-019 §2 [F6] / §5): this is an EMPIRICAL OUTPUT
    // TO RECORD, not a pass/fail gate. `informational: true` keeps the
    // `prebuilds/` vs `build/Release/` distinction out of the token gate so a
    // source-build load can never red the REQUIRED `build` job — it only
    // "passes" when a path was captured, and records which tree it came from
    // in the detail. #23 reads the recorded path; it does not gate on it.
    const underPrebuilds = loadedBinaryPath !== null && PREBUILDS_PATH.test(loadedBinaryPath)
    const underBuildRelease = loadedBinaryPath !== null && BUILD_RELEASE_PATH.test(loadedBinaryPath)
    checks.push({
      name: SQLITE_SMOKE_CHECK_NAMES.prebuildPath,
      informational: true,
      passed: loadedBinaryPath !== null,
      detail: underPrebuilds
        ? `loaded from prebuilds/: ${loadedBinaryPath}`
        : underBuildRelease
          ? `loaded from build/Release/ (source build): ${loadedBinaryPath}`
          : loadedBinaryPath !== null
            ? `loaded from an unrecognized path: ${loadedBinaryPath}`
            : 'no dlopen path captured',
    })
  } catch (error) {
    checks.push({
      name: 'sqlite:exception',
      passed: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    })
    return {
      ok: false,
      token: null,
      checks,
      loadedBinaryPath,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  } finally {
    db?.close()
  }

  // Only GATING (non-informational) checks decide the success token. The
  // informational `sqlite:prebuild-path` records which .node loaded but must
  // never gate the required build job (SD-019 §2 [F6] / §5).
  const ok = checks.filter((c) => !c.informational).every((c) => c.passed)
  return { ok, token: ok ? SQLITE_SMOKE_SUCCESS_TOKEN : null, checks, loadedBinaryPath }
}

// Attach the message listener only when running as a real worker thread.
// Import-safe: in the main process / vitest `parentPort` is null, so no
// listener is registered and importing this module has no side effects.
if (parentPort) {
  const port = parentPort
  // The native addon dlopen is memoized after the first `new Database()`, so
  // `loadedBinaryPath` can only be captured on the FIRST run. Reject any repeat
  // `run` message rather than emit a result with a null/stale binary path
  // (FIX 8) — the orchestrator sends exactly one run, so this only fires on
  // misuse.
  let hasRun = false
  port.on('message', (msg: SqliteSmokeRequest) => {
    if (msg?.type !== 'run') return
    if (hasRun) {
      port.postMessage({
        type: 'result',
        ok: false,
        token: null,
        checks: [
          {
            name: 'sqlite:repeat-run',
            passed: false,
            detail: 'worker received a second run message; binary-path capture is first-run only',
          },
        ],
        loadedBinaryPath: null,
        error: 'sqlite smoke worker received a repeat run message',
      })
      return
    }
    hasRun = true
    // runSqliteChecks() catches internally, so this try/catch is a belt-and-
    // suspenders guard around postMessage() itself (a serialization throw)
    // and any future refactor that lets runSqliteChecks throw — it ensures the
    // worker always replies with a result rather than dying silently, which the
    // orchestrator's fail-closed exit-code path depends on.
    try {
      const result = runSqliteChecks()
      port.postMessage({ type: 'result', ...result })
    } catch (error) {
      port.postMessage({
        type: 'result',
        ok: false,
        token: null,
        checks: [{ name: 'sqlite:fatal', passed: false }],
        loadedBinaryPath: null,
        error: error instanceof Error ? error.message : 'unknown worker error',
      })
    }
  })
}
