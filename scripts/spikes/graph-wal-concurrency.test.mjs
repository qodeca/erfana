// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WAL-concurrency spike harness — SD-021 contracts C1–C9 as ASSERTIONS (M31).
 *
 * SD-021 §3.2's measurements were a one-off local observation, and erratum E3
 * says so in the future tense until this file lands. Everything below is the
 * spike re-expressed so it can FAIL: one `expect` per contract, collected by
 * `vitest.main.ts`'s `scripts/spikes/**\/*.test.{js,mjs,ts}` glob, so it runs on
 * every push on ubuntu and on the advisory Windows job rather than living in a
 * developer's shell history. The glob is scoped to `spikes/` on purpose — a bare
 * `scripts/**` would also enrol the pre-existing build-tooling tests that no
 * config has ever collected.
 *
 * Scope. This asserts the SQLite-level behaviour each contract rests on — the
 * physics. It does not assert Erfana's implementation of the contract, which
 * does not exist yet: `GraphReadConnection` and `GraphDatabase` land with #23,
 * and the per-contract implementation tests are named in the §11.2 matrix.
 * Where a contract's cheap, in-process half is here and its expensive half is
 * not, the comment says which issue owns the remainder.
 *
 * Cost discipline: every case uses a temp directory it removes afterwards, and
 * the two timing-sensitive cases set `busy_timeout` to 200 ms rather than the
 * production 5 000 ms, so the whole file stays well under a second.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-contracts.md §5.3 - the C1-C9 contract text
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 10, §11.2 matrix
 * @see docs/graph/wal-concurrency-spike.md - the findings note
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'

const IS_WINDOWS = platform() === 'win32'
/** Root bypasses directory permissions, so the C7 probe cannot be staged. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

/** Short enough to keep the suite fast; long enough to be a real wait. */
const BUSY_TIMEOUT_MS = 200

let dir
let dbPath

/** A writer with the production pragma set, minus the shortened busy timeout. */
function openWriter(path = dbPath) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  return db
}

/** The reader: read-only, no busy timeout, no journal pragma (§5.4). */
function openReader(path = dbPath) {
  return new Database(path, { readonly: true, fileMustExist: true })
}

function seedCorpus(writer, rows = 50) {
  writer.exec('CREATE TABLE IF NOT EXISTS sections(id INTEGER PRIMARY KEY, body TEXT)')
  writer.exec('CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(body)')
  const insert = writer.prepare('INSERT INTO sections(id, body) VALUES (?, ?)')
  const post = writer.prepare('INSERT INTO sections_fts(rowid, body) VALUES (?, ?)')
  const fill = writer.transaction(() => {
    for (let i = 1; i <= rows; i++) {
      const body = `alpha beta section number ${i}`
      insert.run(i, body)
      post.run(i, body)
    }
  })
  fill()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-wal-spike-'))
  dbPath = join(dir, 'graph.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('C1 — the reader opens only after the writer signals ready', () => {
  it('throws SQLITE_CANTOPEN on a missing file and does NOT create it', () => {
    let code = null
    try {
      openReader()
    } catch (error) {
      code = error.code
    }

    expect(code).toBe('SQLITE_CANTOPEN')
    // The second half matters as much as the first: a readonly open that
    // CREATED the file would let the reader win the race and leave the writer
    // opening a zero-page database.
    expect(existsSync(dbPath)).toBe(false)
  })

  // The retry ladder itself — per-attempt re-fencing, abort mid-ladder,
  // idempotent double-attach — is `graphReadConnection.attach.test.ts` (#23).
  it('succeeds once the writer has created the file', () => {
    const writer = openWriter()
    seedCorpus(writer, 1)
    const reader = openReader()
    try {
      expect(reader.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 1 })
    } finally {
      reader.close()
      writer.close()
    }
  })
})

