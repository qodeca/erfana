// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph error vocabulary and path confinement.
 *
 * Split out of `graph-schema.test.ts` alongside the module it covers, which is
 * the leaf both `graph-schema.ts` and `graph-status-schema.ts` build on.
 *
 * Two properties carry the weight, and both are silent rather than loud when
 * they break:
 *
 * - `GRAPH_ERROR_CODES` is a CLOSED set of 26. A worker or handler emitting a
 *   code outside it fails `safeParse`, is dropped as `GRAPH_WORKER_PROTOCOL`,
 *   and leaves the caller waiting for its timeout — so the count and the
 *   rejection of plausible-looking non-members are asserted explicitly.
 * - `isConfinedRelativePath` guards a read-into-index primitive reachable
 *   through the MCP surface, and its Win32 cases (trailing spaces and periods
 *   are stripped from every path component) are the ones an exact segment
 *   comparison silently accepted.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 1
 * @see specs/designs/sd-021-cross-cutting.md §9.2, §9.5
 */
import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../errors'
import {
  GRAPH_ERROR_CODES,
  GraphErrorCodeSchema,
  GraphErrorSchema,
  isConfinedRelativePath
} from './graph-error-schema'
import { GraphErrorSchema as ErrorSchemaFromGraphSchema } from './graph-schema'

// The leaf is re-exported from `graph-schema.ts` so no consumer needs to know
// the split happened — and it is the SAME object, not a parallel definition.
describe('re-export (§4.2)', () => {
  it('is the one schema object, reachable from either import path', () => {
    expect(GraphErrorSchema).toBe(ErrorSchemaFromGraphSchema)
  })
})

describe('GraphErrorCodeSchema', () => {
  it('accepts every member of GRAPH_ERROR_CODES', () => {
    for (const code of GRAPH_ERROR_CODES) {
      expect(GraphErrorCodeSchema.parse(code)).toBe(code)
    }
  })

  it('carries the 26 codes the design enumerates', () => {
    expect(GRAPH_ERROR_CODES).toHaveLength(26)
    expect(new Set(GRAPH_ERROR_CODES).size).toBe(26)
  })

  // The whole reason this is not `z.enum(ErrorCode)`: a WHISPER_* code would
  // validate on graph:search and the renderer would lose its exhaustive switch.
  it.each([
    ErrorCode.WHISPER_BINARY_NOT_FOUND,
    ErrorCode.WHISPER_MODEL_NOT_FOUND,
    ErrorCode.WHISPER_CPU_UNSUPPORTED,
    ErrorCode.UNKNOWN_ERROR,
    ErrorCode.PROJECT_NOT_FOUND
  ])('rejects the non-graph code %s', (code) => {
    expect(GraphErrorCodeSchema.safeParse(code).success).toBe(false)
  })

  it('rejects a plausible-looking code that does not exist', () => {
    expect(GraphErrorCodeSchema.safeParse('GRAPH_DB_NOT_WRITABLE').success).toBe(false)
  })
})

describe('GraphErrorSchema', () => {
  it('defaults relativePath to null', () => {
    const parsed = GraphErrorSchema.parse({
      code: ErrorCode.GRAPH_SEARCH_FAILED,
      atMs: 1_700_000_000_000
    })
    expect(parsed.relativePath).toBeNull()
  })

  it('round-trips an attributed error', () => {
    const parsed = GraphErrorSchema.parse({
      code: ErrorCode.GRAPH_INDEX_FILE_TOO_LARGE,
      atMs: 0,
      relativePath: 'docs/huge.md'
    })
    expect(parsed).toEqual({
      code: ErrorCode.GRAPH_INDEX_FILE_TOO_LARGE,
      atMs: 0,
      relativePath: 'docs/huge.md'
    })
  })

  it.each([
    ['a negative timestamp', { code: ErrorCode.GRAPH_SEARCH_FAILED, atMs: -1 }],
    ['a fractional timestamp', { code: ErrorCode.GRAPH_SEARCH_FAILED, atMs: 1.5 }],
    ['a non-graph code', { code: ErrorCode.WHISPER_PROCESS_FAILED, atMs: 0 }],
    [
      'an over-length relativePath',
      { code: ErrorCode.GRAPH_SEARCH_FAILED, atMs: 0, relativePath: 'x'.repeat(1025) }
    ]
  ])('rejects %s', (_label, payload) => {
    expect(GraphErrorSchema.safeParse(payload).success).toBe(false)
  })

  // S-L1: "Never absolute" was a comment, not a constraint — the field is
  // rendered in the skip list and the Settings diagnostics, and it is composed
  // from a path the indexer was HANDED.
  it.each([
    ['a POSIX absolute', '/Users/x/p/docs/a.md'],
    ['a Windows drive path', 'C:\\Users\\x\\a.md'],
    ['a UNC path', '\\\\server\\share\\a.md'],
    ['a traversal', '../../.ssh/id_rsa'],
    ['a Win32-normalised traversal', '.. /a.md'],
    ['an empty string', '']
  ])('rejects %s as relativePath', (_label, relativePath) => {
    expect(
      GraphErrorSchema.safeParse({ code: ErrorCode.GRAPH_SEARCH_FAILED, atMs: 0, relativePath })
        .success
    ).toBe(false)
  })
})

describe('isConfinedRelativePath', () => {
  it.each(['a.md', 'docs/a.md', 'docs\\a.md', 'a..b/c.md', '...md'])('accepts %j', (p) => {
    expect(isConfinedRelativePath(p)).toBe(true)
  })

  it.each([
    '',
    '/etc/passwd',
    '\\\\server\\share\\a.md',
    'C:/Users/x/a.md',
    'c:\\Users\\x\\a.md',
    '../a.md',
    'docs/../../a.md',
    'docs\\..\\..\\a.md',
    '..'
  ])('rejects %j', (p) => {
    expect(isConfinedRelativePath(p)).toBe(false)
  })

  // S-M1: Win32 strips trailing spaces and periods from every path component,
  // so each of these resolves to `..` on the platform Erfana ships on, and
  // exact segment equality accepted all of them.
  it.each([
    ['dot-dot-space', '.. /a.md'],
    ['dot-dot-space, Windows separator', '.. \\a.md'],
    ['dot-dot-dot', '.../a.md'],
    ['dot-dot-space-dot', '.. ./a.md'],
    ['a trailing dot-dot-space segment', 'docs/.. /a.md'],
    ['dot-dot-space with no following segment', '.. '],
    ['dot-dot with a trailing dot', '...']
  ])('rejects the Win32-normalised traversal %s (%j)', (_label, p) => {
    expect(isConfinedRelativePath(p)).toBe(false)
  })

  // The strip must not swallow ordinary names that merely contain dots, or the
  // priority-path list silently drops legitimate files.
  it.each(['a.md', 'v1.2.3/notes.md', 'docs/./a.md', '.hidden/a.md', 'a. b.md'])(
    'still accepts the ordinary path %j',
    (p) => {
      expect(isConfinedRelativePath(p)).toBe(true)
    }
  )
})
