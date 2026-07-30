// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared fixtures for the `graphSchema` suites.
 *
 * `seedSection` embeds the full column list of three tables (`files`,
 * `contents`, `sections`) plus the `sections_fts` posting and the `ref_count`
 * increment. It previously existed byte-for-byte in both `graphSchema.test.ts`
 * and `graphSchema.queries.test.ts`, so any DDL change needed two identical
 * edits and a drift between them would have been invisible — one suite would
 * keep passing against a row shape the other no longer produced.
 *
 * Not a `.test.ts` file, so unlike its callers it sits INSIDE the
 * `tsconfig.node.json` program (`:10` excludes only `src/main/**\/*.test.*`).
 * That is deliberate: the fixture that encodes the schema's column list is
 * type-checked on every `npm run typecheck`.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-db-schema.md §6.3 - the DDL these columns mirror
 */
import type { Database } from 'better-sqlite3'
import { GRAPH_SCHEMA_DDL } from './graphSchema'

/** Arguments for {@link seedSection}; every field has a working default. */
export interface SeedSectionArgs {
  path?: string
  pathKey?: string
  ordinal?: number
  heading?: string
  text?: string
  contentHash?: string
  fileId?: number
  /** File extension stored in `files.extension`; filtered by `searchPage`'s
   *  `:fileType`. Defaults to `.md`. Ignored when `fileId` reuses a file. */
  extension?: string
  /** `files.mtime_ms`; filtered by `searchPage`'s `:after`/`:before`. Defaults
   *  to a fixed epoch. Ignored when `fileId` reuses a file. */
  mtime?: number
}

/**
 * Applies the graph DDL to a fresh connection and enables foreign-key
 * enforcement.
 *
 * The pragma belongs here rather than at the call site: SQLite defaults
 * `foreign_keys` to OFF **per connection**, so a suite that applies the schema
 * without it silently tests a database where the §6.7 delete-order contract
 * cannot fail.
 */
export function applySchema(db: Database): void {
  db.pragma('foreign_keys = ON')
  for (const statement of GRAPH_SCHEMA_DDL) db.exec(statement)
}

/**
 * Inserts one file + one content + one section + its FTS posting, returning the
 * new `sections.id`.
 *
 * Pass `fileId` to attach another section to an existing file. The content hash
 * defaults to a key derived from the BODY only, so two sections with the same
 * text dedup into one `contents` row — the FR-009 behaviour the `ref_count`
 * assertions depend on.
 */
export function seedSection(db: Database, args: SeedSectionArgs = {}): number {
  const {
    path = 'a.md',
    pathKey = path.toLowerCase(),
    ordinal = 0,
    heading = 'Alpha',
    text = 'alpha beta gamma',
    contentHash = `hash-${text}`,
    extension = '.md',
    mtime = 1700000000000
  } = args

  let fileId = args.fileId
  if (fileId === undefined) {
    fileId = Number(
      db
        .prepare(
          `INSERT INTO files(path, path_key, extension, mtime_ms, size_bytes, file_hash, indexed_at_ms)
           VALUES (?, ?, ?, ?, 128, 'filehash', 1700000000001)`
        )
        .run(path, pathKey, extension, mtime).lastInsertRowid
    )
  }

  db.prepare(
    `INSERT INTO contents(content_hash, text, word_count, ref_count) VALUES (?, ?, ?, 0)
     ON CONFLICT(content_hash) DO NOTHING`
  ).run(contentHash, text, text.split(/\s+/).length)

  const sectionId = Number(
    db
      .prepare(
        `INSERT INTO sections(file_id, ordinal, heading, heading_level, heading_slug,
                              heading_path, start_line, end_line, content_hash)
         VALUES (?, ?, ?, 1, 'slug', ?, 1, 10, ?)`
      )
      .run(fileId, ordinal, heading, heading, contentHash).lastInsertRowid
  )

  db.prepare('INSERT INTO sections_fts(rowid, heading, text) VALUES (?, ?, ?)').run(
    sectionId,
    heading,
    text
  )
  db.prepare('UPDATE contents SET ref_count = ref_count + 1 WHERE content_hash = ?').run(
    contentHash
  )
  return sectionId
}
