// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the MCP boundary schemas.
 *
 * Two distinct trust boundaries share this file, and the tests keep them
 * distinguishable:
 *
 * - **main ↔ utilityProcess** over a `MessageChannelMain` — in-process, fenced
 *   with `switchVersion`, no token.
 * - **external client ↔ endpoint** over an ACL'd socket — the boundary any
 *   local process can reach, hence the 256-bit token and the handshake.
 *
 * The tool input is the narrowest surface in the design: it is derived from
 * `GraphSearchRequestBaseSchema` by `.pick()` + `.extend()`, so the assertions
 * below pin what that derivation MUST NOT let through — `offset`, `correlationId`
 * and `excludeSectionId`, none of which a model can know, and a `k` above
 * `MCP.MAX_TOP_K`. Every request lands on the synchronous main-thread reader
 * from outside the trust boundary, so the request shape is the cheapest bound.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7.10
 * @see specs/designs/sd-021-cross-cutting.md §9.3, §9.4, §9.5
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ErrorCode } from '../errors'
import { GRAPH, MCP } from '../graph-constants'
import {
  GraphMcpConnectAckSchema,
  GraphMcpConnectSchema,
  GraphMcpToolArgsSchema,
  GraphMcpToolResultSchema,
  GraphPortDrainRequestSchema,
  GraphPortDrainedSchema,
  GraphPortRequestSchema,
  GraphPortResponseSchema,
  GraphPortSearchErrorSchema,
  GraphPortSearchRequestSchema,
  GraphPortSearchResultSchema,
  GraphPortThrottledSchema,
  isModelSafeText
} from './graph-mcp-schema'

/** Structural omission — the payload genuinely lacks the key, rather than
 *  carrying it as an explicit `undefined`, which zod can treat differently. */
function omitKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
}

const TOOL_RESULT = {
  untrustedContentNotice: MCP.UNTRUSTED_NOTICE,
  results: [{ filePath: 'docs/a.md', heading: 'Alpha', snippet: 'alpha beta', score: -1.25 }],
  truncated: false
}

const HEX64 = 'a'.repeat(64)

