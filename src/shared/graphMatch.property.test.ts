// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Property + brand test for {@link buildMatchExpression} (#21 [13], D7).
 *
 * Two clearly-labelled halves:
 *
 * - **SAFETY (permanent).** The builder's output, executed as a real FTS5
 *   `MATCH` against an in-memory better-sqlite3 table, NEVER raises a syntax
 *   error over an adversarial corpus. This is the assertion #26 must never
 *   weaken — the safety core is the only thing between user text and the FTS5
 *   parser, and static layers (the brand, the ESLint sink rule) cannot catch a
 *   sanitiser bug.
 * - **TUNING (provisional).** The stopword drop and top-N-by-frequency behaviour.
 *   These encode INVENTED requirements (D7); #26 may revise them **without
 *   touching the safety block**.
 *
 * The compile-time brand assertions live here too (this file is inside the
 * `tsconfig.node.json` program — `src/shared/**` is included, and only
 * `src/main/**` / `src/preload/**` tests are excluded — so its
 * `@ts-expect-error` directives are actually verified by `npm run typecheck`).
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.6
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRAPH } from './graph-constants'
import { buildMatchExpression, type FtsMatchExpression } from './graphMatch'
// Type-only cross-layer import: the branded param sites live main-side, and a
// verified `@ts-expect-error` can only sit in a typechecked file (this one).
// Erased at runtime — the test bundle never carries a main-process dependency.
import type {
  GraphKeyedQueryParams,
  GraphSearchQueryParams
} from '../main/interfaces/IGraphReadConnection'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(
    `CREATE VIRTUAL TABLE fts USING fts5(
       heading, text, tokenize = 'porter unicode61 remove_diacritics 2'
     )`
  )
  db.prepare('INSERT INTO fts(rowid, heading, text) VALUES (1, ?, ?)').run(
    'alpha heading',
    'the quick brown fox jumps over the lazy dog'
  )
})

afterEach(() => {
  db.close()
})

// ─── SAFETY (permanent — #26 must NOT weaken this block) ─────────────────────

describe('SAFETY: no user input yields an FTS5 syntax error', () => {
  const LONE_HIGH_SURROGATE = '\uD800'
  const LONE_LOW_SURROGATE = '\uDC00'
  // A whole passage at the upstream MAX_QUERY_LENGTH ceiling.
  const PASSAGE = 'lorem ipsum dolor sit amet '.repeat(160).slice(0, GRAPH.MAX_QUERY_LENGTH)

  const adversarialCorpus: readonly string[] = [
    '"', // a bare quote (would be an unterminated phrase raw)
    '""', // an empty phrase
    '*', // prefix operator
    '^', // column-first operator
    '-', // negation
    ':', // column filter separator
    'NEAR(', // proximity operator, unclosed
    '{', // brace
    '}',
    '(', // parentheses (grouping)
    ')',
    LONE_HIGH_SURROGATE,
    LONE_LOW_SURROGATE,
    '   ', // whitespace only
    '\t\n ', // exotic whitespace only
    'a'.repeat(GRAPH.MAX_QUERY_LENGTH), // one enormous token
    PASSAGE, // a 4096-char passage
    'café 日本語 Ω mañana', // mixed scripts
    'é́́', // stacked combining marks
    'foo* ^bar col:baz NEAR(a b) "unclosed', // operators mixed with text
    'a AND b OR c NOT d', // bareword operators
    '- -leading double negation',
    '"embedded "quote" chaos"' // interior quotes
  ]

  it.each(adversarialCorpus)('mode=all does not throw for %j', (query) => {
    const expression = buildMatchExpression(query, 'all')
    if (expression === null) return // caller short-circuits, no SQLite touched
    expect(() => db.prepare('SELECT rowid FROM fts WHERE fts MATCH ?').all(expression)).not.toThrow()
  })

  it.each(adversarialCorpus)('mode=any does not throw for %j', (query) => {
    const expression = buildMatchExpression(query, 'any')
    if (expression === null) return
    expect(() => db.prepare('SELECT rowid FROM fts WHERE fts MATCH ?').all(expression)).not.toThrow()
  })

  it('returns null (no SQLite) when zero tokens survive', () => {
    expect(buildMatchExpression('   ', 'all')).toBeNull()
    expect(buildMatchExpression('"', 'all')).toBeNull() // escapes to "", drops empty
    expect(buildMatchExpression('""', 'any')).toBeNull()
    expect(buildMatchExpression('', 'all')).toBeNull()
  })

  it('quotes every token so operators are literal', () => {
    // `*` and `NEAR(` survive as literal quoted tokens, never as operators.
    const expression = buildMatchExpression('foo* NEAR(', 'all')
    expect(expression).toBe('"foo*" "near("')
    expect(() => db.prepare('SELECT rowid FROM fts WHERE fts MATCH ?').all(expression!)).not.toThrow()
  })
})

