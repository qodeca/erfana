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
  parseSearchRequest,
  type GraphSearchRequest,
  type GraphSearchRequestInput,
  type GraphSearchRequestValidated
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

    it('accepts offset at MAX_COUNT_PROBE - 1 when k leaves room (k = 1)', () => {
      // The offset field's own ceiling is MAX_COUNT_PROBE - 1; it is only reachable
      // with k = 1, since the joint refine also caps offset + k at MAX_COUNT_PROBE.
      const offset = GRAPH.MAX_COUNT_PROBE - 1
      expect(GraphSearchRequestSchema.parse({ ...MINIMAL_SEARCH, offset, k: 1 }).offset).toBe(offset)
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

  // [#21] offset and k cap INDEPENDENTLY on the base (offset <= MAX_COUNT_PROBE - 1,
  // k <= MAX_TOP_K), so without the joint leaf refine `offset: 999, k: 100` asks
  // for rows 999–1098 from a probe capped at MAX_COUNT_PROBE (1000): the last page
  // returns one row while hasMore reads false. The refine binds
  // offset + k <= MAX_COUNT_PROBE so the slice rows.slice(offset, offset + k) holds.
  describe('joint offset + k probe bound', () => {
    it('rejects offset: 999, k: 100 even though each is individually at its own ceiling', () => {
      expect(GRAPH.MAX_COUNT_PROBE - 1).toBe(999)
      expect(100).toBeLessThanOrEqual(GRAPH.MAX_TOP_K)
      expect(GraphSearchRequestSchema.safeParse({ query: 'x', offset: 999, k: 100 }).success).toBe(
        false
      )
    })

    it('accepts offset: 0, k: MAX_TOP_K', () => {
      expect(
        GraphSearchRequestSchema.safeParse({ query: 'x', offset: 0, k: GRAPH.MAX_TOP_K }).success
      ).toBe(true)
    })

    it('accepts the boundary offset + k === MAX_COUNT_PROBE', () => {
      const k = GRAPH.MAX_TOP_K
      const offset = GRAPH.MAX_COUNT_PROBE - k
      expect(GraphSearchRequestSchema.parse({ query: 'x', offset, k }).offset).toBe(offset)
    })

    it('rejects offset + k one over MAX_COUNT_PROBE', () => {
      const k = GRAPH.MAX_TOP_K
      const offset = GRAPH.MAX_COUNT_PROBE - k + 1
      expect(GraphSearchRequestSchema.safeParse({ query: 'x', offset, k }).success).toBe(false)
    })

    it('applies the bound against the DEFAULT k when k is omitted', () => {
      // offset + default k (DEFAULT_TOP_K) exceeds MAX_COUNT_PROBE by 1.
      const offset = GRAPH.MAX_COUNT_PROBE - GRAPH.DEFAULT_TOP_K + 1
      expect(GraphSearchRequestSchema.safeParse({ query: 'x', offset }).success).toBe(false)
    })
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

    // D6: inbound is bounded + model-safe, NOT pattern-pinned. A caller may supply
    // its own trace id (the short `idx-1-ab` above, or a full main-minted one),
    // and either is echoed verbatim; only bound and control-safety are enforced.
    it('accepts and echoes a full main-minted id supplied by the caller', () => {
      const parsed = GraphSearchRequestSchema.parse({
        ...MINIMAL_SEARCH,
        correlationId: 'idx-1-abcdef012345'
      })
      expect(parsed.correlationId).toBe('idx-1-abcdef012345')
    })

    it('rejects an empty id — absent and blank must not be the same thing', () => {
      expect(
        GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, correlationId: '' }).success
      ).toBe(false)
    })

    it('rejects an over-long inbound id (>128 chars)', () => {
      expect(
        GraphSearchRequestSchema.safeParse({
          ...MINIMAL_SEARCH,
          correlationId: 'x'.repeat(129)
        }).success
      ).toBe(false)
    })

    // D6 makes inbound "control-safe" via isModelSafeText, which — matching the
    // model-text predicate — permits tab/newline. A correlation id never
    // legitimately carries them, but a newline that slips in inbound cannot reach
    // a field a reader trusts: every OUTBOUND correlation field is pattern-pinned,
    // so main re-mints rather than echo a non-conforming id. The smuggling vectors
    // isModelSafeText DOES reject are what matter here.
    it.each([
      ['an ANSI escape', `idx-1${String.fromCodePoint(0x1b)}abcdef`],
      ['a C1 control', `idx-1${String.fromCodePoint(0x9b)}abcdef`],
      ['a Unicode tag char', `idx-1-${String.fromCodePoint(0xe0041)}`]
    ])('rejects a control-laden inbound id carrying %s', (_label, correlationId) => {
      expect(
        GraphSearchRequestSchema.safeParse({ ...MINIMAL_SEARCH, correlationId }).success
      ).toBe(false)
    })
  })
})

