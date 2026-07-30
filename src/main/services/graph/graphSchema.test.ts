// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AC-2 proof for the on-disk schema: the DDL and the query catalogue are
 * EXECUTED against a real in-memory better-sqlite3 database.
 *
 * String inspection would prove nothing here. Every property under test is a
 * property of SQLite's behaviour, not of the text: whether `STRICT` refuses a
 * REAL in an INTEGER column, whether `foreign_keys = ON` makes a bare
 * `DELETE FROM files` fail loudly, whether an FTS5 orphan survives
 * `PRAGMA integrity_check` (it does — which is why the audit queries exist),
 * and whether the heading weight actually reorders a bm25 result.
 *
 * The rebuild, stamp, version gate and cross-handle contracts live in
 * `graphSchema.rebuild.test.ts`.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 6
 * @see specs/designs/sd-021-db-schema.md §6.3, §6.5, §6.7
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GRAPH_APPLY_FRESH_PROGRAM,
  GRAPH_MIN_SQLITE,
  GRAPH_REBUILD_PROGRAM,
  GRAPH_SCHEMA_DDL,
  GRAPH_STAMP_SQL,
  sqliteVersionAtLeast
} from './graphSchema'
import {
  applySchema,
  seedSection as seedSectionIn,
  type SeedSectionArgs
} from './graphSchema.testHelpers'

/** FTS5 shadow tables are an implementation detail of `sections_fts`. */
const SHADOW = /^sections_fts_/
/** SQLite's own bookkeeping objects (`sqlite_sequence`, `sqlite_autoindex_*`). */
const INTERNAL = /^sqlite_/

/** Every object the DDL is responsible for, excluding shadows and internals. */
function ownedObjects(db: Database.Database): Array<{ name: string; type: string }> {
  return db
    .prepare('SELECT name, type FROM sqlite_schema ORDER BY name')
    .all()
    .filter((row): row is { name: string; type: string } => {
      const { name } = row as { name: string }
      return !SHADOW.test(name) && !INTERNAL.test(name)
    })
}

let db: Database.Database

/** Bound to this suite's connection so call sites read as `seedSection({...})`. */
const seedSection = (args: SeedSectionArgs = {}): number => seedSectionIn(db, args)

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
})

afterEach(() => {
  db.close()
})
describe('environment gates (§6.6)', () => {
  it('runs on a SQLite new enough for STRICT tables', () => {
    const { version } = db.prepare('SELECT sqlite_version() AS version').get() as {
      version: string
    }
    expect(sqliteVersionAtLeast(version, GRAPH_MIN_SQLITE)).toBe(true)
  })

  it('has FTS5 compiled in', () => {
    const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get() as {
      enabled: number
    }
    expect(row.enabled).toBe(1)
  })

  // The compile option alone is not proof: it says the code is present, not
  // that a MATCH filters. Two documents, one token, exactly one row back.
  it('filters a real MATCH rather than returning every row', () => {
    const matching = seedSection({ path: 'a.md', heading: 'Alpha', text: 'quick brown fox' })
    seedSection({ path: 'b.md', heading: 'Beta', text: 'sleepy grey cat' })

    const rows = db
      .prepare('SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?')
      .all('brown') as Array<{ rowid: number }>

    expect(rows).toHaveLength(1)
    expect(rows[0].rowid).toBe(matching)
  })
})