describe('GraphMcpToolArgsSchema', () => {
  it('resolves k from a query alone', () => {
    expect(GraphMcpToolArgsSchema.parse({ query: 'alpha' })).toEqual({
      query: 'alpha',
      k: GRAPH.DEFAULT_TOP_K
    })
  })

  it('fails on parse({}) — query has no default', () => {
    expect(GraphMcpToolArgsSchema.safeParse({}).success).toBe(false)
  })

  it('fails on parse(undefined)', () => {
    expect(GraphMcpToolArgsSchema.safeParse(undefined).success).toBe(false)
  })

  describe('k is bounded harder than the renderer', () => {
    it('MCP.MAX_TOP_K is strictly below GRAPH.MAX_TOP_K', () => {
      expect(MCP.MAX_TOP_K).toBeLessThan(GRAPH.MAX_TOP_K)
    })

    it('accepts k at MCP.MAX_TOP_K', () => {
      expect(GraphMcpToolArgsSchema.parse({ query: 'a', k: MCP.MAX_TOP_K }).k).toBe(MCP.MAX_TOP_K)
    })

    it('rejects k one over MCP.MAX_TOP_K even though the renderer allows it', () => {
      const k = MCP.MAX_TOP_K + 1
      expect(GraphMcpToolArgsSchema.safeParse({ query: 'a', k }).success).toBe(false)
      expect(k).toBeLessThanOrEqual(GRAPH.MAX_TOP_K)
    })

    it('rejects k = GRAPH.MAX_TOP_K, the renderer ceiling', () => {
      expect(GraphMcpToolArgsSchema.safeParse({ query: 'a', k: GRAPH.MAX_TOP_K }).success).toBe(
        false
      )
    })
  })

  describe('fields deliberately not exposed to a model', () => {
    it.each(['offset', 'correlationId', 'matchMode', 'includeMatchedTerms'])(
      'rejects %s rather than stripping it',
      (key) => {
        expect(GraphMcpToolArgsSchema.safeParse({ query: 'a', [key]: 1 }).success).toBe(false)
      }
    )

    // excludeSectionId is a DB-internal integer no model can know; it is omitted
    // from the MCP filter set, and the omit must not silently strip.
    it('rejects excludeSectionId inside filters', () => {
      expect(
        GraphMcpToolArgsSchema.safeParse({ query: 'a', filters: { excludeSectionId: 3 } }).success
      ).toBe(false)
    })

    it('keeps the remaining five filters usable', () => {
      const parsed = GraphMcpToolArgsSchema.parse({
        query: 'a',
        filters: {
          folder: 'docs',
          fileType: '.md',
          modifiedAfterMs: 1,
          modifiedBeforeMs: 2,
          excludeFilePath: 'docs/b.md'
        }
      })
      expect(parsed.filters?.folder).toBe('docs/')
    })

    // [#21] The renderer filters LEAF carries the modifiedAfterMs <= modifiedBeforeMs
    // refine, but the MCP filter set omits excludeSectionId off the UNREFINED base
    // (.omit() throws on a refined object), so the joint bound is re-attached to the
    // MCP filters leaf. Without it an inverted range would silently reach the
    // external-client reader and return nothing.
    it('rejects an inverted modified* range', () => {
      expect(
        GraphMcpToolArgsSchema.safeParse({
          query: 'a',
          filters: { modifiedAfterMs: 2, modifiedBeforeMs: 1 }
        }).success
      ).toBe(false)
    })

    it('accepts an ordered modified* range and either bound alone', () => {
      expect(
        GraphMcpToolArgsSchema.safeParse({
          query: 'a',
          filters: { modifiedAfterMs: 1, modifiedBeforeMs: 2 }
        }).success
      ).toBe(true)
      expect(
        GraphMcpToolArgsSchema.safeParse({ query: 'a', filters: { modifiedAfterMs: 5 } }).success
      ).toBe(true)
      expect(
        GraphMcpToolArgsSchema.safeParse({ query: 'a', filters: { modifiedBeforeMs: 5 } }).success
      ).toBe(true)
    })

    it('still rejects an unknown filter key after the omit', () => {
      expect(
        GraphMcpToolArgsSchema.safeParse({ query: 'a', filters: { excludeSection: 3 } }).success
      ).toBe(false)
    })

    it('still applies the fileType regex after the omit', () => {
      expect(
        GraphMcpToolArgsSchema.safeParse({ query: 'a', filters: { fileType: 'md' } }).success
      ).toBe(false)
    })
  })

  it('inherits the query trim and length bound', () => {
    expect(GraphMcpToolArgsSchema.parse({ query: '  alpha ' }).query).toBe('alpha')
    expect(GraphMcpToolArgsSchema.safeParse({ query: '   ' }).success).toBe(false)
    expect(
      GraphMcpToolArgsSchema.safeParse({ query: 'a'.repeat(GRAPH.MAX_QUERY_LENGTH + 1) }).success
    ).toBe(false)
  })

  // S-016: #30 publishes this shape as the tool's `inputSchema`. The args inherit
  // `filters.folder`'s `.transform()`, which has no JSON-Schema representation, so
  // only the `io:'input'` form converts — the default and `io:'output'` forms
  // throw. Pin both halves so a refactor that drops the transform is noticed.
  describe('JSON-Schema conversion (S-016)', () => {
    it('converts under { io: "input" } and marks query the only required field', () => {
      let jsonSchema: { required?: unknown } | undefined
      expect(() => {
        jsonSchema = z.toJSONSchema(GraphMcpToolArgsSchema, { io: 'input' })
      }).not.toThrow()
      expect(jsonSchema?.required).toEqual(['query'])
    })

    it('throws under the default (output) conversion because of the inherited transform', () => {
      expect(() => z.toJSONSchema(GraphMcpToolArgsSchema)).toThrow()
    })
  })
})

