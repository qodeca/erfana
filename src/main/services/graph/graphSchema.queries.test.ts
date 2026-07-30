// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Write-path and query-catalogue behaviour, EXECUTED against a real in-memory
 * better-sqlite3 database.
 *
 * The middle segment of the §11 item 6 suite: `graphSchema.test.ts` covers the
 * DDL and its constraints, `graphSchema.rebuild.test.ts` the rebuild, stamp and
 * cross-handle contracts, and `graphSchema.meta.test.ts` the `graph_meta` point
 * lookups (schema version, generation, rebuild budget), which need no corpus.
 *
 * Two results here are the reason the design dropped `ON DELETE CASCADE` and
 * added the audit queries, and neither is visible by reading SQL:
 *
 * - With `foreign_keys = ON`, a bare `DELETE FROM files` raises
 *   `SQLITE_CONSTRAINT_FOREIGNKEY` — the failure is LOUD, which is the point.
 * - An injected `sections_fts` orphan passes BOTH `PRAGMA integrity_check` and
 *   FTS5's own `integrity-check` command, forever. It surfaces only as results
 *   that quietly never appear, so the external audit queries are the only
 *   detector that exists.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 6
 * @see specs/designs/sd-021-db-schema.md §6.5, §6.6, §6.7
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRAPH_QUERIES, GRAPH_SEARCH_HYDRATE_SQL, type GraphQueryKey } from './graphSchema'
import {
  applySchema,
  seedSection as seedSectionIn,
  type SeedSectionArgs
} from './graphSchema.testHelpers'

/** The snippet/highlight delimiters: STX/ETX, never `<mark>` — no HTML crosses IPC. */
const STX = String.fromCharCode(2)
const ETX = String.fromCharCode(3)
/** The snippet TRUNCATION marker: EOT, never a printable `'…'` (M4). */
const EOT = String.fromCharCode(4)

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
describe('delete discipline (A1/M5, §6.7)', () => {
  beforeEach(() => {
    seedSection({ path: 'a.md', ordinal: 0, heading: 'Alpha', text: 'shared body text' })
    seedSection({ path: 'a.md', ordinal: 1, heading: 'Beta', text: 'shared body text', fileId: 1 })
    seedSection({ path: 'b.md', heading: 'Gamma', text: 'other body text' })
  })

  // The point of dropping the cascade: this is LOUD.
  it('makes a bare DELETE FROM files fail with a foreign-key error', () => {
    let code: string | undefined
    try {
      db.prepare('DELETE FROM files WHERE id = 1').run()
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
    expect(db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 2 })
  })

  it('leaves zero FTS orphans and no ref_count drift after the explicit sequence', () => {
    const fileId = 1
    const removed = db
      .prepare('DELETE FROM sections WHERE file_id = ? RETURNING id, content_hash')
      .all(fileId) as Array<{ id: number; content_hash: string }>
    expect(removed).toHaveLength(2)

    for (const row of removed) {
      db.prepare('DELETE FROM sections_fts WHERE rowid = ?').run(row.id)
      db.prepare('UPDATE contents SET ref_count = ref_count - 1 WHERE content_hash = ?').run(
        row.content_hash
      )
    }
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId)

    const touched = JSON.stringify([...new Set(removed.map((r) => r.content_hash))])
    const swept = db
      .prepare(
        `DELETE FROM contents
         WHERE content_hash IN (SELECT value FROM json_each(?)) AND ref_count = 0`
      )
      .run(touched)
    expect(swept.changes).toBe(1)

    expect(db.prepare(GRAPH_QUERIES.ftsOrphanAudit).get()).toEqual({ orphanCount: 0 })
    expect(db.prepare(GRAPH_QUERIES.sectionOrphanAudit).get()).toEqual({ orphanCount: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM contents WHERE ref_count = 0').get()).toEqual({
      n: 0
    })
  })

  // The scoped sweep must not touch a body another file still references.
  it('keeps a shared body alive while a second section still references it', () => {
    seedSection({ path: 'c.md', heading: 'Delta', text: 'other body text' })
    const hash = (
      db.prepare("SELECT content_hash FROM contents WHERE text = 'other body text'").get() as {
        content_hash: string
      }
    ).content_hash
    expect(db.prepare('SELECT ref_count AS n FROM contents WHERE content_hash = ?').get(hash))
      .toEqual({ n: 2 })

    const removed = db
      .prepare('DELETE FROM sections WHERE file_id = 2 RETURNING id, content_hash')
      .all() as Array<{ id: number; content_hash: string }>
    for (const row of removed) {
      db.prepare('DELETE FROM sections_fts WHERE rowid = ?').run(row.id)
      db.prepare('UPDATE contents SET ref_count = ref_count - 1 WHERE content_hash = ?').run(
        row.content_hash
      )
    }
    db.prepare('DELETE FROM files WHERE id = 2').run()
    const swept = db
      .prepare(
        `DELETE FROM contents
         WHERE content_hash IN (SELECT value FROM json_each(?)) AND ref_count = 0`
      )
      .run(JSON.stringify([hash]))

    expect(swept.changes).toBe(0)
    expect(db.prepare('SELECT ref_count AS n FROM contents WHERE content_hash = ?').get(hash))
      .toEqual({ n: 1 })
  })

  it('leaves corpus_stats reconcilable against a recount after the delete', () => {
    const removed = db
      .prepare('DELETE FROM sections WHERE file_id = 1 RETURNING id, content_hash')
      .all() as Array<{ id: number; content_hash: string }>
    for (const row of removed) {
      db.prepare('DELETE FROM sections_fts WHERE rowid = ?').run(row.id)
      db.prepare('UPDATE contents SET ref_count = ref_count - 1 WHERE content_hash = ?').run(
        row.content_hash
      )
    }
    db.prepare('DELETE FROM files WHERE id = 1').run()
    db.prepare('DELETE FROM contents WHERE ref_count = 0').run()

    const recount = db.prepare(GRAPH_QUERIES.counterAudit).get() as Record<string, number>
    db.prepare(
      `UPDATE corpus_stats SET file_count = ?, section_count = ?, word_count = ?,
                               unique_content_count = ? WHERE id = 1`
    ).run(recount.fileCount, recount.sectionCount, recount.wordCount, recount.uniqueContentCount)

    const stats = db.prepare(GRAPH_QUERIES.corpusStats).get() as Record<string, number>
    expect(stats.fileCount).toBe(1)
    expect(stats.sectionCount).toBe(1)
    expect(stats.uniqueContentCount).toBe(1)
  })
})

