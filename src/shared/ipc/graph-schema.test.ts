// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph renderer-boundary schemas — search and explain.
 *
 * The §11 item 1 suite is split so no file exceeds the house cap: filters live
 * in `graph-schema.filters.test.ts`, the status/progress payloads in
 * `graph-status-schema.test.ts`, the job payloads in
 * `graph-schema.jobs.test.ts`, and the error vocabulary plus path confinement
 * in `graph-error-schema.test.ts` — the last mirroring the module split §4.2
 * names.
 *
 * Two properties carry the weight here, and each is silent rather than loud
 * when it breaks:
 *
 * - `z.strictObject` on requests: a `matchmode` case typo would otherwise be
 *   stripped, the request would parse, and `matchMode` would resolve to its
 *   default with nothing to show for it.
 * - `correlationId` is optional inbound and REQUIRED outbound, so a response
 *   that loses it fails at the boundary rather than in a renderer that cannot
 *   correlate it.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 1
 * @see specs/designs/sd-021-ipc-contracts.md §7
 */
import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../errors'
import { GRAPH } from '../graph-constants'
import {
  GraphExplainRequestSchema,
  GraphExplainResponseSchema,
  GraphMatchMode,
  GraphMatchedTermSchema,
  GraphSearchRequestSchema,
  GraphSearchResponseSchema,
  GraphSearchResultSchema,
  GraphTermOffsetSchema,
  type GraphSearchRequest,
  type GraphSearchRequestInput
} from './graph-schema'

/** Structural omission — the payload genuinely lacks the key, rather than
 *  carrying it as an explicit `undefined`, which zod can treat differently. */
function omitKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
}

/** Minimal request that satisfies every required field. */
const MINIMAL_SEARCH: GraphSearchRequestInput = { query: 'alpha' }

const VALID_RESULT = {
  sectionId: 7,
  filePath: 'docs/a.md',
  heading: 'Alpha',
  headingPath: 'Alpha',
  headingSlug: 'alpha',
  headingLevel: 1,
  startLine: 1,
  endLine: 12,
  snippet: 'alpha beta',
  snippetTruncated: false,
  score: -1.25,
  matchedTerms: []
}

