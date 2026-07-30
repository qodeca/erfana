// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The FTS5 match-expression builder — the ONLY safe path from untrusted user
 * query text to a bound SQLite FTS5 `MATCH` clause.
 *
 * **Module placement.** This lives in `src/shared/` rather than beside
 * `graphSchema.ts` for two reasons: (1) it needs imports (`GRAPH` and the
 * `GraphMatchMode` type), which `graphSchema.ts`'s zero-`import` bundle-boundary
 * rule forbids; (2) both of its imports are shared-only (`src/shared/*`), so it
 * has no main-only dependency and belongs at the shared layer. The branded
 * {@link FtsMatchExpression} it produces is imported main-side by
 * `IGraphReadConnection.ts`, and main may import shared.
 *
 * ## Why binding alone is insufficient (the SAFETY CORE)
 *
 * SQLite parses the string bound to a FTS5 `MATCH` clause as its **own** query
 * grammar. A bound parameter does not neutralise that grammar — the parser still
 * interprets `*` (prefix), `^` (column-first), `col:` (column filter),
 * `NEAR(...)`, the bareword operators `AND`/`OR`/`NOT`, parentheses and `"..."`
 * phrases. So a raw user query reaching `MATCH` is both an injection/DoS surface
 * (unbounded prefix scans, wide `NEAR`) and a correctness hazard (a stray `"`
 * is a syntax error).
 *
 * The safety core neutralises all of it with one move: each token is wrapped in
 * a double-quoted FTS5 string with any internal `"` doubled. Inside a
 * double-quoted FTS5 string `*`, `^`, `-`, `:`, `(`, `)`, `NEAR(` and the
 * bareword operators `AND`/`OR`/`NOT` are all **literal**, and a doubled `""` is
 * a literal quote — there is no way to terminate the quoted string early. This
 * is the assertion the permanent half of the property test pins and #26 must
 * never weaken.
 *
 * ## Invented tuning (PROVISIONAL — D7, owner #26 may revise)
 *
 * Per **decision D7**, this builder is committed whole, including a stopword drop
 * and a top-N-by-frequency reduction that exist **nowhere** in the repo or the
 * spec — they are invented here so #26 inherits a *specification* it can revise
 * rather than undocumented behaviour. The tuning is kept strictly separable from
 * the safety core (below the `escaped` tokens are already safe; tuning only
 * removes or reorders them, never un-escapes), so revising it cannot reopen the
 * injection surface. The invented rules, in full:
 *
 * - **Stopword list** — {@link ENGLISH_STOPWORDS}, 50 high-frequency English
 *   function words (`a`, `an`, `and`, … `your`). **Language assumption: English
 *   only.** This matches the FTS5 tokeniser the schema configures
 *   (`porter unicode61 remove_diacritics 2` in `GRAPH_SCHEMA_DDL`), whose porter
 *   stemmer is English. No other language is handled; a non-English query simply
 *   keeps all its tokens (none match the list), which is safe but unranked.
 * - **Stopword restore** — if dropping stopwords empties the set (an all-stopword
 *   query such as `the and or`), the pre-drop set is restored so the search still
 *   runs rather than returning nothing.
 * - **N = `GRAPH.MAX_QUERY_TERMS`** (24). The related-content sidebar sends a
 *   whole passage as the query (`MAX_QUERY_LENGTH` is 4096), so the reduction
 *   caps how many terms reach FTS5.
 * - **Ranking + tie-break** — distinct tokens are ranked by descending frequency;
 *   **ties are broken by earliest first occurrence** in the query. The top N
 *   distinct tokens are kept (selection **deduplicates**), and are emitted in
 *   first-occurrence order for determinism. Term order does not affect an
 *   implicit-AND / `OR` FTS5 match, but a stable order keeps the output testable.
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.6 - the single normative definition
 * @see Issue #21 - graph R1 architecture (owner reassigned from #26 per D7)
 */
import { GRAPH } from './graph-constants'
import type { GraphMatchMode } from './ipc/graph-schema'

