// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The rebuild, the stamp and the §6.6 version gate, EXECUTED on a real file.
 *
 * This file carries the two defects the design was written to close, and both
 * are only observable by running the program rather than reading it:
 *
 * - **B9 — a rebuilt database carried no `schema_version` row**, because the
 *   stamp is a PARAMETERISED statement and cannot live in an `exec()`-driven
 *   string array. The consequence was silent and expensive: every open saw
 *   `v IS NULL`, took the APPLY_FRESH branch, and the corpus was rebuilt
 *   forever. The gate is therefore re-run here AFTER the rebuild, and asserted
 *   to return `OK`, not `REBUILD`.
 * - **C2 + C3 together — the in-place rebuild.** A second, read-only handle
 *   prepares and CACHES a statement before the rebuild and REUSES that same
 *   never-re-prepared handle afterwards. Reuse is what gives the test
 *   discriminating power: a test that re-prepares would pass even if the
 *   rebuild had recreated the file, and would prove nothing about either
 *   contract.
 *
 * The §6.6 gate itself is implemented locally, as a test oracle: #23 owns the
 * production writer that runs it. What #21 owns — and what is asserted here —
 * is that the exported DDL, DROP list, stamp and query catalogue are the right
 * ingredients for it.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 7
 * @see specs/designs/sd-021-db-contracts.md C2, C3
 * @see specs/designs/sd-021-db-schema.md §6.6
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GRAPH_APPLY_FRESH_PROGRAM,
  GRAPH_DROP_DDL,
  GRAPH_QUERIES,
  GRAPH_REBUILD_PROGRAM,
  GRAPH_SCHEMA_DDL,
  GRAPH_SCHEMA_VERSION,
  GRAPH_STAMP_SQL,
  type GraphRebuildBudgetRow,
  type GraphSchemaProgram
} from './graphSchema'

/** The stamp binds five named params; apply-fresh preserves no budget. */
const NO_BUDGET: GraphRebuildBudgetRow = {
  autoRebuildCount: null,
  lastAutoRebuildMs: null,
  lastAutoRebuildReason: null
}

/** SQLite's own bookkeeping objects, which no DDL of ours creates or drops. */
const INTERNAL = /^sqlite_/
/** FTS5 shadow tables, created and dropped with `sections_fts` itself. */
const SHADOW = /^sections_fts_/

type SchemaObject = { name: string; type: string }

/** Everything `sqlite_schema` holds, unfiltered — the M35 symmetry snapshot. */
function schemaSnapshot(db: Database.Database): SchemaObject[] {
  return db.prepare('SELECT name, type FROM sqlite_schema ORDER BY name').all() as SchemaObject[]
}

/** The subset the DDL is responsible for creating AND dropping. */
function ownedObjects(db: Database.Database): SchemaObject[] {
  return schemaSnapshot(db).filter((o) => !INTERNAL.test(o.name) && !SHADOW.test(o.name))
}

/** `randomBytes(8)` as a signed 64-bit integer — difference, not monotonicity. */
function nextGeneration(): bigint {
  return randomBytes(8).readBigInt64BE(0)
}

/**
 * Run an exported program the way §6.6 specifies: one transaction, one file.
 *
 * The `preserve` read runs BEFORE the DROP steps so the rebuild budget survives
 * `graph_meta` being dropped (B4/[2]); apply-fresh has no `preserve` and binds
 * NULL budget params, which the stamp's `WHERE :param IS NOT NULL` arms drop.
 * `generation` is bound as a decimal string (D5).
 */
