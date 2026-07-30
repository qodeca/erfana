// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `graph_meta` point-lookup queries, EXECUTED against a real in-memory
 * better-sqlite3 database.
 *
 * Split from `graphSchema.queries.test.ts` when the §9.10 budget key took that
 * file over the 500-line house cap. These four queries share nothing with the
 * search path — no seeded corpus, no FTS5, only the applied DDL — so the split
 * is along a real seam.
 *
 * One property carries the weight here and is silent when it breaks: numeric
 * keys live in `value_int` and string keys in `value`. TEXT affinity converts a
 * number to text on storage, so a `schema_version` written to `value` reads back
 * as `'1'` and the `=== ` gate in §6.6 fails against a database that is actually
 * correct; the same trap turns the rebuild-budget comparison into a string
 * compare. Each query therefore reads exactly one column, and reading the wrong
 * one returns NULL rather than a plausible-looking value.
 *
 * This file also carries the bundle-boundary gate for `graphSchema.ts` (see the
 * final describe block) — the assertion its header comment promises.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-schema.md §6.3, §6.5
 * @see specs/designs/sd-021-cross-cutting.md §9.10 - the rebuild budget
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRAPH_QUERIES, GRAPH_SCHEMA_DDL } from './graphSchema'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  for (const statement of GRAPH_SCHEMA_DDL) db.exec(statement)
})

afterEach(() => {
  db.close()
})

describe('meta reads', () => {
  it('returns undefined before the stamp and an integer after', () => {
    expect(db.prepare(GRAPH_QUERIES.schemaVersion).get()).toBeUndefined()
    db.prepare(
      "INSERT INTO graph_meta(key, value, value_int) VALUES ('schema_version', NULL, 1)"
    ).run()
    expect(db.prepare(GRAPH_QUERIES.schemaVersion).get()).toEqual({ schemaVersion: 1 })
  })

  it('reads generation from value_int', () => {
    db.prepare(
      "INSERT INTO graph_meta(key, value, value_int) VALUES ('generation', NULL, -42)"
    ).run()
    expect(db.prepare(GRAPH_QUERIES.generation).get()).toEqual({ generation: -42 })
  })
})

/**
 * `graphSchema.ts` is the first module pulled into BOTH the `index` and the
 * `graph-index.worker` rollup entries, so a single `import` there drags that
 * module's whole transitive graph — `logger`, and through it electron-log and
 * the main-process singletons it touches — into the worker bundle. The rule is
 * stated in the file's own header; this is the gate that makes the statement
 * true rather than aspirational.
 *
 * Deliberately the crude textual check the header claims (`^import`), not a
 * bundler probe: it is the same thing a reviewer greps for, it cannot go stale
 * against a build-tool upgrade, and it costs one file read. #23 is the first
 * issue that will want an import here — it must move the constant instead.
 *
 * @see specs/designs/sd-021-graph-architecture.md §4.5 - the zero-import rule
 */
describe('graphSchema.ts bundle boundary (§4.5)', () => {
  it('has zero top-level import statements', () => {
    const source = readFileSync(resolve(__dirname, 'graphSchema.ts'), 'utf8')
    const offenders = source.split('\n').filter((line) => /^import/.test(line))
    expect(offenders).toEqual([])
  })
})

// §9.10/E5: the three keys are persisted so the budget survives the crash it
// exists to detect, but until this key existed nothing could read them back —
// the reader takes a KEY and never SQL, so "Settings shows the count and the
// reason" had no wire at all.
describe('rebuildBudget (§9.10)', () => {
  it('returns one all-NULL row before the first automatic rebuild', () => {
    expect(db.prepare(GRAPH_QUERIES.rebuildBudget).get()).toEqual({
      autoRebuildCount: null,
      lastAutoRebuildMs: null,
      lastAutoRebuildReason: null
    })
  })

  it('reads the count and reason from their respective columns', () => {
    db.prepare(
      `INSERT INTO graph_meta(key, value, value_int) VALUES
         ('auto_rebuild_count',       NULL,          2),
         ('last_auto_rebuild_ms',     NULL,          1700000000000),
         ('last_auto_rebuild_reason', 'corruption',  NULL)`
    ).run()
    expect(db.prepare(GRAPH_QUERIES.rebuildBudget).get()).toEqual({
      autoRebuildCount: 2,
      lastAutoRebuildMs: 1700000000000,
      lastAutoRebuildReason: 'corruption'
    })
  })

  // The count is a NUMERIC key: written to `value` it would read back as the
  // string '2' and the >= MAX_AUTO_REBUILDS_PER_SESSION comparison would be a
  // string compare, exactly the trap value_int exists to close.
  it('returns null for a count written to the text column', () => {
    db.prepare(
      "INSERT INTO graph_meta(key, value, value_int) VALUES ('auto_rebuild_count', '2', NULL)"
    ).run()
    expect(
      (db.prepare(GRAPH_QUERIES.rebuildBudget).get() as { autoRebuildCount: number | null })
        .autoRebuildCount
    ).toBeNull()
  })
})