describe('C2 — a cached prepared statement follows a committed schema change', () => {
  it('returns post-rebuild rows through a statement prepared BEFORE the rebuild', () => {
    const writer = openWriter()
    seedCorpus(writer, 5)
    const reader = openReader()
    const cached = reader.prepare('SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?')

    try {
      expect(cached.all('alpha')).toHaveLength(5)

      // In-place DROP + recreate in one transaction, on the same handle.
      writer.exec('BEGIN IMMEDIATE')
      writer.exec('DROP TABLE sections_fts')
      writer.exec('DROP TABLE sections')
      writer.exec('COMMIT')
      seedCorpus(writer, 2)

      // The SAME statement handle, never re-prepared, on a connection that was
      // never reopened. This is the assertion that discriminates.
      expect(cached.all('alpha')).toHaveLength(2)
    } finally {
      reader.close()
      writer.close()
    }
  })
})

describe('C3 — the rebuild is IN-PLACE; never unlink, never rename', () => {
  it('keeps the inode stable across an in-place rebuild', () => {
    const writer = openWriter()
    seedCorpus(writer, 3)
    const reader = openReader()

    try {
      const before = IS_WINDOWS ? null : statSync(dbPath).ino
      writer.exec('BEGIN IMMEDIATE')
      writer.exec('DROP TABLE sections_fts')
      writer.exec('DROP TABLE sections')
      writer.exec('COMMIT')
      seedCorpus(writer, 1)

      if (IS_WINDOWS) {
        // `ino` is unreliable on win32 (docs/windows/contributing.md), so the
        // substitute is a content probe on the same never-reopened handle.
        expect(reader.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 1 })
      } else {
        expect(statSync(dbPath).ino).toBe(before)
      }
    } finally {
      reader.close()
      writer.close()
    }
  })

  /**
   * The counter-example, and the reason C3 is marked CRITICAL.
   *
   * After `unlink()` + recreate the live readonly handle keeps serving the
   * DELETED INODE — correct-looking, integrity-clean, wrong data — while the
   * writer appends to the new file. `data_version`, `schema_version` and
   * `user_version` all fail to notice. Only an `fs.stat()` inode comparison
   * reveals it, which is why `attach()` records `{dev, ino}` (#23).
   *
   * Skipped on win32, where unlinking a file with an open handle typically
   * fails outright: the failure mode differs by platform, which is itself part
   * of the argument for never taking this path.
   */
  it.skipIf(IS_WINDOWS)('would leave a live reader on a deleted inode after unlink + recreate', () => {
    const writer = openWriter()
    seedCorpus(writer, 2)
    const reader = openReader()

    try {
      const dataVersion = JSON.stringify(reader.pragma('data_version'))
      const schemaVersion = JSON.stringify(reader.pragma('schema_version'))
      const userVersion = JSON.stringify(reader.pragma('user_version'))

      writer.close()
      unlinkSync(dbPath)
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix)
      }

      const replacement = openWriter()
      try {
        seedCorpus(replacement, 9)

        expect(reader.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 2 })
        expect(replacement.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 9 })
        // No PRAGMA notices. This is the whole point.
        expect(JSON.stringify(reader.pragma('data_version'))).toBe(dataVersion)
        expect(JSON.stringify(reader.pragma('schema_version'))).toBe(schemaVersion)
        expect(JSON.stringify(reader.pragma('user_version'))).toBe(userVersion)
      } finally {
        replacement.close()
      }
    } finally {
      reader.close()
    }
  })
})