describe('GraphSearchRequestSchema', () => {
  describe('defaults and input/output split (M14)', () => {
    it('resolves every default from a query alone', () => {
      expect(GraphSearchRequestSchema.parse(MINIMAL_SEARCH)).toEqual({
        query: 'alpha',
        matchMode: 'all',
        k: GRAPH.DEFAULT_TOP_K,
        offset: 0,
        includeMatchedTerms: true
      })
    })

    it('fails on parse(undefined) even though every other field defaults', () => {
      expect(GraphSearchRequestSchema.safeParse(undefined).success).toBe(false)
    })

    it('fails on parse({}) because query has no default', () => {
      expect(GraphSearchRequestSchema.safeParse({}).success).toBe(false)
    })

    it('types the input as omission-tolerant and the output as resolved', () => {
      const input: GraphSearchRequestInput = { query: 'alpha' }
      const output: GraphSearchRequest = {
        query: 'alpha',
        matchMode: 'all',
        k: 10,
        offset: 0,
        includeMatchedTerms: true
      }
      // @ts-expect-error the OUTPUT type requires the defaulted fields; if this
      // stops erroring, `.default()` has leaked into z.output and every
      // post-safeParse consumer silently regains four `| undefined`s.
      const notAnOutput: GraphSearchRequest = { query: 'alpha' }
      expect([input, output, notAnOutput].every((r) => r.query === 'alpha')).toBe(true)
    })
  })

  describe('query', () => {
    it('trims surrounding whitespace', () => {
      expect(GraphSearchRequestSchema.parse({ query: '  alpha  ' }).query).toBe('alpha')
    })

    it.each(['', '   ', '\t\n', ' '.repeat(80)])(
      'rejects the whitespace-only query %j, proving .trim() runs before .min(1)',
      (query) => {
        expect(GraphSearchRequestSchema.safeParse({ query }).success).toBe(false)
      }
    )

    it('accepts a query at exactly MAX_QUERY_LENGTH', () => {
      const query = 'a'.repeat(GRAPH.MAX_QUERY_LENGTH)
      expect(GraphSearchRequestSchema.parse({ query }).query).toHaveLength(GRAPH.MAX_QUERY_LENGTH)
    })

    it('rejects a query one character over MAX_QUERY_LENGTH', () => {
      const query = 'a'.repeat(GRAPH.MAX_QUERY_LENGTH + 1)
      expect(GraphSearchRequestSchema.safeParse({ query }).success).toBe(false)
    })

    // The punctuation short-circuit is #26's search-service concern; at the
    // schema layer these are ordinary non-empty strings and MUST parse.
    it.each(['???', '((', '"', '- -', '*'])('accepts the punctuation-only query %j', (query) => {
      expect(GraphSearchRequestSchema.safeParse({ query }).success).toBe(true)
    })
  })

  describe('bounds', () => {
    it.each([0, -1, 1.5, GRAPH.MAX_TOP_K + 1])('rejects k = %s', (k) => {
      expect(GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, k }).success).toBe(false)
    })

    it.each([1, GRAPH.DEFAULT_TOP_K, GRAPH.MAX_TOP_K])('accepts k = %s', (k) => {
      expect(GraphSearchRequestSchema.parse({ ...MINIMAL_SEARCH, k }).k).toBe(k)
    })

    it('accepts offset at MAX_COUNT_PROBE - 1', () => {
      const offset = GRAPH.MAX_COUNT_PROBE - 1
      expect(GraphSearchRequestSchema.parse({ ...MINIMAL_SEARCH, offset }).offset).toBe(offset)
    })

    it.each([GRAPH.MAX_COUNT_PROBE, GRAPH.MAX_COUNT_PROBE + 1, -1])(
      'rejects offset = %s, which would leave totalMatched/hasMore undefined',
      (offset) => {
        expect(GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, offset }).success).toBe(
          false
        )
      }
    )
  })

  describe('matchMode', () => {
    it.each(['all', 'any'] as const)('accepts %s', (matchMode) => {
      expect(GraphMatchMode.parse(matchMode)).toBe(matchMode)
      expect(GraphSearchRequestSchema.parse({ ...MINIMAL_SEARCH, matchMode }).matchMode).toBe(
        matchMode
      )
    })

    it.each(['ALL', 'and', 'or', 'any ', ''])('rejects the unknown member %j', (matchMode) => {
      expect(GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, matchMode }).success).toBe(
        false
      )
    })
  })

  describe('strictObject (m4)', () => {
    // The named bug: a case typo would be stripped by a plain z.object, the
    // request would parse, and matchMode would silently resolve to 'all'.
    it('rejects the matchmode case typo rather than stripping it', () => {
      const result = GraphSearchRequestSchema.safeParse({ query: 'alpha', matchmode: 'any' })
      expect(result.success).toBe(false)
    })

    it.each(['limit', 'topK', 'Query', 'includeMatchedTerm', 'filter'])(
      'rejects the unknown request key %s',
      (key) => {
        expect(
          GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, [key]: 1 }).success
        ).toBe(false)
      }
    )
  })

  describe('correlationId', () => {
    it('parses a request that omits it', () => {
      expect(GraphSearchRequestSchema.parse(MINIMAL_SEARCH).correlationId).toBeUndefined()
    })

    it('echoes a supplied id', () => {
      const parsed = GraphSearchRequestSchema.parse({ ...MINIMAL_SEARCH, correlationId: 'idx-1-ab' })
      expect(parsed.correlationId).toBe('idx-1-ab')
    })

    it('rejects an empty id — absent and blank must not be the same thing', () => {
      expect(
        GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, correlationId: '' }).success
      ).toBe(false)
    })
  })
})

describe('GraphSearchResponseSchema', () => {
  const VALID_RESPONSE = {
    results: [VALID_RESULT],
    totalMatched: 1,
    totalMatchedCapped: false,
    hasMore: false,
    offset: 0,
    k: 10,
    queryDurationMs: 1.25,
    degraded: false,
    error: null,
    correlationId: 'idx-1-abcdef012345'
  }

  it('round-trips a full response', () => {
    expect(GraphSearchResponseSchema.parse(VALID_RESPONSE)).toEqual(VALID_RESPONSE)
  })

  it('fails when correlationId is omitted — it is required outbound', () => {
    const withoutId = omitKey(VALID_RESPONSE, 'correlationId')
    expect(GraphSearchResponseSchema.safeParse(withoutId).success).toBe(false)
  })

  it('fails on a blank correlationId', () => {
    expect(
      GraphSearchResponseSchema.safeParse({ ...VALID_RESPONSE, correlationId: '' }).success
    ).toBe(false)
  })

  // Responses stay permissive so main can add a field without breaking an older
  // renderer mid-upgrade. This is the deliberate asymmetry with requests.
  it('strips an unknown response key instead of rejecting it', () => {
    const parsed = GraphSearchResponseSchema.parse({ ...VALID_RESPONSE, futureField: 1 })
    expect(parsed).not.toHaveProperty('futureField')
  })

  it('carries a structured error alongside degraded results', () => {
    const parsed = GraphSearchResponseSchema.parse({
      ...VALID_RESPONSE,
      degraded: true,
      error: { code: ErrorCode.GRAPH_INDEX_STALE, atMs: 5 }
    })
    expect(parsed.error?.code).toBe(ErrorCode.GRAPH_INDEX_STALE)
    expect(parsed.error?.relativePath).toBeNull()
  })

  it('rejects a non-graph error code on the envelope', () => {
    expect(
      GraphSearchResponseSchema.safeParse({
        ...VALID_RESPONSE,
        error: { code: ErrorCode.WHISPER_PROCESS_FAILED, atMs: 5 }
      }).success
    ).toBe(false)
  })
})