/**
 * A validated FTS5 match expression: quoted tokens joined by `' '` (implicit AND)
 * or `' OR '`. **{@link buildMatchExpression} is the only producer** — the brand
 * makes a raw user string a compile error wherever an `FtsMatchExpression` is
 * required, so the "binding alone is not enough" hazard cannot regress silently.
 */
export type FtsMatchExpression = string & { readonly __fts: unique symbol }

/**
 * Invented stopword list (D7, PROVISIONAL). English only — see the module JSDoc.
 * #26 may revise this list without touching the safety core.
 */
const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but',
  'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'if',
  'in', 'into', 'is', 'it', 'its', 'no', 'nor', 'not', 'of', 'on',
  'or', 'our', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'was', 'were', 'will', 'with', 'you'
])

/**
 * SAFETY CORE — tokenise, NFC-normalise, lower-case, and quote-escape.
 *
 * Returns the surviving tokens **already escaped** (internal `"` doubled) but not
 * yet wrapped: tokenise on Unicode whitespace, drop empties, then drop any token
 * that reduces to the empty string once its quotes are removed (a lone `"`
 * escapes to `""` and is dropped here). Every returned token, once wrapped in
 * `"..."`, is a syntactically valid FTS5 phrase.
 */
function toEscapedTokens(query: string): string[] {
  return query
    .split(/\p{White_Space}+/u)
    .filter(Boolean)
    .map((token) => token.normalize('NFC').toLowerCase())
    .map((token) => token.replace(/"/g, '""'))
    .filter((token) => token.replace(/"/g, '').trim().length >= 1)
}

/** TUNING (provisional) — drop invented English stopwords. */
function dropStopwords(tokens: string[]): string[] {
  return tokens.filter((token) => !ENGLISH_STOPWORDS.has(token))
}

/**
 * TUNING (provisional) — keep the top `limit` distinct tokens by frequency.
 *
 * Ranks distinct tokens by descending frequency, breaking ties by earliest
 * first occurrence; deduplicates; emits the survivors in first-occurrence order.
 */
function topByFrequency(tokens: string[], limit: number): string[] {
  const frequency = new Map<string, number>()
  const firstIndex = new Map<string, number>()
  tokens.forEach((token, index) => {
    frequency.set(token, (frequency.get(token) ?? 0) + 1)
    if (!firstIndex.has(token)) firstIndex.set(token, index)
  })

  const distinct = [...frequency.keys()]
  const ranked = distinct.slice().sort((a, b) => {
    const byFrequency = (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0)
    if (byFrequency !== 0) return byFrequency
    return (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0)
  })

  const kept = new Set(ranked.slice(0, limit))
  return distinct
    .filter((token) => kept.has(token))
    .sort((a, b) => (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0))
}

/**
 * Build a safe FTS5 match expression from an untrusted user query.
 *
 * @param query - Raw user query text (already length-bounded upstream by
 *   `GRAPH.MAX_QUERY_LENGTH` on the zod request schema).
 * @param matchMode - `'all'` joins tokens with a space (implicit AND); `'any'`
 *   joins with `' OR '`.
 * @returns A branded {@link FtsMatchExpression}, or `null` when zero tokens
 *   survive normalisation — the caller must short-circuit `null` to an empty
 *   result set **without touching SQLite**, so `GRAPH_SEARCH_QUERY_INVALID` is
 *   unreachable from user input.
 */
export function buildMatchExpression(
  query: string,
  matchMode: GraphMatchMode
): FtsMatchExpression | null {
  // ── SAFETY CORE ──────────────────────────────────────────────────────────
  const escaped = toEscapedTokens(query)
  if (escaped.length === 0) return null

  // ── TUNING (provisional, D7) ─────────────────────────────────────────────
  let tuned = dropStopwords(escaped)
  if (tuned.length === 0) tuned = escaped
  tuned = topByFrequency(tuned, GRAPH.MAX_QUERY_TERMS)

  // ── SAFETY CORE — wrap and join ──────────────────────────────────────────
  const join = matchMode === 'all' ? ' ' : ' OR '
  const expression = tuned.map((token) => `"${token}"`).join(join)
  return expression as FtsMatchExpression
}