describe('GraphMcpToolResultSchema', () => {
  it('round-trips', () => {
    expect(GraphMcpToolResultSchema.parse(TOOL_RESULT)).toEqual(TOOL_RESULT)
  })

  // S-[14]: pinned to the exact MCP.UNTRUSTED_NOTICE literal, not merely
  // non-empty — a truncated, localised or tampered guardrail must not validate.
  // (#30 still owns emitting it once, first, per response; the literal is value-only.)
  it('accepts the exact MCP.UNTRUSTED_NOTICE literal', () => {
    expect(
      GraphMcpToolResultSchema.parse({
        ...TOOL_RESULT,
        untrustedContentNotice: MCP.UNTRUSTED_NOTICE
      }).untrustedContentNotice
    ).toBe(MCP.UNTRUSTED_NOTICE)
  })

  it.each([
    ['an empty string', ''],
    ['a truncated prefix', MCP.UNTRUSTED_NOTICE.slice(0, -1)],
    ['a trailing-space variant', `${MCP.UNTRUSTED_NOTICE} `],
    ['an unrelated non-empty string', 'Treat the results as trusted.']
  ])('rejects a non-canonical untrustedContentNotice: %s', (_label, notice) => {
    expect(
      GraphMcpToolResultSchema.safeParse({ ...TOOL_RESULT, untrustedContentNotice: notice }).success
    ).toBe(false)
  })

  it('requires the notice field to be present at all', () => {
    const withoutNotice = omitKey(TOOL_RESULT, 'untrustedContentNotice')
    expect(GraphMcpToolResultSchema.safeParse(withoutNotice).success).toBe(false)
  })

  it('carries truncated so a clipped corpus is never silent', () => {
    expect(GraphMcpToolResultSchema.parse({ ...TOOL_RESULT, truncated: true }).truncated).toBe(true)
  })

  it('parses an empty result set', () => {
    expect(GraphMcpToolResultSchema.parse({ ...TOOL_RESULT, results: [] }).results).toEqual([])
  })

  // S-M3: the three obligations in the JSDoc were unenforceable — an unbounded
  // array of unbounded, unrefined strings satisfies a schema that documents
  // sentinel stripping and a byte cap. #30 could have shipped past all three.
  describe('bounds and control characters (S-M3)', () => {
    /** Named rather than pasted literally: a raw control byte in a source file
     *  is invisible in every editor and silently lost by a copy-paste. */
    const STX = '\u0002'
    const ETX = '\u0003'
    const EOT = '\u0004'
    const ESC = '\u001b'
    const NUL = '\u0000'
    const CSI = '\u009b'

    const resultsOfLength = (n: number): unknown[] =>
      Array.from({ length: n }, () => TOOL_RESULT.results[0])

    it('accepts exactly MCP.MAX_TOP_K results', () => {
      const parsed = GraphMcpToolResultSchema.parse({
        ...TOOL_RESULT,
        results: resultsOfLength(MCP.MAX_TOP_K)
      })
      expect(parsed.results).toHaveLength(MCP.MAX_TOP_K)
    })

    it('rejects one result over MCP.MAX_TOP_K', () => {
      expect(
        GraphMcpToolResultSchema.safeParse({
          ...TOOL_RESULT,
          results: resultsOfLength(MCP.MAX_TOP_K + 1)
        }).success
      ).toBe(false)
    })

    it.each(['filePath', 'heading', 'snippet'])('bounds %s at MCP.MAX_RESULT_CHARS', (field) => {
      const atCap = { ...TOOL_RESULT.results[0], [field]: 'x'.repeat(MCP.MAX_RESULT_CHARS) }
      const overCap = { ...TOOL_RESULT.results[0], [field]: 'x'.repeat(MCP.MAX_RESULT_CHARS + 1) }
      expect(GraphMcpToolResultSchema.safeParse({ ...TOOL_RESULT, results: [atCap] }).success).toBe(
        true
      )
      expect(
        GraphMcpToolResultSchema.safeParse({ ...TOOL_RESULT, results: [overCap] }).success
      ).toBe(false)
    })

    // [#21] The per-field char caps bound each string but not the JSON envelope,
    // and `.max()` counts UTF-16 CODE UNITS, not bytes — so a field of multi-byte
    // characters can sit within its char cap yet carry ~3x its length in bytes.
    // This is the exact defect the rename fixes: every field is individually
    // legal, but the serialised BYTES of a full result set exceed the response
    // budget, and only the object-level byte refine catches it.
    it('rejects a result whose serialised bytes exceed MCP.MAX_RESPONSE_BYTES', () => {
      const CJK = '好' // a 3-byte UTF-8 code point, model-safe (not control/bidi/tag)
      const fatResult = {
        ...TOOL_RESULT.results[0],
        heading: CJK.repeat(MCP.MAX_RESULT_CHARS),
        snippet: CJK.repeat(MCP.MAX_RESULT_CHARS)
      }
      const oversized = {
        ...TOOL_RESULT,
        results: Array.from({ length: MCP.MAX_TOP_K }, () => fatResult)
      }
      // Every field is within its own CHARACTER cap...
      expect(fatResult.heading.length).toBeLessThanOrEqual(MCP.MAX_RESULT_CHARS)
      // ...yet its multi-byte encoding blows the response BYTE budget.
      expect(new TextEncoder().encode(JSON.stringify(oversized)).length).toBeGreaterThan(
        MCP.MAX_RESPONSE_BYTES
      )
      expect(GraphMcpToolResultSchema.safeParse(oversized).success).toBe(false)
    })

    it('accepts a normal-sized result within the response byte budget', () => {
      expect(
        new TextEncoder().encode(JSON.stringify(TOOL_RESULT)).length
      ).toBeLessThanOrEqual(MCP.MAX_RESPONSE_BYTES)
      expect(GraphMcpToolResultSchema.safeParse(TOOL_RESULT).success).toBe(true)
    })

    // char(2)/char(3)/char(4) are Erfana's own snippet sentinels, ESC opens
    // every ANSI escape, and U+009B is the single-byte CSI. None may reach a
    // model, and the schema — not a comment — has to be what says so.
    it.each([
      ['the STX/ETX sentinels', `${STX}alpha${ETX}`],
      ['the EOT truncation marker', `alpha${EOT}`],
      ['an ANSI escape', `${ESC}[31mred${ESC}[0m`],
      ['a NUL', `alpha${NUL}`],
      ['a carriage return', 'alpha\r\nbeta'],
      ['a C1 control', `alpha${CSI}beta`]
    ])('rejects a snippet carrying %s', (_label, snippet) => {
      expect(
        GraphMcpToolResultSchema.safeParse({
          ...TOOL_RESULT,
          results: [{ ...TOOL_RESULT.results[0], snippet }]
        }).success
      ).toBe(false)
    })

    it('keeps tab and newline, which real markdown carries', () => {
      const snippet = 'alpha\tbeta\ngamma'
      const parsed = GraphMcpToolResultSchema.parse({
        ...TOOL_RESULT,
        results: [{ ...TOOL_RESULT.results[0], snippet }]
      })
      expect(parsed.results[0].snippet).toBe(snippet)
    })

    it.each(['filePath', 'heading'])('applies the same refusal to %s', (field) => {
      expect(
        GraphMcpToolResultSchema.safeParse({
          ...TOOL_RESULT,
          results: [{ ...TOOL_RESULT.results[0], [field]: `a${STX}b` }]
        }).success
      ).toBe(false)
    })

    it('exposes the predicate so #30 strips by the same rule it is judged by', () => {
      expect(isModelSafeText('plain text')).toBe(true)
      expect(isModelSafeText('with\ttab\nand newline')).toBe(true)
      expect(isModelSafeText(STX)).toBe(false)
      expect(isModelSafeText('\u009f')).toBe(false)
    })

    // S-[12]: the predicate is widened past C0/C1 to the model-facing smuggling
    // vectors. A tag character arrives as a SURROGATE PAIR, so a charCodeAt loop
    // comparing two more 16-bit ranges would miss it \u2014 the code-point scan is
    // what makes this pass.
    describe('model-facing smuggling vectors (S-[12])', () => {
      it('rejects a U+E0000 tag character supplied as a surrogate pair', () => {
        const tag = String.fromCodePoint(0xe0000) // high 0xDB40, low 0xDC00
        expect(tag.length).toBe(2) // it really is a surrogate pair
        expect(isModelSafeText(`alpha${tag}beta`)).toBe(false)
      })

      it('rejects a lower-ASCII-mirroring tag char at the top of the block', () => {
        expect(isModelSafeText(String.fromCodePoint(0xe007f))).toBe(false)
      })

      it('rejects an unpaired high surrogate', () => {
        expect(isModelSafeText('alpha\ud800beta')).toBe(false)
      })

      it('rejects an unpaired low surrogate', () => {
        expect(isModelSafeText('alpha\udc00beta')).toBe(false)
      })

      // Code points, not literal glyphs: a raw bidi control is invisible in an
      // editor and silently reorders the source line around it.
      it.each([
        ['a RLO bidi override', 0x202e],
        ['a LRE bidi embedding', 0x202a],
        ['a RLI bidi isolate', 0x2067],
        ['a PDI bidi isolate', 0x2069]
      ])('rejects %s', (_label, cp) => {
        expect(isModelSafeText(`alpha${String.fromCodePoint(cp)}beta`)).toBe(false)
      })

      it.each([
        ['accented latin', 'caf\u00e9'],
        ['CJK', '\u65e5\u672c\u8a9e'],
        ['an emoji as a valid surrogate pair', '\ud83d\ude00 done']
      ])('accepts ordinary multi-byte text: %s', (_label, text) => {
        expect(isModelSafeText(text)).toBe(true)
      })
    })

    // filePath is the one result field that is also a PATH: the "never absolute"
    // clause in the JSDoc is now a constraint, so a tool result crossing the
    // external-client boundary cannot leak the home-directory layout.
    it.each([
      ['a POSIX absolute', '/Users/x/secret.md'],
      ['a traversal', '../../.ssh/id_rsa'],
      ['a drive path', 'C:\\Users\\x\\a.md'],
      ['an NTFS ADS', 'notes.md:hidden'],
      ['a reserved device name', 'COM1']
    ])('rejects a filePath that is %s (%j)', (_label, filePath) => {
      expect(
        GraphMcpToolResultSchema.safeParse({
          ...TOOL_RESULT,
          results: [{ ...TOOL_RESULT.results[0], filePath }]
        }).success
      ).toBe(false)
    })

    it('accepts an ordinary project-relative filePath', () => {
      expect(
        GraphMcpToolResultSchema.parse({
          ...TOOL_RESULT,
          results: [{ ...TOOL_RESULT.results[0], filePath: 'docs/notes.md' }]
        }).results[0].filePath
      ).toBe('docs/notes.md')
    })
  })

  // The model-facing result is deliberately four fields: no sectionId, no line
  // numbers, no matchedTerms offsets. Anything more is a new contract.
  it('exposes exactly four fields per result', () => {
    const parsed = GraphMcpToolResultSchema.parse({
      ...TOOL_RESULT,
      results: [
        { filePath: 'a.md', heading: 'h', snippet: 's', score: -1, sectionId: 9, startLine: 3 }
      ]
    })
    expect(Object.keys(parsed.results[0]).sort()).toEqual([
      'filePath',
      'heading',
      'score',
      'snippet'
    ])
  })
})