function runProgram(db: Database.Database, program: GraphSchemaProgram, generation: bigint): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    const budget = program.preserve
      ? (db.prepare(program.preserve).get() as GraphRebuildBudgetRow)
      : NO_BUDGET
    for (const step of program.steps) db.exec(step)
    db.prepare(program.stamp).run({
      version: GRAPH_SCHEMA_VERSION,
      generation: generation.toString(),
      ...budget
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type GateOutcome = 'APPLY_FRESH' | 'OK' | 'REBUILD'

/**
 * The §6.6 version branch, as a test oracle.
 *
 * Deliberately uses the exported `GRAPH_QUERIES.schemaVersion` rather than
 * inlining SQL, so a change to that query is caught here.
 */
function runVersionGate(db: Database.Database): GateOutcome {
  const row = db.prepare(GRAPH_QUERIES.schemaVersion).get() as
    | { schemaVersion: number | null }
    | undefined
  const version = row?.schemaVersion ?? null
  if (version === null) return 'APPLY_FRESH'
  return version === GRAPH_SCHEMA_VERSION ? 'OK' : 'REBUILD'
}

function openWriter(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 2000')
  return db
}

let dir: string
let dbPath: string
let writer: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-graph-rebuild-'))
  dbPath = join(dir, 'graph.db')
  writer = openWriter(dbPath)
})

afterEach(() => {
  try {
    writer.close()
  } catch {
    // already closed by the test
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('apply fresh', () => {
  it('creates the schema and stamps it', () => {
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())
    expect(runVersionGate(writer)).toBe('OK')
  })

  it('stamps version, generation and stability in one statement', () => {
    const generation = nextGeneration()
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, generation)

    // `generation` is a full-width signed 64-bit value (`readBigInt64BE`) stored
    // as a DECIMAL STRING in `value` (D5), never in `value_int`: a default read
    // of an INTEGER column returns a lossy JS number, and the key-based reader
    // cannot flip `safeIntegers()`. TEXT round-trips the full width. `value_int`
    // stays used for schema_version, which `safeIntegers(true)` reads back as a
    // bigint here so a truncating stamp would be caught.
    const rows = writer
      .prepare('SELECT key, value, value_int FROM graph_meta ORDER BY key')
      .safeIntegers(true)
      .all() as Array<{ key: string; value: string | null; value_int: bigint | null }>

    expect(rows.map((r) => r.key)).toEqual(['generation', 'schema_stability', 'schema_version'])
    expect(rows.find((r) => r.key === 'schema_version')?.value_int).toBe(
      BigInt(GRAPH_SCHEMA_VERSION)
    )
    expect(rows.find((r) => r.key === 'schema_stability')?.value).toBe('beta')
    const generationRow = rows.find((r) => r.key === 'generation')
    expect(generationRow?.value).toBe(generation.toString())
    expect(generationRow?.value_int).toBeNull()
    // The whole point of D5: the string reconstructs the 64-bit value exactly,
    // even above Number.MAX_SAFE_INTEGER.
    expect(BigInt(generationRow?.value ?? '')).toBe(generation)
  })

  it('reports APPLY_FRESH before the stamp and OK after it', () => {
    for (const step of GRAPH_APPLY_FRESH_PROGRAM.steps) writer.exec(step)
    expect(runVersionGate(writer)).toBe('APPLY_FRESH')

    writer
      .prepare(GRAPH_APPLY_FRESH_PROGRAM.stamp)
      .run({ version: GRAPH_SCHEMA_VERSION, generation: nextGeneration().toString(), ...NO_BUDGET })
    expect(runVersionGate(writer)).toBe('OK')
  })

  // §6.6 gate: a mismatch in EITHER direction rebuilds (a newer Erfana wrote a
  // higher value, or a downgrade left a lower one) — the case migrations cannot
  // handle, and the reason beta has none. The exact-version → OK case is covered
  // by 'reports APPLY_FRESH before the stamp and OK after it' above, so it cannot
  // join a REBUILD table. `GRAPH_SCHEMA_VERSION - 1` (0) is the only lower value
  // at version 1.
  it.each<[number, GateOutcome]>([
    [GRAPH_SCHEMA_VERSION + 1, 'REBUILD'],
    [GRAPH_SCHEMA_VERSION + 7, 'REBUILD'],
    [GRAPH_SCHEMA_VERSION - 1, 'REBUILD']
  ])('reports %2$s for on-disk version %1$s (mismatch either direction)', (version, expected) => {
    for (const step of GRAPH_APPLY_FRESH_PROGRAM.steps) writer.exec(step)
    writer
      .prepare(GRAPH_STAMP_SQL)
      .run({
        version,
        generation: nextGeneration().toString(),
        autoRebuildCount: null,
        lastAutoRebuildMs: null,
        lastAutoRebuildReason: null
      })
    expect(runVersionGate(writer)).toBe(expected)
  })

  /**
   * Applying fresh onto a database that already holds differently-shaped tables
   * SUCCEEDS and leaves the foreign tables in place, because every statement is
   * `CREATE TABLE IF NOT EXISTS`.
   *
   * This is the executed behaviour, not the behaviour the design implies. §6.6
   * routes `v IS NULL → APPLY_FRESH`, and a `graph.db` a sync client or a bad
   * restore left holding a foreign `files` table has no `schema_version` row —
   * so it takes that branch, the DDL no-ops on the collision, and the first
   * insert fails against the wrong columns. The REBUILD branch is immune (it
   * DROPs first), as the next test shows. Recorded for #23, which owns the
   * writer that picks the branch.
   */
  it('no-ops over a colliding foreign table instead of replacing it', () => {
    writer.exec('CREATE TABLE files (bogus TEXT)')
    expect(() => runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())).not.toThrow()

    const columns = (writer.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>)
      .map((c) => c.name)
    expect(columns).toEqual(['bogus'])
    expect(runVersionGate(writer)).toBe('OK')
  })

  it('is repaired by the rebuild program, which DROPs first', () => {
    writer.exec('CREATE TABLE files (bogus TEXT)')
    writer.exec('CREATE TABLE unrelated (x INTEGER)')
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())

    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())

    const columns = (writer.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>)
      .map((c) => c.name)
    expect(columns).toContain('path_key')
    expect(columns).not.toContain('bogus')
    // A table that is not ours is left alone — the DROP list is explicit, not a
    // wildcard sweep of the user's file.
    expect(schemaSnapshot(writer).map((o) => o.name)).toContain('unrelated')
  })
})