// ─── SAFETY (compile-time brand — both MATCH sites) ──────────────────────────

describe('SAFETY: the brand rejects a raw string at compile time', () => {
  it('makes a raw string a type error and the producer output valid', () => {
    // @ts-expect-error a raw string is not a validated FtsMatchExpression.
    const rawBrand: FtsMatchExpression = 'raw query'
    void rawBrand

    // @ts-expect-error site 1 — GraphSearchQueryParams.match (phase-1 searchPage).
    const rawSearchMatch: GraphSearchQueryParams['match'] = 'raw query'
    void rawSearchMatch

    // @ts-expect-error site 2 — queryAll/queryGet params (the `explain` MATCH site).
    const rawKeyedParams: GraphKeyedQueryParams = { match: 'raw query' }
    void rawKeyedParams

    // Positive: the producer's output satisfies BOTH branded sites.
    const produced = buildMatchExpression('hello world', 'all')
    expect(produced).not.toBeNull()
    if (produced !== null) {
      const searchMatch: GraphSearchQueryParams['match'] = produced
      const keyedParams: GraphKeyedQueryParams = { match: produced, sectionId: 1 }
      void searchMatch
      void keyedParams
    }
  })
})

// ─── TUNING (PROVISIONAL — #26 may revise WITHOUT touching the safety block) ──

describe('TUNING: invented stopword + top-N behaviour (D7)', () => {
  it('drops invented English stopwords', () => {
    expect(buildMatchExpression('the quick brown fox', 'all')).toBe('"quick" "brown" "fox"')
  })

  it('restores the original set when every token is a stopword', () => {
    expect(buildMatchExpression('the and or', 'all')).toBe('"the" "and" "or"')
  })

  it('joins with implicit AND for mode=all and OR for mode=any', () => {
    expect(buildMatchExpression('quick fox', 'all')).toBe('"quick" "fox"')
    expect(buildMatchExpression('quick fox', 'any')).toBe('"quick" OR "fox"')
  })

  it('keeps at most GRAPH.MAX_QUERY_TERMS distinct tokens, dropping the least frequent', () => {
    // 25 distinct non-stopword tokens, each appearing once → tie-break is
    // first-occurrence order, so the LAST distinct token is dropped.
    const distinct = Array.from({ length: GRAPH.MAX_QUERY_TERMS + 1 }, (_, i) => `term${i}`)
    const expression = buildMatchExpression(distinct.join(' '), 'all')
    expect(expression).not.toBeNull()
    const tokens = expression!.split(' ')
    expect(tokens).toHaveLength(GRAPH.MAX_QUERY_TERMS)
    expect(expression).not.toContain(`"term${GRAPH.MAX_QUERY_TERMS}"`)
    expect(expression).toContain('"term0"')
  })

  it('deduplicates and ranks by frequency', () => {
    // `gamma` appears twice (highest freq), the rest once; all kept and unique.
    const expression = buildMatchExpression('gamma alpha gamma beta', 'all')
    expect(expression).toBe('"gamma" "alpha" "beta"')
  })
})