// S-[6]: `IGraphSearchService` claims it takes an "already validated" request.
// The brand makes that the compiler's job: only `parseSearchRequest` mints
// `GraphSearchRequestValidated`, so skipping the parse cannot typecheck.
describe('parseSearchRequest (branded validation)', () => {
  it('resolves defaults and returns a usable request', () => {
    const validated = parseSearchRequest({ query: 'alpha' })
    expect(validated.k).toBe(GRAPH.DEFAULT_TOP_K)
    expect(validated.query).toBe('alpha')
  })

  it('rejects an invalid request just like the schema', () => {
    expect(() => parseSearchRequest({})).toThrow()
  })

  it('brands so an unparsed request cannot reach a validated-only sink', () => {
    const sink = (_req: GraphSearchRequestValidated): void => {}
    sink(parseSearchRequest({ query: 'alpha' })) // the only accepted path

    const merelyParsed = GraphSearchRequestSchema.parse({ query: 'alpha' })
    // @ts-expect-error a merely-shaped request lacks the validation brand — if this
    // stops erroring, the brand has been weakened and no-parse became legal.
    sink(merelyParsed)
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

  // D6: outbound is pattern-pinned to the main-minted shape. The short `idx-1-ab`
  // a caller may send inbound is NOT a valid response id — main mints or echoes
  // only a value that still matches the pattern.
  it.each([
    ['a short inbound-style id', 'idx-1-ab'],
    ['a job-prefixed id', 'job-1-abcdef012345'],
    ['a free-form id', 'my-trace-id']
  ])('rejects a non-pattern outbound correlationId: %s', (_label, correlationId) => {
    expect(
      GraphSearchResponseSchema.safeParse({ ...VALID_RESPONSE, correlationId }).success
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

  // [#29] The response bounded nothing — an unbounded results array, in contrast
  // to the status snapshot which caps every array. `k` caps the page, so a
  // response carrying more than GRAPH.MAX_TOP_K results is malformed.
  it('accepts exactly GRAPH.MAX_TOP_K results', () => {
    const results = Array.from({ length: GRAPH.MAX_TOP_K }, () => VALID_RESULT)
    expect(GraphSearchResponseSchema.parse({ ...VALID_RESPONSE, results }).results).toHaveLength(
      GRAPH.MAX_TOP_K
    )
  })

  it('rejects one result over GRAPH.MAX_TOP_K', () => {
    const results = Array.from({ length: GRAPH.MAX_TOP_K + 1 }, () => VALID_RESULT)
    expect(GraphSearchResponseSchema.safeParse({ ...VALID_RESPONSE, results }).success).toBe(false)
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

  // [#29] heading/headingPath/snippet were unbounded strings, unlike their status
  // snapshot siblings which carry MAX_STATUS_PATH_LENGTH ceilings. Match that.
  it.each(['heading', 'headingPath', 'snippet'])(
    'bounds %s at MAX_STATUS_PATH_LENGTH',
    (field) => {
      const atCap = { ...VALID_RESULT, [field]: 'x'.repeat(GRAPH.MAX_STATUS_PATH_LENGTH) }
      const overCap = { ...VALID_RESULT, [field]: 'x'.repeat(GRAPH.MAX_STATUS_PATH_LENGTH + 1) }
      expect(GraphSearchResultSchema.safeParse(atCap).success).toBe(true)
      expect(GraphSearchResultSchema.safeParse(overCap).success).toBe(false)
    }
  )
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