describe('main ↔ utilityProcess port', () => {
  const SEARCH = {
    kind: 'graph:search' as const,
    correlationId: 'idx-1-abcdef012345',
    switchVersion: 0,
    payload: { query: 'alpha' }
  }
  const DRAIN = { kind: 'graph:drain' as const, correlationId: 'idx-1-abcdef012345' }

  describe('requests', () => {
    it('round-trips a search, resolving the payload default', () => {
      const parsed = GraphPortSearchRequestSchema.parse(SEARCH)
      expect(parsed.payload.k).toBe(GRAPH.DEFAULT_TOP_K)
    })

    it('round-trips a drain (FR-044)', () => {
      expect(GraphPortDrainRequestSchema.parse(DRAIN)).toEqual(DRAIN)
    })

    it.each([SEARCH, DRAIN])('routes $kind through the union', (payload) => {
      expect(GraphPortRequestSchema.parse(payload).kind).toBe(payload.kind)
    })

    it('covers exactly the two request kinds', () => {
      const kinds = [SEARCH, DRAIN].map((m) => GraphPortRequestSchema.parse(m).kind)
      expect(new Set(kinds)).toEqual(new Set(['graph:search', 'graph:drain']))
    })

    it.each(['graph:cancel', 'graph:searchResult', 'search', ''])(
      'rejects the unknown kind %j',
      (kind) => {
        expect(
          GraphPortRequestSchema.safeParse({ kind, correlationId: 'idx-1-a' }).success
        ).toBe(false)
      }
    )

    // One port would otherwise span arbitrary project switches, answering an
    // in-flight search from whichever reader happened to be attached.
    it('requires switchVersion on a search', () => {
      const withoutFence = omitKey(SEARCH, 'switchVersion')
      expect(GraphPortRequestSchema.safeParse(withoutFence).success).toBe(false)
    })

    it('requires a correlationId on both kinds', () => {
      expect(GraphPortRequestSchema.safeParse({ ...SEARCH, correlationId: '' }).success).toBe(false)
      expect(GraphPortRequestSchema.safeParse({ ...DRAIN, correlationId: '' }).success).toBe(false)
    })

    it('rejects an unknown key on a port request', () => {
      expect(GraphPortRequestSchema.safeParse({ ...SEARCH, priority: 1 }).success).toBe(false)
    })

    it('rejects a payload that violates the MCP k bound', () => {
      expect(
        GraphPortRequestSchema.safeParse({
          ...SEARCH,
          payload: { query: 'a', k: MCP.MAX_TOP_K + 1 }
        }).success
      ).toBe(false)
    })
  })

  describe('responses', () => {
    const RESULT = {
      kind: 'graph:search:result' as const,
      correlationId: 'idx-1-abcdef012345',
      payload: TOOL_RESULT
    }
    const ERROR = {
      kind: 'graph:search:error' as const,
      correlationId: 'idx-1-abcdef012345',
      code: ErrorCode.GRAPH_SEARCH_FAILED
    }
    const THROTTLED = {
      kind: 'graph:throttled' as const,
      correlationId: 'idx-1-abcdef012345',
      retryAfterMs: 250
    }
    const DRAINED = {
      kind: 'graph:drained' as const,
      correlationId: 'idx-1-abcdef012345',
      completed: 3
    }

    it.each([
      ['result', RESULT, GraphPortSearchResultSchema],
      ['error', ERROR, GraphPortSearchErrorSchema],
      ['throttled', THROTTLED, GraphPortThrottledSchema],
      ['drained', DRAINED, GraphPortDrainedSchema]
    ] as const)('round-trips a %s response', (_label, payload, schema) => {
      expect(schema.parse(payload)).toEqual(payload)
    })

    it.each([RESULT, ERROR, THROTTLED, DRAINED])('routes $kind through the union', (payload) => {
      expect(GraphPortResponseSchema.parse(payload).kind).toBe(payload.kind)
    })

    it('covers exactly the four response kinds', () => {
      const kinds = [RESULT, ERROR, THROTTLED, DRAINED].map(
        (m) => GraphPortResponseSchema.parse(m).kind
      )
      expect(new Set(kinds)).toEqual(
        new Set(['graph:search:result', 'graph:search:error', 'graph:throttled', 'graph:drained'])
      )
    })

    // Erratum E9: MessagePortMain has no flow control, so the bounded queue
    // needs a signal or the peer cannot tell throttled from hung.
    it('requires a positive retryAfterMs on a throttle', () => {
      expect(GraphPortThrottledSchema.safeParse({ ...THROTTLED, retryAfterMs: 0 }).success).toBe(
        false
      )
      const withoutHint = omitKey(THROTTLED, 'retryAfterMs')
      expect(GraphPortThrottledSchema.safeParse(withoutHint).success).toBe(false)
    })

    it('rejects a non-graph code on a port error', () => {
      expect(
        GraphPortSearchErrorSchema.safeParse({ ...ERROR, code: ErrorCode.WHISPER_PROCESS_FAILED })
          .success
      ).toBe(false)
    })

    it('rejects an unknown key on a port response', () => {
      expect(GraphPortResponseSchema.safeParse({ ...DRAINED, extra: 1 }).success).toBe(false)
    })

    it('rejects a request kind on the response union and vice versa', () => {
      expect(GraphPortResponseSchema.safeParse(SEARCH).success).toBe(false)
      expect(GraphPortRequestSchema.safeParse(RESULT).success).toBe(false)
    })
  })
})