describe('audits (M3, C6)', () => {
  beforeEach(() => {
    seedSection({ path: 'a.md', heading: 'Alpha', text: 'alpha body' })
    seedSection({ path: 'b.md', heading: 'Beta', text: 'beta body' })
  })

  it('reports zero orphans on a consistent corpus', () => {
    expect(db.prepare(GRAPH_QUERIES.ftsOrphanAudit).get()).toEqual({ orphanCount: 0 })
    expect(db.prepare(GRAPH_QUERIES.sectionOrphanAudit).get()).toEqual({ orphanCount: 0 })
  })

  it('detects an injected FTS posting with no section', () => {
    db.prepare('INSERT INTO sections_fts(rowid, heading, text) VALUES (9999, ?, ?)').run(
      'Ghost',
      'ghost body'
    )
    expect(db.prepare(GRAPH_QUERIES.ftsOrphanAudit).get()).toEqual({ orphanCount: 1 })
  })

  it('detects an injected section with no posting', () => {
    db.prepare('DELETE FROM sections_fts WHERE rowid = 1').run()
    expect(db.prepare(GRAPH_QUERIES.sectionOrphanAudit).get()).toEqual({ orphanCount: 1 })
  })

  // The whole justification for the audits: neither check can see divergence.
  it('confirms integrity_check cannot see an FTS orphan', () => {
    db.prepare('INSERT INTO sections_fts(rowid, heading, text) VALUES (9999, ?, ?)').run('G', 'g')
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(() =>
      db.exec("INSERT INTO sections_fts(sections_fts) VALUES('integrity-check')")
    ).not.toThrow()
    expect(db.prepare(GRAPH_QUERIES.ftsOrphanAudit).get()).toEqual({ orphanCount: 1 })
  })

  it('repairs a deliberately corrupted counter from the recount', () => {
    db.prepare('UPDATE corpus_stats SET file_count = 99, section_count = 0 WHERE id = 1').run()
    const recount = db.prepare(GRAPH_QUERIES.counterAudit).get() as Record<string, number>
    expect(recount.fileCount).toBe(2)
    expect(recount.sectionCount).toBe(2)

    db.prepare('UPDATE corpus_stats SET file_count = ?, section_count = ? WHERE id = 1').run(
      recount.fileCount,
      recount.sectionCount
    )
    const stats = db.prepare(GRAPH_QUERIES.corpusStats).get() as Record<string, number>
    expect(stats.fileCount).toBe(2)
    expect(stats.sectionCount).toBe(2)
  })

  // C6: the corpus-count path must never scan the FTS table (linear in rows).
  it('reads corpus counts without touching sections_fts', () => {
    expect(GRAPH_QUERIES.corpusStats).not.toContain('sections_fts')
    const plan = (
      db.prepare(`EXPLAIN QUERY PLAN ${GRAPH_QUERIES.corpusStats}`).all() as Array<{
        detail: string
      }>
    )
      .map((r) => r.detail)
      .join(' ')
    expect(plan).not.toContain('sections_fts')
  })

  it('sums word_count over section ROWS, so a duplicated body counts twice', () => {
    seedSection({ path: 'c.md', heading: 'Gamma', text: 'alpha body' })
    const recount = db.prepare(GRAPH_QUERIES.counterAudit).get() as Record<string, number>
    // Three sections, two of which share one two-word body.
    expect(recount.sectionCount).toBe(3)
    expect(recount.uniqueContentCount).toBe(2)
    expect(recount.wordCount).toBe(6)
  })
})