describe('DROP/CREATE symmetry (M35)', () => {
  beforeEach(() => {
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())
  })

  // The count is DERIVED from the post-DDL snapshot. A hard-coded "six tables"
  // would keep passing after a seventh was added with no matching DROP.
  it('drops every object the DDL created, leaving only sqlite_sequence', () => {
    const created = schemaSnapshot(writer)
    expect(created.length).toBeGreaterThan(0)

    for (const step of GRAPH_DROP_DDL) writer.exec(step)

    const remaining = schemaSnapshot(writer)
    expect(remaining).toEqual([{ name: 'sqlite_sequence', type: 'table' }])
    // Every created object except sqlite_sequence is actually gone. The prior
    // form asserted `created-minus-sequence` had length `created.length - 1`,
    // which is true by construction once `remaining` is pinned to
    // `[sqlite_sequence]` — a tautology that would survive a DROP list missing an
    // entry. This checks membership instead, so a forgotten DROP fails here.
    const remainingNames = new Set(remaining.map((o) => o.name))
    for (const { name } of created) {
      if (name === 'sqlite_sequence') continue
      expect(remainingNames.has(name)).toBe(false)
    }
  })

  it('drops the FTS5 shadow tables with sections_fts', () => {
    expect(schemaSnapshot(writer).some((o) => SHADOW.test(o.name))).toBe(true)
    for (const step of GRAPH_DROP_DDL) writer.exec(step)
    expect(schemaSnapshot(writer).some((o) => SHADOW.test(o.name))).toBe(false)
  })

  it('restores the identical object set on the CREATE half', () => {
    const before = ownedObjects(writer)
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    expect(ownedObjects(writer)).toEqual(before)
  })

  it('drops children before parents, so foreign_keys = ON does not abort', () => {
    writer
      .prepare(
        `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
         VALUES ('a.md', 'a.md', '.md', 1, 1, 'h', 1)`
      )
      .run()
    writer
      .prepare("INSERT INTO contents(content_hash, text, word_count, ref_count) VALUES ('c','t',1,1)")
      .run()
    writer
      .prepare(
        `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                              heading_path, start_line, end_line, content_hash)
         VALUES (1, 0, 'H', 1, 'h', 'H', 1, 2, 'c')`
      )
      .run()

    expect(() => runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())).not.toThrow()
    expect(writer.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 0 })
  })

  it('drops idempotently on an empty database', () => {
    for (const step of GRAPH_DROP_DDL) writer.exec(step)
    expect(() => {
      for (const step of GRAPH_DROP_DDL) writer.exec(step)
    }).not.toThrow()
  })
})