describe('GraphSearchResultSchema', () => {
  it('round-trips a result', () => {
    expect(GraphSearchResultSchema.parse(VALID_RESULT)).toEqual(VALID_RESULT)
  })

  it('accepts headingLevel 0, the pre-heading preamble marker', () => {
    expect(GraphSearchResultSchema.parse({ ...VALID_RESULT, headingLevel: 0 }).headingLevel).toBe(0)
  })

  it.each([-1, 7, 1.5])('rejects headingLevel %s', (headingLevel) => {
    expect(GraphSearchResultSchema.safeParse({ ...VALID_RESULT, headingLevel }).success).toBe(false)
  })

  // bm25() is negative and ascending — a schema that demanded a positive score
  // would reject every real row.
  it('accepts a negative score', () => {
    expect(GraphSearchResultSchema.parse({ ...VALID_RESULT, score: -12.5 }).score).toBe(-12.5)
  })

  it.each([0, -1])('rejects sectionId %s', (sectionId) => {
    expect(GraphSearchResultSchema.safeParse({ ...VALID_RESULT, sectionId }).success).toBe(false)
  })

  it('rejects startLine 0 — lines are 1-based', () => {
    expect(GraphSearchResultSchema.safeParse({ ...VALID_RESULT, startLine: 0 }).success).toBe(false)
  })
})

describe('GraphMatchedTermSchema', () => {
  const TERM = {
    term: 'alpha',
    column: 'text' as const,
    occurrencesInSnippet: 2,
    offsets: [{ start: 0, length: 5 }]
  }

  it('defaults occurrencesInSection to null', () => {
    expect(GraphMatchedTermSchema.parse(TERM).occurrencesInSection).toBeNull()
  })

  // H2: `term` is the marked DOCUMENT token, not the query term. Phase 2 issues
  // ONE snippet()/highlight() with the whole multi-term :match, so FTS5 marks
  // matching tokens without saying which query term produced each mark — the
  // stemmed query form is not recoverable, and is ambiguous when two terms
  // share a stem. The schema cannot enforce that, so the assertion is that the
  // stemmed surface form parses: `'indexing'` is a legal value for the query
  // `'index'`, which the old "this is the query form" reading forbade.
  it('accepts a stemmed document token that differs from the query term', () => {
    expect(GraphMatchedTermSchema.parse({ ...TERM, term: 'indexing' }).term).toBe('indexing')
  })

  it.each(['heading', 'text'] as const)('accepts column %s', (column) => {
    expect(GraphMatchedTermSchema.parse({ ...TERM, column }).column).toBe(column)
  })

  it('rejects a column index instead of a name', () => {
    expect(GraphMatchedTermSchema.safeParse({ ...TERM, column: 1 }).success).toBe(false)
  })

  it('rejects a zero-length offset — a highlight of nothing is a bug', () => {
    expect(GraphTermOffsetSchema.safeParse({ start: 0, length: 0 }).success).toBe(false)
  })

  it('accepts a zero start offset', () => {
    expect(GraphTermOffsetSchema.parse({ start: 0, length: 1 }).start).toBe(0)
  })
})

describe('GraphExplainRequestSchema', () => {
  it('defaults matchMode and leaves correlationId optional', () => {
    expect(GraphExplainRequestSchema.parse({ sectionId: 4, query: 'alpha' })).toEqual({
      sectionId: 4,
      query: 'alpha',
      matchMode: 'all'
    })
  })

  it('rejects an unknown key', () => {
    expect(
      GraphExplainRequestSchema.safeParse({ sectionId: 4, query: 'a', k: 1 }).success
    ).toBe(false)
  })

  it.each([0, -1, 1.5])('rejects sectionId %s', (sectionId) => {
    expect(GraphExplainRequestSchema.safeParse({ sectionId, query: 'a' }).success).toBe(false)
  })

  it('rejects a whitespace-only query', () => {
    expect(GraphExplainRequestSchema.safeParse({ sectionId: 4, query: '  ' }).success).toBe(false)
  })
})

describe('GraphExplainResponseSchema', () => {
  const VALID_EXPLAIN = {
    sectionId: 4,
    windows: [{ term: 'alpha', column: 'text' as const, text: 'alpha beta', offsets: [] }],
    occurrencesInSection: { alpha: 3 },
    error: null,
    correlationId: 'idx-1-abcdef012345'
  }

  it('round-trips', () => {
    expect(GraphExplainResponseSchema.parse(VALID_EXPLAIN)).toEqual(VALID_EXPLAIN)
  })

  it('fails without correlationId', () => {
    const withoutId = omitKey(VALID_EXPLAIN, 'correlationId')
    expect(GraphExplainResponseSchema.safeParse(withoutId).success).toBe(false)
  })

  it('accepts an empty occurrence record', () => {
    expect(
      GraphExplainResponseSchema.parse({ ...VALID_EXPLAIN, occurrencesInSection: {} })
        .occurrencesInSection
    ).toEqual({})
  })
})