describe('GRAPH_SCHEMA_DDL', () => {
  it('applies cleanly to an empty database', () => {
    expect(() => {
      const fresh = new Database(':memory:')
      for (const statement of GRAPH_SCHEMA_DDL) fresh.exec(statement)
      fresh.close()
    }).not.toThrow()
  })

  it('is idempotent — re-applying changes nothing', () => {
    const before = ownedObjects(db)
    for (const statement of GRAPH_SCHEMA_DDL) db.exec(statement)
    expect(ownedObjects(db)).toEqual(before)
  })

  // Count DERIVED from sqlite_schema, never hard-coded: a table added to the
  // DDL without a matching DROP would otherwise pass a literal assertion.
  it('creates one object per named table and index, and nothing else', () => {
    const owned = ownedObjects(db)
    const tables = owned.filter((o) => o.type === 'table').map((o) => o.name)
    const indexes = owned.filter((o) => o.type === 'index').map((o) => o.name)

    expect(tables.sort()).toEqual([
      'contents',
      'corpus_stats',
      'files',
      'graph_meta',
      'sections',
      'sections_fts'
    ])
    expect(indexes.sort()).toEqual(['idx_contents_orphan', 'idx_sections_file_ordinal'])
    expect(owned).toHaveLength(tables.length + indexes.length)
  })

  it('makes every named table STRICT', () => {
    const strict = db
      .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND sql IS NOT NULL")
      .all() as Array<{ name: string; sql: string }>
    const owned = strict.filter((t) => !SHADOW.test(t.name) && !INTERNAL.test(t.name))
    for (const table of owned) {
      // sections_fts is a virtual table; STRICT does not apply to it.
      if (table.name === 'sections_fts') continue
      expect(table.sql, table.name).toMatch(/\)\s*STRICT$/)
    }
  })

  it('gives sections_fts exactly two columns, so bm25 weights map 1:1', () => {
    const columns = (
      db.prepare('PRAGMA table_info(sections_fts)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(columns).toEqual(['heading', 'text'])
  })

  it('seeds the corpus_stats singleton at zero', () => {
    const row = db.prepare('SELECT * FROM corpus_stats').get() as Record<string, number | null>
    expect(row.id).toBe(1)
    expect(row.file_count).toBe(0)
    expect(row.section_count).toBe(0)
    expect(row.last_indexed_at_ms).toBeNull()
  })

  it('refuses a second corpus_stats row', () => {
    expect(() => db.prepare('INSERT INTO corpus_stats(id) VALUES (2)').run()).toThrow(
      /CHECK constraint failed/
    )
  })

  // No cascade ANYWHERE: FTS5 does not participate in it, so a cascade would
  // silently orphan postings and drift every counter (§6.7).
  it('declares no ON DELETE CASCADE', () => {
    const sql = GRAPH_SCHEMA_DDL.join('\n')
    expect(sql).not.toMatch(/ON\s+DELETE\s+CASCADE/i)
  })
})

describe('STRICT and CHECK constraints (M1/m1)', () => {
  it('refuses a REAL mtime_ms in an INTEGER column', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
           VALUES ('r.md', 'r.md', '.md', 1700000000000.5, 1, 'h', 1)`
        )
        .run()
    ).toThrow(/cannot store REAL value in INTEGER column/)
  })

  it('accepts a truncated mtime_ms', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
           VALUES ('t.md', 't.md', '.md', 1700000000000, 1, 'h', 1)`
        )
        .run()
    ).not.toThrow()
  })

  it.each([
    ['a negative mtime_ms', "('n.md','n.md','.md',-1,1,'h',1)"],
    ['a negative size_bytes', "('n.md','n.md','.md',1,-1,'h',1)"],
    ['an empty path', "('','n.md','.md',1,1,'h',1)"],
    ['an empty path_key', "('n.md','','.md',1,1,'h',1)"]
  ])('refuses %s', (_label, values) => {
    expect(() =>
      db.exec(
        `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
         VALUES ${values}`
      )
    ).toThrow(/CHECK constraint failed/)
  })

  // Path identity (M1) at the schema layer: NFC + case-folding is the writer's
  // job (#23), but the UNIQUE constraint is what makes the collapse observable
  // instead of producing two rows for one file.
  it('refuses a duplicate path_key', () => {
    seedSection({ path: 'Wstęp.md', pathKey: 'wstęp.md' })
    expect(() =>
      db
        .prepare(
          `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
           VALUES ('WSTĘP.md', 'wstęp.md', '.md', 1, 1, 'h', 1)`
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/)
    expect(db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 1 })
  })

  describe('sections', () => {
    beforeEach(() => {
      seedSection()
    })

    // Literal VALUES per case, mirroring the `files` block above. An earlier
    // shape built the row with ternaries selecting which column got the `?`,
    // which silently made the `ordinal` case insert a hard-coded 9 and pass a
    // stray parameter — it threw RangeError, not a CHECK failure, and a `/.*/`
    // expectation swallowed the difference. Never let the expectation vary per
    // case; a constraint that is never violated is a constraint never tested.
    it.each([
      ['heading_level 7', "(1, 1, 'H', 7, 's', 'H', 1, 10, ", 'heading_level BETWEEN 0 AND 6'],
      ['heading_level -1', "(1, 1, 'H', -1, 's', 'H', 1, 10, ", 'heading_level BETWEEN 0 AND 6'],
      ['start_line 0', "(1, 1, 'H', 1, 's', 'H', 0, 10, ", 'start_line >= 1'],
      ['ordinal -1', "(1, -1, 'H', 1, 's', 'H', 1, 10, ", 'ordinal >= 0']
    ])('refuses %s', (_label, values, constraint) => {
      expect(() =>
        db.exec(
          `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                heading_path, start_line, end_line, content_hash)
           VALUES ${values}(SELECT content_hash FROM contents LIMIT 1))`
        )
      ).toThrow(`CHECK constraint failed: ${constraint}`)
    })

    it('refuses end_line < start_line', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                  heading_path, start_line, end_line, content_hash)
             VALUES (1, 9, 'H', 1, 's', 'H', 10, 5, (SELECT content_hash FROM contents LIMIT 1))`
          )
          .run()
      ).toThrow(/CHECK constraint failed: end_line >= start_line/)
    })

    it('accepts heading_level 0, the pre-heading preamble', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                  heading_path, start_line, end_line, content_hash)
             VALUES (1, 9, '', 0, '', '', 1, 4, (SELECT content_hash FROM contents LIMIT 1))`
          )
          .run()
      ).not.toThrow()
    })

    it('refuses a second section at the same (file_id, ordinal)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                  heading_path, start_line, end_line, content_hash)
             VALUES (1, 0, 'Dup', 1, 's', 'Dup', 1, 4, (SELECT content_hash FROM contents LIMIT 1))`
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)
    })

    it('refuses a section pointing at a nonexistent file', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                  heading_path, start_line, end_line, content_hash)
             VALUES (999, 0, 'H', 1, 's', 'H', 1, 4, (SELECT content_hash FROM contents LIMIT 1))`
          )
          .run()
      ).toThrow(/FOREIGN KEY constraint failed/)
    })

    it('refuses a section pointing at a nonexistent content_hash', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                                  heading_path, start_line, end_line, content_hash)
             VALUES (1, 9, 'H', 1, 's', 'H', 1, 4, 'no-such-hash')`
          )
          .run()
      ).toThrow(/FOREIGN KEY constraint failed/)
    })
  })

  // CHECK (ref_count >= 0) turns an undercount BUG into an abort rather than
  // silent data loss — the reason the sweep uses `= 0`, not `<= 0`.
  it('refuses a negative ref_count', () => {
    seedSection()
    expect(() => db.exec('UPDATE contents SET ref_count = ref_count - 5')).toThrow(
      /CHECK constraint failed: ref_count >= 0/
    )
  })

  it('refuses a negative word_count', () => {
    expect(() =>
      db.exec("INSERT INTO contents(content_hash, text, word_count) VALUES ('h', 't', -1)")
    ).toThrow(/CHECK constraint failed/)
  })

  it.each([
    'file_count',
    'section_count',
    'word_count',
    'unique_content_count',
    'skipped_file_count'
  ])('refuses a negative corpus_stats.%s', (column) => {
    expect(() => db.exec(`UPDATE corpus_stats SET ${column} = -1 WHERE id = 1`)).toThrow(
      /CHECK constraint failed/
    )
  })

  it('refuses a graph_meta row with neither value nor value_int', () => {
    // A valid key with both columns NULL, so it is the base OR-CHECK (and the
    // column-discipline CHECK) that trips, not the key-IN allow-list.
    expect(() =>
      db.exec("INSERT INTO graph_meta(key, value, value_int) VALUES ('schema_version', NULL, NULL)")
    ).toThrow(/CHECK constraint failed/)
  })

  // [20]: the key allow-list and the per-key column discipline are contracts, not
  // comments — a version in the text column would read back NULL and the §6.6
  // gate would discard-and-rebuild a correct corpus.
  it('refuses a graph_meta key outside the exhaustive allow-list', () => {
    expect(() =>
      db.exec("INSERT INTO graph_meta(key, value, value_int) VALUES ('bogus', 'x', NULL)")
    ).toThrow(/CHECK constraint failed/)
  })

  it.each([
    ['schema_version in the text column', "('schema_version', '1', NULL)"],
    ['generation in the integer column', "('generation', NULL, 5)"],
    ['auto_rebuild_count in the text column', "('auto_rebuild_count', '2', NULL)"],
    ['schema_stability in the integer column', "('schema_stability', NULL, 1)"]
  ])('refuses %s (column discipline)', (_label, values) => {
    expect(() => db.exec(`INSERT INTO graph_meta(key, value, value_int) VALUES ${values}`)).toThrow(
      /CHECK constraint failed/
    )
  })

  // TEXT affinity would return '1' and break the === gate in §6.6, which is why
  // numeric keys use value_int.
  it('stores a numeric meta value as an INTEGER, not a string', () => {
    db.prepare("INSERT INTO graph_meta(key, value, value_int) VALUES ('schema_version', NULL, ?)")
      .run(1)
    const row = db
      .prepare("SELECT value_int, typeof(value_int) AS t FROM graph_meta WHERE key='schema_version'")
      .get() as { value_int: number; t: string }
    expect(row.value_int).toBe(1)
    expect(row.t).toBe('integer')
  })
})

describe('program shapes', () => {
  // These two previously asserted `steps` equalled the very spread that DEFINES
  // them (`[...GRAPH_SCHEMA_DDL]`, `[...GRAPH_DROP_DDL, ...GRAPH_SCHEMA_DDL]`),
  // so the only edit that could break them was the edit that also updated them.
  // What matters is not the array's provenance but that RUNNING it lands the
  // database in the right state — including on the object-by-object symmetry a
  // spread cannot check: a table added to the DDL without a matching DROP.
  it('applies fresh to exactly the DDL objects and nothing more', () => {
    const fresh = new Database(':memory:')
    try {
      for (const step of GRAPH_APPLY_FRESH_PROGRAM.steps) fresh.exec(step)
      expect(ownedObjects(fresh)).toEqual(ownedObjects(db))
    } finally {
      fresh.close()
    }
  })

  it('rebuilds a POPULATED database back to the fresh object set', () => {
    seedSection({ path: 'survivor.md' })
    const fresh = ownedObjects(db)

    for (const step of GRAPH_REBUILD_PROGRAM.steps) db.exec(step)

    // Symmetry: the DROP half removed every object the DDL half recreated, so
    // the set is identical and the corpus is gone.
    expect(ownedObjects(db)).toEqual(fresh)
    expect(db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM sections_fts').get()).toEqual({ n: 0 })
  })

  // The stamp cannot live in the steps array: `db.exec()` takes no parameters,
  // which is exactly how a rebuilt database ended up with no version row (B9).
  it('carries the stamp separately from the exec-able steps', () => {
    expect(GRAPH_APPLY_FRESH_PROGRAM.stamp).toBe(GRAPH_STAMP_SQL)
    expect(GRAPH_REBUILD_PROGRAM.stamp).toBe(GRAPH_STAMP_SQL)
    expect(GRAPH_REBUILD_PROGRAM.steps).not.toContain(GRAPH_STAMP_SQL)
  })

  it('binds the stamp by name, never by interpolation', () => {
    expect(GRAPH_STAMP_SQL).toContain(':version')
    expect(GRAPH_STAMP_SQL).toContain(':generation')
    expect(GRAPH_STAMP_SQL).toMatch(/ON CONFLICT\(key\) DO UPDATE/)
  })

  // C3 in the source itself: nothing in the rebuild path may remove the file or
  // reach outside the single in-place handle. The scan covers the full forbidden
  // set the contract names, not just VACUUM/ATTACH: `writable_schema` (corrupts
  // the schema in place) and `journal_mode` (C5 forbids flipping WAL while a
  // reader is attached) are each an equally file-destructive escape hatch.
  it('contains no VACUUM, no ATTACH/DETACH, no journal_mode flip and no writable_schema', () => {
    const sql = GRAPH_REBUILD_PROGRAM.steps.join('\n')
    expect(sql).not.toMatch(/VACUUM/i)
    expect(sql).not.toMatch(/ATTACH|DETACH/i)
    expect(sql).not.toMatch(/journal_mode/i)
    expect(sql).not.toMatch(/writable_schema/i)
  })
})