describe('stamp round-trip across a rebuild (B9)', () => {
  beforeEach(() => {
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())
  })

  // The defect: the rebuilt database carried NO version row, so the next open
  // saw `v IS NULL`, took APPLY_FRESH, and rebuilt the corpus on every launch.
  it('re-stamps schema_version, so the gate returns OK rather than REBUILD', () => {
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())

    const row = writer.prepare(GRAPH_QUERIES.schemaVersion).get() as { schemaVersion: number }
    expect(row).toBeDefined()
    expect(row.schemaVersion).toBe(GRAPH_SCHEMA_VERSION)
    expect(runVersionGate(writer)).toBe('OK')
    expect(runVersionGate(writer)).not.toBe('REBUILD')
  })

  it('re-stamps schema_stability', () => {
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    const row = writer
      .prepare("SELECT value FROM graph_meta WHERE key = 'schema_stability'")
      .get() as { value: string }
    expect(row.value).toBe('beta')
  })

  it('re-stamps a DIFFERENT generation', () => {
    const before = (writer.prepare(GRAPH_QUERIES.generation).get() as { generation: string })
      .generation
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    const after = (writer.prepare(GRAPH_QUERIES.generation).get() as { generation: string })
      .generation
    expect(after).not.toBe(before)
  })

  it('survives a close and reopen — the stamp is on disk, not in memory', () => {
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    writer.close()

    const reopened = openWriter(dbPath)
    try {
      expect(runVersionGate(reopened)).toBe('OK')
    } finally {
      reopened.close()
    }
  })

  it('upserts rather than duplicating on a second rebuild', () => {
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    const row = writer
      .prepare("SELECT count(*) AS n FROM graph_meta WHERE key = 'schema_version'")
      .get()
    expect(row).toEqual({ n: 1 })
  })

  it('re-seeds the corpus_stats singleton', () => {
    writer.prepare('UPDATE corpus_stats SET file_count = 42 WHERE id = 1').run()
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    expect(writer.prepare('SELECT file_count AS n FROM corpus_stats WHERE id = 1').get()).toEqual({
      n: 0
    })
  })
})