describe('C4 — no read transaction may span an await', () => {
  it('blocks the writer checkpoint for its full busy_timeout while a read txn is held', () => {
    const writer = openWriter()
    seedCorpus(writer, 5)
    const reader = openReader()

    try {
      reader.exec('BEGIN')
      reader.prepare('SELECT count(*) FROM sections').get()
      writer.prepare('INSERT INTO sections(body) VALUES (?)').run('later row')

      const started = Date.now()
      const [result] = writer.pragma('wal_checkpoint(TRUNCATE)')
      const elapsed = Date.now() - started

      expect(result.busy).toBe(1)
      // It does not fail fast — it burns the writer's whole busy_timeout, which
      // at the production 5 000 ms setting is a 5 s writer stall per checkpoint.
      expect(elapsed).toBeGreaterThanOrEqual(BUSY_TIMEOUT_MS * 0.5)

      reader.exec('COMMIT')
    } finally {
      reader.close()
      writer.close()
    }
  })

  // The positive half — that `querySearchPage` runs its two phases inside ONE
  // snapshot — is `graphReadConnection.snapshot.test.ts` (#23). What is
  // assertable here is the primitive it relies on.
  it('holds a stable snapshot for the duration of one read transaction', () => {
    const writer = openWriter()
    seedCorpus(writer, 3)
    const reader = openReader()

    try {
      const count = reader.transaction(() => {
        const first = reader.prepare('SELECT count(*) AS n FROM sections').get().n
        writer.prepare('INSERT INTO sections(body) VALUES (?)').run('interleaved')
        const second = reader.prepare('SELECT count(*) AS n FROM sections').get().n
        return { first, second }
      })()

      expect(count.first).toBe(count.second)
    } finally {
      reader.close()
      writer.close()
    }
  })
})

describe('C5 — never flip journal_mode out of WAL with a reader attached', () => {
  it('raises SQLITE_BUSY on the WRITER', () => {
    const writer = openWriter()
    seedCorpus(writer, 2)
    const reader = openReader()

    try {
      // The reader must have actually READ once: a connection that has never
      // touched the wal-index is not yet a participant, and the flip succeeds.
      // An attached Erfana reader is always past this point.
      reader.prepare('SELECT count(*) FROM sections').get()

      let code = null
      try {
        writer.pragma('journal_mode = delete')
      } catch (error) {
        code = error.code
      }

      expect(code).toBe('SQLITE_BUSY')
      // Still WAL — the failed flip changed nothing.
      expect(writer.pragma('journal_mode', { simple: true })).toBe('wal')
    } finally {
      reader.close()
      writer.close()
    }
  })
})

describe('C6 — counts come from the counter table, never count(*) on FTS', () => {
  it('plans count(*) on an FTS5 table as a full virtual-table SCAN', () => {
    const writer = openWriter()
    seedCorpus(writer, 20)
    writer.exec('CREATE TABLE corpus_stats(id INTEGER PRIMARY KEY CHECK (id = 1), section_count INTEGER)')
    writer.prepare('INSERT INTO corpus_stats(id, section_count) VALUES (1, 20)').run()

    try {
      const ftsPlan = writer
        .prepare('EXPLAIN QUERY PLAN SELECT count(*) FROM sections_fts')
        .all()
        .map((r) => r.detail)
        .join(' ')
      const statsPlan = writer
        .prepare('EXPLAIN QUERY PLAN SELECT section_count FROM corpus_stats WHERE id = 1')
        .all()
        .map((r) => r.detail)
        .join(' ')

      expect(ftsPlan).toMatch(/SCAN sections_fts/)
      // The sanctioned path touches one b-tree row by primary key.
      expect(statsPlan).not.toMatch(/sections_fts/)
      expect(statsPlan).toMatch(/SEARCH corpus_stats/)
    } finally {
      writer.close()
    }
  })
})

describe('C7 — a WAL reader needs a writable containing directory', () => {
  // chmod is meaningless on win32 and bypassed by root.
  it.skipIf(IS_WINDOWS || IS_ROOT)('refuses the readonly open when -shm cannot be created', async () => {
    const { chmodSync } = await import('node:fs')
    const writer = openWriter()
    seedCorpus(writer, 1)
    writer.close()
    // Remove the WAL sidecars so the reader must create `-shm` itself.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix)
    }

    chmodSync(dir, 0o500)
    let code = null
    try {
      const reader = openReader()
      reader.prepare('SELECT count(*) FROM sections').get()
      reader.close()
    } catch (error) {
      code = error.code
    } finally {
      chmodSync(dir, 0o700)
    }

    // Both observed spellings map to the single code GRAPH_DB_DIR_NOT_WRITABLE.
    expect(['SQLITE_CANTOPEN', 'SQLITE_READONLY_DIRECTORY']).toContain(code)
  })
})