describe('external client handshake (§9.4)', () => {
  const CONNECT = {
    kind: 'mcp:connect' as const,
    token: HEX64,
    protocolVersion: 1 as const,
    clientName: 'claude-code'
  }

  it('round-trips a connect', () => {
    expect(GraphMcpConnectSchema.parse(CONNECT)).toEqual(CONNECT)
  })

  // OS ACLs bound the USER; the token bounds the PROCESS. A short or
  // upper-case token is a different string and must not authenticate.
  it.each([
    ['a 63-hex token', 'a'.repeat(63)],
    ['a 65-hex token', 'a'.repeat(65)],
    ['an upper-case token', 'A'.repeat(64)],
    ['a non-hex token', 'z'.repeat(64)],
    ['an empty token', ''],
    ['a 0x-prefixed token', `0x${'a'.repeat(62)}`]
  ])('rejects %s', (_label, token) => {
    expect(GraphMcpConnectSchema.safeParse({ ...CONNECT, token }).success).toBe(false)
  })

  it('accepts a realistic randomBytes(32) hex token', () => {
    const token = '3f6c1b9a0d4e7f2c8b5a1e0d9c7f4a2b6e3d0c9f8a7b6c5d4e3f2a1b0c9d8e7f'
    expect(GraphMcpConnectSchema.parse({ ...CONNECT, token }).token).toBe(token)
  })

  it('pins protocolVersion to the literal 1', () => {
    expect(GraphMcpConnectSchema.safeParse({ ...CONNECT, protocolVersion: 2 }).success).toBe(false)
    expect(GraphMcpConnectSchema.safeParse({ ...CONNECT, protocolVersion: '1' }).success).toBe(
      false
    )
  })

  it('bounds clientName at 128 characters', () => {
    expect(
      GraphMcpConnectSchema.parse({ ...CONNECT, clientName: 'x'.repeat(128) }).clientName
    ).toHaveLength(128)
    expect(
      GraphMcpConnectSchema.safeParse({ ...CONNECT, clientName: 'x'.repeat(129) }).success
    ).toBe(false)
  })

  // S-[27]: the client picks this name before the token is validated, and #30
  // renders it in the consent dialog and logs it. A newline, ANSI or bidi run
  // must not be able to forge a log line or spoof the dialog.
  it.each([
    ['a newline', 'claude\ncode'],
    ['an ANSI escape', 'claude\u001b[2Kcode'],
    ['a bidi override', `claude${String.fromCodePoint(0x202e)}code`],
    ['a Unicode tag char', `claude${String.fromCodePoint(0xe0041)}`]
  ])('rejects a clientName carrying %s', (_label, clientName) => {
    expect(GraphMcpConnectSchema.safeParse({ ...CONNECT, clientName }).success).toBe(false)
  })

  it('rejects an unknown key on the handshake', () => {
    expect(GraphMcpConnectSchema.safeParse({ ...CONNECT, scopes: ['*'] }).success).toBe(false)
  })

  it('round-trips the ack carrying the beta disclaimer', () => {
    const ack = {
      kind: 'mcp:connected' as const,
      projectName: 'erfana',
      disclaimer: MCP.BETA_DISCLAIMER
    }
    expect(GraphMcpConnectAckSchema.parse(ack)).toEqual(ack)
  })

  it('rejects an over-length projectName on the ack', () => {
    expect(
      GraphMcpConnectAckSchema.safeParse({
        kind: 'mcp:connected',
        projectName: 'x'.repeat(257),
        disclaimer: MCP.BETA_DISCLAIMER
      }).success
    ).toBe(false)
  })
})