describe('rebuild budget preservation (B4/[2])', () => {
  beforeEach(() => {
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())
  })

  /** Record a prior automatic rebuild's budget the way #23's writer will — through the stamp's budget params. */
  function stampBudget(count: number, ms: number, reason: string): void {
    writer.prepare(GRAPH_STAMP_SQL).run({
      version: GRAPH_SCHEMA_VERSION,
      generation: nextGeneration().toString(),
      autoRebuildCount: count,
      lastAutoRebuildMs: ms,
      lastAutoRebuildReason: reason
    })
  }

  it('leaves the budget all-NULL after apply-fresh, which preserves nothing', () => {
    expect(writer.prepare(GRAPH_QUERIES.rebuildBudget).get()).toEqual({
      autoRebuildCount: null,
      lastAutoRebuildMs: null,
      lastAutoRebuildReason: null
    })
  })

  // The blocker: the rebuild DROPs graph_meta, and before the pre-DROP preserve
  // read the stamp restored only 3 of 6 keys — so `rebuildBudget` read all-NULL
  // after every rebuild ("never rebuilt"), MAX_AUTO_REBUILDS_PER_SESSION was
  // unreachable and the cooldown compared against NULL: an unbounded rebuild
  // loop, invisible in Settings.
  it('carries the budget across a rebuild rather than erasing it', () => {
    stampBudget(2, 1_700_000_000_000, 'corruption')
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    expect(writer.prepare(GRAPH_QUERIES.rebuildBudget).get()).toEqual({
      autoRebuildCount: 2,
      lastAutoRebuildMs: 1_700_000_000_000,
      lastAutoRebuildReason: 'corruption'
    })
  })

  // The case v1's verification missed: an existing graph_meta left in the legacy
  // CHECK-less shape (a sync client / bad restore) is what makes DROPing it the
  // repair path — `CREATE TABLE IF NOT EXISTS` alone would keep the old shape.
  // The rebuild repairs it into the constrained shape AND the budget survives.
  it('rebuilds a legacy CHECK-less graph_meta into the constrained shape while preserving the budget', () => {
    writer.exec('DROP TABLE graph_meta')
    writer.exec(
      'CREATE TABLE graph_meta (key TEXT NOT NULL PRIMARY KEY, value TEXT, value_int INTEGER)'
    )
    writer.prepare("INSERT INTO graph_meta VALUES ('auto_rebuild_count', NULL, 2)").run()
    writer.prepare("INSERT INTO graph_meta VALUES ('last_auto_rebuild_ms', NULL, 1700000000000)").run()
    writer
      .prepare("INSERT INTO graph_meta VALUES ('last_auto_rebuild_reason', 'corruption', NULL)")
      .run()

    const legacySql = (
      writer.prepare("SELECT sql FROM sqlite_master WHERE name = 'graph_meta'").get() as {
        sql: string
      }
    ).sql
    expect(legacySql).not.toMatch(/key IN \(/)

    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())

    const rebuiltSql = (
      writer.prepare("SELECT sql FROM sqlite_master WHERE name = 'graph_meta'").get() as {
        sql: string
      }
    ).sql
    expect(rebuiltSql).toMatch(/key IN \(/)
    expect(rebuiltSql).toMatch(/CASE/)
    expect(writer.prepare(GRAPH_QUERIES.rebuildBudget).get()).toEqual({
      autoRebuildCount: 2,
      lastAutoRebuildMs: 1700000000000,
      lastAutoRebuildReason: 'corruption'
    })
  })
})