describe('query catalogue (§6.5)', () => {
  const KEYS: GraphQueryKey[] = [
    'searchPage',
    'explain',
    'corpusStats',
    'schemaVersion',
    'generation',
    'rebuildBudget',
    'ftsOrphanAudit',
    'sectionOrphanAudit',
    'counterAudit'
  ]

  it('exposes exactly the nine keys the reader may address', () => {
    expect(Object.keys(GRAPH_QUERIES).sort()).toEqual([...KEYS].sort())
  })

  // Prepares against the REAL schema: a query naming a dropped column or a
  // renamed table throws here rather than at the first user search.
  it.each(KEYS)('prepares %s against the applied DDL', (key) => {
    expect(() => db.prepare(GRAPH_QUERIES[key])).not.toThrow()
  })

  it('prepares the phase-2 hydrate statement, which is not a catalogue key', () => {
    expect(() => db.prepare(GRAPH_SEARCH_HYDRATE_SQL)).not.toThrow()
    expect(Object.values(GRAPH_QUERIES)).not.toContain(GRAPH_SEARCH_HYDRATE_SQL)
  })

  describe('searchPage', () => {
    beforeEach(() => {
      // 'ranking' in the HEADING of one section, in the TEXT of the other.
      seedSection({ path: 'docs/a.md', heading: 'Ranking rules', text: 'body about scores' })
      seedSection({ path: 'notes/b.md', heading: 'Other', text: 'a note mentioning ranking here' })
    })

    const NO_FILTERS = {
      folderKey: null,
      fileType: null,
      after: null,
      before: null,
      excludeKey: null,
      excludeSection: null,
      probeLimit: 100
    }

    it('returns both matches ranked, most relevant first', () => {
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking' }) as Array<{ sectionId: number; score: number }>
      expect(rows).toHaveLength(2)
      expect(rows[0].score).toBeLessThanOrEqual(rows[1].score)
    })

    // bm25 is NEGATIVE and ascending — a positive-score assumption inverts the
    // whole result list.
    it('produces negative bm25 scores', () => {
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking' }) as Array<{ score: number }>
      expect(rows.every((r) => r.score < 0)).toBe(true)
    })

    it('ranks a heading hit above a body hit with the 3x weight', () => {
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking' }) as Array<{ sectionId: number }>
      const headingHit = (
        db.prepare("SELECT id FROM sections WHERE heading = 'Ranking rules'").get() as {
          id: number
        }
      ).id
      expect(rows[0].sectionId).toBe(headingHit)
    })

    it('applies the folder prefix filter against path_key', () => {
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking', folderKey: 'docs/' }) as Array<{
        sectionId: number
      }>
      expect(rows).toHaveLength(1)
    })

    it('applies the extension filter', () => {
      const none = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking', fileType: '.txt' })
      expect(none).toHaveLength(0)
    })

    it('honours excludeSection, keeping siblings eligible (AC-018)', () => {
      const first = (
        db.prepare(GRAPH_QUERIES.searchPage).all({ ...NO_FILTERS, match: 'ranking' }) as Array<{
          sectionId: number
        }>
      )[0].sectionId
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking', excludeSection: first })
      expect(rows).toHaveLength(1)
    })

    it('bounds the probe with LIMIT', () => {
      const rows = db
        .prepare(GRAPH_QUERIES.searchPage)
        .all({ ...NO_FILTERS, match: 'ranking', probeLimit: 1 })
      expect(rows).toHaveLength(1)
    })
  })

  describe('phase 2 hydrate', () => {
    it('returns sentinel-delimited snippets, never HTML', () => {
      const id = seedSection({ heading: 'Alpha heading', text: 'the alpha body text goes here' })
      const row = db
        .prepare(GRAPH_SEARCH_HYDRATE_SQL)
        .get({ match: 'alpha', ids: JSON.stringify([id]) }) as {
        snippet: string
        headingHl: string
        filePath: string
      }
      expect(row.filePath).toBe('a.md')
      expect(row.snippet).toContain(STX)
      expect(row.snippet).toContain(ETX)
      expect(row.snippet).not.toContain('<mark>')
      expect(row.headingHl).toContain(STX)
    })

    // M4: `snippetTruncated` is derived from this marker. A printable '…' is
    // ambiguous with a section whose own prose ends in an ellipsis, and it
    // survives the C0/C1 strip straight into the MCP payload; EOT sits in the
    // same C0 range as the STX/ETX sentinels, so one pass removes all three.
    it('marks a clipped window with EOT, never a printable ellipsis', () => {
      const text = `${'padding '.repeat(60)}alpha ${'tail '.repeat(60)}`.trim()
      const id = seedSection({ heading: 'Long section', text })
      const row = db
        .prepare(GRAPH_SEARCH_HYDRATE_SQL)
        .get({ match: 'alpha', ids: JSON.stringify([id]) }) as { snippet: string }
      expect(row.snippet).toContain(EOT)
      expect(row.snippet).not.toContain('…')
    })

    it('hydrates only the requested rowids', () => {
      const first = seedSection({ path: 'a.md', heading: 'Alpha one', text: 'alpha body' })
      seedSection({ path: 'b.md', heading: 'Alpha two', text: 'alpha body again' })
      const rows = db
        .prepare(GRAPH_SEARCH_HYDRATE_SQL)
        .all({ match: 'alpha', ids: JSON.stringify([first]) })
      expect(rows).toHaveLength(1)
    })
  })

  describe('explain', () => {
    it('returns the whole column with every occurrence marked', () => {
      const id = seedSection({ heading: 'Alpha', text: 'alpha then alpha again and more words' })
      const row = db
        .prepare(GRAPH_QUERIES.explain)
        .get({ match: 'alpha', sectionId: id }) as { textMarked: string; headingMarked: string }
      expect(row.textMarked.split(STX)).toHaveLength(3)
      expect(row.headingMarked).toBe(`${STX}Alpha${ETX}`)
    })

    it('returns nothing for a section that does not match', () => {
      const id = seedSection({ heading: 'Alpha', text: 'alpha body' })
      expect(db.prepare(GRAPH_QUERIES.explain).get({ match: 'zzz', sectionId: id })).toBeUndefined()
    })
  })
})