describe('C8 — checkpoint on open, and CHECK THE BUSY COLUMN', () => {
  it('returns busy as DATA rather than raising, so a naive writer reads success', () => {
    const writer = openWriter()
    seedCorpus(writer, 5)
    const reader = openReader()

    try {
      reader.exec('BEGIN')
      reader.prepare('SELECT count(*) FROM sections').get()
      writer.prepare('INSERT INTO sections(body) VALUES (?)').run('pending')

      // No throw — better-sqlite3 hands the row back. THIS is the silent no-op.
      const [blocked] = writer.pragma('wal_checkpoint(TRUNCATE)')
      expect(blocked.busy).toBe(1)

      reader.exec('COMMIT')
      const [quiescent] = writer.pragma('wal_checkpoint(TRUNCATE)')
      expect(quiescent.busy).toBe(0)
      // TRUNCATE actually truncated: the WAL is bounded afterwards.
      expect(existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0).toBe(0)
    } finally {
      reader.close()
      writer.close()
    }
  })

  // The kill-the-worker-mid-transaction half is `graphDatabase.checkpoint.test.ts`
  // (#23) — it needs a real worker, which #21 does not ship.
  it('rolls back an uncommitted transaction and keeps integrity_check ok', () => {
    const writer = openWriter()
    seedCorpus(writer, 3)
    writer.exec('BEGIN IMMEDIATE')
    writer.prepare('INSERT INTO sections(body) VALUES (?)').run('never committed')
    // Closing with an open transaction is the graceful analogue of a kill.
    writer.close()

    const reopened = openWriter()
    try {
      expect(reopened.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 3 })
      expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      reopened.close()
    }
  })
})

describe('C9 — VACUUM is safe with a reader attached', () => {
  it('completes while a reader holds the file open', () => {
    const writer = openWriter()
    seedCorpus(writer, 30)
    const reader = openReader()

    try {
      writer.prepare('DELETE FROM sections WHERE id > 10').run()
      expect(() => writer.exec('VACUUM')).not.toThrow()
      // The reader is still usable afterwards, with no reopen.
      expect(reader.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 10 })
    } finally {
      reader.close()
      writer.close()
    }
  })

  // The free-space pre-flight — skip VACUUM rather than fail the rebuild — is a
  // simulated low-disk case in `graphDatabase.rebuild.test.ts` (#23). It cannot
  // be staged in-process without faking `statfs`.
  //
  // Nor can this body observe VACUUM's second copy: it exists only for the
  // duration of the call, under a temp name SQLite does not expose. So the test
  // is named for what it does check — that the figure the pre-flight doubles is
  // the real on-disk byte count rather than an approximation. The previous
  // `> 0` assertion held for any non-empty database and proved nothing.
  it('derives the pre-flight size from page_count * page_size, equal to the file on disk', () => {
    const writer = openWriter()
    seedCorpus(writer, 200)
    try {
      // Checkpoint first: in WAL mode the newest pages sit in `-wal` until one
      // runs, so an un-checkpointed comparison is against a stale main file.
      writer.pragma('wal_checkpoint(TRUNCATE)')
      const pageCount = writer.pragma('page_count', { simple: true })
      const pageSize = writer.pragma('page_size', { simple: true })
      // The pre-flight compares free space against 2x this number.
      expect(pageCount * pageSize).toBe(statSync(dbPath).size)
    } finally {
      writer.close()
    }
  })
})

describe('baseline — the §3.2 topology itself', () => {
  it('serves concurrent reads against a committing writer with no SQLite error', () => {
    const writer = openWriter()
    seedCorpus(writer, 20)
    const reader = openReader()
    const search = reader.prepare('SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?')

    try {
      for (let i = 0; i < 200; i++) {
        if (i % 10 === 0) {
          writer.prepare('INSERT INTO sections(body) VALUES (?)').run(`alpha extra ${i}`)
        }
        expect(search.all('alpha').length).toBeGreaterThan(0)
      }
      expect(writer.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      reader.close()
      writer.close()
    }
  })
})