describe('in-place rebuild under a live reader (C2 + C3)', () => {
  let reader: Database.Database

  beforeEach(() => {
    runProgram(writer, GRAPH_APPLY_FRESH_PROGRAM, nextGeneration())
    seed('alpha body text', 'Alpha')
    reader = new Database(dbPath, { readonly: true, fileMustExist: true })
  })

  afterEach(() => {
    reader.close()
  })

  function seed(text: string, heading: string): number {
    const fileId = Number(
      writer
        .prepare(
          `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
           VALUES (?, ?, '.md', 1, 1, ?, 1)`
        )
        .run(`${heading}.md`, `${heading.toLowerCase()}.md`, heading).lastInsertRowid
    )
    writer
      .prepare(
        `INSERT INTO contents(content_hash, text, word_count, ref_count) VALUES (?, ?, ?, 1)
         ON CONFLICT(content_hash) DO UPDATE SET ref_count = ref_count + 1`
      )
      .run(text, text, text.split(' ').length)
    const sectionId = Number(
      writer
        .prepare(
          `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                heading_path, start_line, end_line, content_hash)
           VALUES (?, 0, ?, 1, 'slug', ?, 1, 5, ?)`
        )
        .run(fileId, heading, heading, text).lastInsertRowid
    )
    writer
      .prepare('INSERT INTO sections_fts(rowid, heading, text) VALUES (?, ?, ?)')
      .run(sectionId, heading, text)
    return sectionId
  }

  /**
   * The discriminating assertion. The statement is prepared ONCE, before the
   * rebuild, and the SAME handle is stepped afterwards on a connection that was
   * never reopened. If the rebuild had gone through `unlink()` + recreate the
   * reader would keep serving the deleted inode and still return the OLD row —
   * correct-looking, integrity-clean, wrong.
   */
  it('lets a never-reopened reader observe the post-rebuild corpus through a CACHED statement', () => {
    const cached = reader.prepare('SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?')
    expect(cached.all('alpha')).toHaveLength(1)

    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    seed('gamma body text', 'Gamma')

    expect(cached.all('alpha')).toHaveLength(0)
    expect(cached.all('gamma')).toHaveLength(1)
  })

  it('keeps the same file identity across the rebuild', () => {
    if (platform() === 'win32') {
      // `ino` is unreliable on win32 (docs/windows/contributing.md), so the
      // substitute is a content probe: the reader follows the rebuild.
      const cached = reader.prepare('SELECT count(*) AS n FROM sections')
      expect(cached.get()).toEqual({ n: 1 })
      runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
      expect(cached.get()).toEqual({ n: 0 })
      return
    }

    const before = statSync(dbPath).ino
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    expect(statSync(dbPath).ino).toBe(before)
  })

  // Not production code — a comment recording WHY the in-place path is the only
  // legal one. `unlink()` + recreate leaves this same reader serving the deleted
  // inode forever, and `data_version` / `schema_version` / `user_version` all
  // fail to detect it (measured; see docs/graph/wal-concurrency-spike.md C3).
  // The spike harness asserts that counter-example; this file only asserts the
  // legal path, because #21 ships no code that could take the illegal one.
  it('lets the reader see a fresh insert with no reopen and no coordination', () => {
    const cached = reader.prepare('SELECT count(*) AS n FROM files')
    expect(cached.get()).toEqual({ n: 1 })
    seed('delta body text', 'Delta')
    expect(cached.get()).toEqual({ n: 2 })
  })

  it('exposes the new generation to the reader after the rebuild', () => {
    const before = (reader.prepare(GRAPH_QUERIES.generation).get() as { generation: string })
      .generation
    runProgram(writer, GRAPH_REBUILD_PROGRAM, nextGeneration())
    const after = (reader.prepare(GRAPH_QUERIES.generation).get() as { generation: string })
      .generation
    expect(after).not.toBe(before)
  })

  /**
   * M4 — correctness must not depend on the token.
   *
   * `graph_meta` is dropped by the rebuild, so between the DROP and the stamp
   * the generation is unreadable; on `REBUILD('corruption')` the damaged page
   * may BE `graph_meta`'s. The reader is told to clear its cache by
   * `ready.rebuilt === true`, unconditionally — never by comparing tokens.
   * Simulated here by rebuilding with the meta table unreadable at the moment
   * the reader looks.
   */
  it('leaves the generation unreadable mid-rebuild, which is why rebuilt drives the cache clear', () => {
    writer.exec('BEGIN IMMEDIATE')
    for (const step of GRAPH_DROP_DDL) writer.exec(step)
    for (const step of GRAPH_SCHEMA_DDL) writer.exec(step)
    // Committed WITHOUT the stamp — the state a token-comparing reader would
    // have to survive.
    writer.exec('COMMIT')

    expect(reader.prepare(GRAPH_QUERIES.generation).get()).toBeUndefined()
    expect(runVersionGate(reader)).toBe('APPLY_FRESH')

    writer.prepare(GRAPH_STAMP_SQL).run({
      version: GRAPH_SCHEMA_VERSION,
      generation: nextGeneration().toString(),
      autoRebuildCount: null,
      lastAutoRebuildMs: null,
      lastAutoRebuildReason: null
    })
    expect(runVersionGate(reader)).toBe('OK')
  })

  it('rolls back a failed rebuild, leaving the reader on the pre-rebuild corpus', () => {
    const cached = reader.prepare('SELECT count(*) AS n FROM sections')
    expect(cached.get()).toEqual({ n: 1 })

    const broken: GraphSchemaProgram = {
      steps: [...GRAPH_DROP_DDL, 'CREATE TABLE this is not valid sql'],
      stamp: GRAPH_STAMP_SQL
    }
    expect(() => runProgram(writer, broken, nextGeneration())).toThrow()

    expect(cached.get()).toEqual({ n: 1 })
    expect(runVersionGate(reader)).toBe('OK')
  })
})
