// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph status snapshot, progress and priority paths.
 *
 * The §11 item 1 split: search and explain live in `graph-schema.test.ts`,
 * filters in `graph-schema.filters.test.ts`, the reindex/cancel/corpus job
 * payloads in `graph-schema.jobs.test.ts`.
 *
 * The status snapshot is the one payload the UI cannot degrade gracefully
 * without: FR-037/FR-038 render "index behind" and "search broken" from the
 * `dot` × `searchAvailable` pair, so both are asserted as required rather than
 * defaulted, and the two bounded arrays are asserted at their caps — an
 * uncapped `queuedFilePaths` is ~80 KB per snapshot at the push rate.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 1
 * @see specs/designs/sd-021-ipc-contracts.md §7
 */
import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../errors'
import { GRAPH } from '../graph-constants'
import {
  GraphBreakerState,
  GraphIndexState,
  GraphPriorityPathsRequestSchema,
  GraphPriorityPathsResponseSchema,
  GraphProgressSchema,
  GraphStatusChangePayloadSchema,
  GraphStatusDot,
  GraphStatusRequestSchema,
  GraphStatusResponseSchema,
  GraphStatusSnapshotSchema
} from './graph-schema'
import { GraphStatusSnapshotSchema as SnapshotFromOwnModule } from './graph-status-schema'

/** Structural omission — the payload genuinely lacks the key, rather than
 *  carrying it as an explicit `undefined`, which zod can treat differently. */
function omitKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
}

const VALID_SNAPSHOT = {
  projectPath: '/Users/x/p',
  state: 'ready' as const,
  dot: 'green' as const,
  searchAvailable: true,
  progress: null,
  queueDepth: 0,
  queuedFilePaths: [],
  recentSkips: [],
  stale: false,
  lastError: null,
  lastIndexedAtMs: 1_700_000_000_000,
  lastIndexDurationMs: 1234.5,
  schemaVersion: 1,
  generation: '-8134159219358100000',
  sessionVersion: 0,
  restartAttempts: 0,
  breakerState: 'closed' as const,
  walSizeBytes: null
}

// §4.2 split. Importing BOTH modules in one file is the point: the schemas are
// built from `GraphErrorSchema`, so if `graph-status-schema` ever imported
// `graph-schema` back, the re-exported module would evaluate first and every
// schema here would throw a temporal-dead-zone ReferenceError on import.
describe('module split (§4.2)', () => {
  it('re-exports the one schema object, not a copy, through graph-schema', () => {
    expect(GraphStatusSnapshotSchema).toBe(SnapshotFromOwnModule)
  })
})

describe('GraphIndexState', () => {
  it.each(['uninitialized', 'opening', 'ready', 'indexing', 'degraded', 'disabled'] as const)(
    'accepts %s',
    (state) => {
      expect(GraphIndexState.parse(state)).toBe(state)
    }
  )

  it('has exactly six members', () => {
    expect(GraphIndexState.options).toHaveLength(6)
  })

  // Deviation 9: every plausible producer is routed elsewhere by contract, so
  // an `error` member would have no producer, no exit and no meaning.
  it("rejects 'error', which was deliberately deleted", () => {
    expect(GraphIndexState.safeParse('error').success).toBe(false)
  })
})

describe('GraphStatusDot', () => {
  it.each(['grey', 'green', 'yellow', 'red'] as const)('accepts %s', (dot) => {
    expect(GraphStatusDot.parse(dot)).toBe(dot)
  })

  // Erratum E6: FR-037 named three; grey is the null state.
  it('carries the fourth grey member for the null state', () => {
    expect(GraphStatusDot.options).toEqual(['grey', 'green', 'yellow', 'red'])
  })

  it.each(['gray', 'orange', 'GREEN'])('rejects %j', (dot) => {
    expect(GraphStatusDot.safeParse(dot).success).toBe(false)
  })
})

describe('GraphBreakerState', () => {
  it.each(['closed', 'open', 'half-open'] as const)('accepts %s', (state) => {
    expect(GraphBreakerState.parse(state)).toBe(state)
  })

  it('rejects halfOpen', () => {
    expect(GraphBreakerState.safeParse('halfOpen').success).toBe(false)
  })
})

describe('GraphStatusSnapshotSchema', () => {
  it('round-trips a ready snapshot', () => {
    expect(GraphStatusSnapshotSchema.parse(VALID_SNAPSHOT)).toEqual(VALID_SNAPSHOT)
  })

  it('parses the null-project snapshot', () => {
    const parsed = GraphStatusSnapshotSchema.parse({
      ...VALID_SNAPSHOT,
      projectPath: null,
      state: 'uninitialized',
      dot: 'grey',
      searchAvailable: false,
      schemaVersion: null,
      generation: null,
      lastIndexedAtMs: null,
      lastIndexDurationMs: null
    })
    expect(parsed.dot).toBe('grey')
    expect(parsed.searchAvailable).toBe(false)
  })

  // E6: the dot and searchAvailable are ORTHOGONAL. Without the split the UI
  // cannot tell "index behind" from "search is broken".
  it('allows yellow + searchAvailable true (index behind)', () => {
    const parsed = GraphStatusSnapshotSchema.parse({
      ...VALID_SNAPSHOT,
      dot: 'yellow',
      state: 'indexing',
      searchAvailable: true,
      stale: true
    })
    expect([parsed.dot, parsed.searchAvailable]).toEqual(['yellow', true])
  })

  it('allows red + searchAvailable false (search is broken)', () => {
    const parsed = GraphStatusSnapshotSchema.parse({
      ...VALID_SNAPSHOT,
      dot: 'red',
      state: 'degraded',
      searchAvailable: false,
      lastError: { code: ErrorCode.GRAPH_DB_OPEN_FAILED, atMs: 1 }
    })
    expect(parsed.searchAvailable).toBe(false)
    expect(parsed.lastError?.code).toBe(ErrorCode.GRAPH_DB_OPEN_FAILED)
  })

  it('bounds projectPath at 4096 characters (S-L2)', () => {
    expect(
      GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, projectPath: 'x'.repeat(4097) })
        .success
    ).toBe(false)
  })

  it('requires searchAvailable — it must never silently default', () => {
    const withoutFlag = omitKey(VALID_SNAPSHOT, 'searchAvailable')
    expect(GraphStatusSnapshotSchema.safeParse(withoutFlag).success).toBe(false)
  })

  it('accepts generation as a decimal string, including a negative 64-bit value', () => {
    const parsed = GraphStatusSnapshotSchema.parse({
      ...VALID_SNAPSHOT,
      generation: '-9223372036854775808'
    })
    expect(parsed.generation).toBe('-9223372036854775808')
  })

  // D5: the snapshot shares GraphGenerationSchema with the worker `ready` reply
  // and the on-disk token, so a value above Number.MAX_SAFE_INTEGER round-trips
  // exactly and `BigInt(...)` on it cannot throw.
  it('round-trips a generation above Number.MAX_SAFE_INTEGER exactly', () => {
    const generation = '9223372036854775807'
    const parsed = GraphStatusSnapshotSchema.parse({ ...VALID_SNAPSHOT, generation })
    expect(parsed.generation).toBe(generation)
    expect(BigInt(parsed.generation ?? '')).toBe(9223372036854775807n)
  })

  // Previously `z.string()` accepted any string; the shared schema now pins the
  // decimal form so a non-numeric token cannot reach `BigInt(...)`.
  it.each(['1.5', '0x1f', 'abc', ' 1', ''])('rejects the non-decimal generation %j', (generation) => {
    expect(GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, generation }).success).toBe(
      false
    )
  })

  it('records walSizeBytes when a checkpoint was refused (C8)', () => {
    expect(
      GraphStatusSnapshotSchema.parse({ ...VALID_SNAPSHOT, walSizeBytes: 38_797_312 }).walSizeBytes
    ).toBe(38_797_312)
  })

  // §9.10/E5 requires budget exhaustion to be surfaced WITH the count and the
  // reason. Three graph_meta keys held it and no renderer-facing field carried
  // it, so the requirement had no wire.
  describe('rebuild budget (§9.10 / E5)', () => {
    it('carries the count and reason from graph_meta', () => {
      const parsed = GraphStatusSnapshotSchema.parse({
        ...VALID_SNAPSHOT,
        state: 'disabled',
        dot: 'red',
        searchAvailable: false,
        autoRebuildCount: GRAPH.MAX_AUTO_REBUILDS_PER_SESSION,
        lastAutoRebuildReason: 'corruption',
        lastError: { code: ErrorCode.GRAPH_DB_REBUILD_FAILED, atMs: 1 }
      })
      expect(parsed.autoRebuildCount).toBe(GRAPH.MAX_AUTO_REBUILDS_PER_SESSION)
      expect(parsed.lastAutoRebuildReason).toBe('corruption')
    })

    // Absent means "not read yet" — a snapshot published before the reader is
    // attached must not render as "no rebuilds have happened".
    it('leaves both undefined rather than defaulting the count to 0', () => {
      const parsed = GraphStatusSnapshotSchema.parse(VALID_SNAPSHOT)
      expect(parsed.autoRebuildCount).toBeUndefined()
      expect(parsed.lastAutoRebuildReason).toBeUndefined()
    })

    it('accepts a null reason, which is what an unstamped graph_meta returns', () => {
      expect(
        GraphStatusSnapshotSchema.parse({ ...VALID_SNAPSHOT, lastAutoRebuildReason: null })
          .lastAutoRebuildReason
      ).toBeNull()
    })

    it.each([-1, 1.5])('rejects autoRebuildCount %s', (autoRebuildCount) => {
      expect(
        GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, autoRebuildCount }).success
      ).toBe(false)
    })

    it('bounds the reason string', () => {
      expect(
        GraphStatusSnapshotSchema.safeParse({
          ...VALID_SNAPSHOT,
          lastAutoRebuildReason: 'x'.repeat(65)
        }).success
      ).toBe(false)
    })
  })

  describe('bounded previews (FR-038)', () => {
    it('accepts queuedFilePaths at exactly MAX_QUEUE_PREVIEW', () => {
      const queuedFilePaths = Array.from({ length: GRAPH.MAX_QUEUE_PREVIEW }, (_, i) => `a${i}.md`)
      expect(
        GraphStatusSnapshotSchema.parse({ ...VALID_SNAPSHOT, queuedFilePaths }).queuedFilePaths
      ).toHaveLength(GRAPH.MAX_QUEUE_PREVIEW)
    })

    it('rejects one queued path over the count cap', () => {
      const queuedFilePaths = Array.from(
        { length: GRAPH.MAX_QUEUE_PREVIEW + 1 },
        (_, i) => `a${i}.md`
      )
      expect(
        GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, queuedFilePaths }).success
      ).toBe(false)
    })

    it('rejects an over-length queued path element', () => {
      expect(
        GraphStatusSnapshotSchema.safeParse({
          ...VALID_SNAPSHOT,
          queuedFilePaths: ['x'.repeat(1025)]
        }).success
      ).toBe(false)
    })

    it('rejects one recent skip over MAX_RECENT_SKIPS', () => {
      const recentSkips = Array.from({ length: GRAPH.MAX_RECENT_SKIPS + 1 }, () => ({
        code: ErrorCode.GRAPH_INDEX_PARSE_FAILED,
        relativePath: 'a.md'
      }))
      expect(GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, recentSkips }).success).toBe(
        false
      )
    })

    it('rejects a non-graph code inside recentSkips', () => {
      expect(
        GraphStatusSnapshotSchema.safeParse({
          ...VALID_SNAPSHOT,
          recentSkips: [{ code: ErrorCode.WHISPER_PROCESS_FAILED, relativePath: 'a.md' }]
        }).success
      ).toBe(false)
    })
  })

  describe('progress', () => {
    const PROGRESS = {
      jobId: 'job-1-abcdef012345',
      processedFiles: 5,
      totalFiles: 10,
      skippedFiles: 1,
      currentFilePath: 'docs/a.md',
      startedAtMs: 1_700_000_000_000
    }

    it('round-trips', () => {
      expect(GraphProgressSchema.parse(PROGRESS)).toEqual(PROGRESS)
    })

    it('accepts a null currentFilePath between files', () => {
      expect(GraphProgressSchema.parse({ ...PROGRESS, currentFilePath: null }).currentFilePath)
        .toBeNull()
    })

    it('rejects a blank jobId', () => {
      expect(GraphProgressSchema.safeParse({ ...PROGRESS, jobId: '' }).success).toBe(false)
    })

    // S-L2: currentFilePath was the one unbounded string on a payload pushed at
    // MAX_STATUS_PUSH_RATE_HZ, while every sibling path carried a cap.
    it('bounds currentFilePath at 4096 characters', () => {
      expect(
        GraphProgressSchema.safeParse({ ...PROGRESS, currentFilePath: 'x'.repeat(4097) }).success
      ).toBe(false)
    })

    it('nests into the snapshot during indexing', () => {
      const parsed = GraphStatusSnapshotSchema.parse({
        ...VALID_SNAPSHOT,
        state: 'indexing',
        dot: 'yellow',
        progress: PROGRESS,
        queueDepth: 4
      })
      expect(parsed.progress?.processedFiles).toBe(5)
    })

    // The three status paths are confined like every other file path on the
    // boundary. currentFilePath is nullable, so null still parses.
    it.each(['/etc/passwd', '../a.md', 'C:\\x', 'notes.md:hidden', 'COM1'])(
      'rejects the unconfined currentFilePath %j',
      (currentFilePath) => {
        expect(GraphProgressSchema.safeParse({ ...PROGRESS, currentFilePath }).success).toBe(false)
      }
    )
  })

  describe('confined status paths', () => {
    const PROGRESS = {
      jobId: 'job-1-abcdef012345',
      processedFiles: 5,
      totalFiles: 10,
      skippedFiles: 1,
      currentFilePath: 'docs/a.md',
      startedAtMs: 1_700_000_000_000
    }

    it.each(['/etc/passwd', '../a.md', 'C:\\x', 'notes.md:hidden', 'COM1'])(
      'rejects an unconfined queuedFilePaths entry %j',
      (path) => {
        expect(
          GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, queuedFilePaths: [path] }).success
        ).toBe(false)
      }
    )

    it.each(['/etc/passwd', '../a.md', 'notes.md:hidden', 'NUL'])(
      'rejects an unconfined recentSkips relativePath %j',
      (relativePath) => {
        expect(
          GraphStatusSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            recentSkips: [{ code: ErrorCode.GRAPH_INDEX_PARSE_FAILED, relativePath }]
          }).success
        ).toBe(false)
      }
    )

    // projectPath is deliberately EXEMPT — absolute by design — and must still
    // parse, or the Settings panel could never name the indexed directory.
    it('still accepts an absolute projectPath', () => {
      const parsed = GraphStatusSnapshotSchema.parse({
        ...VALID_SNAPSHOT,
        projectPath: '/Users/x/Projects/erfana'
      })
      expect(parsed.projectPath).toBe('/Users/x/Projects/erfana')
    })

    // Truncation safety: #29 truncates the three status paths at a BYTE
    // boundary, which can sever a segment into a spurious trailing `..`. The
    // status schema tolerates that (backstop, not enforcement point) so a
    // cosmetic trim never blanks the panel — while a real escape still fails.
    it('accepts a path truncated at MAX_STATUS_PATH_LENGTH into a trailing ..', () => {
      const truncated = `${'a'.repeat(GRAPH.MAX_STATUS_PATH_LENGTH - 3)}/..evil/x.md`.slice(
        0,
        GRAPH.MAX_STATUS_PATH_LENGTH
      )
      expect(truncated).toHaveLength(GRAPH.MAX_STATUS_PATH_LENGTH)
      expect(truncated.endsWith('/..')).toBe(true)
      expect(GraphProgressSchema.safeParse({ ...PROGRESS, currentFilePath: truncated }).success).toBe(
        true
      )
      expect(
        GraphStatusSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, queuedFilePaths: [truncated] })
          .success
      ).toBe(true)
    })
  })
})

describe('GraphStatusChangePayloadSchema', () => {
  it('carries correlationId on the envelope even when the snapshot is null', () => {
    const parsed = GraphStatusChangePayloadSchema.parse({
      snapshot: null,
      correlationId: 'idx-1-abcdef012345',
      jobId: null
    })
    expect(parsed.snapshot).toBeNull()
    expect(parsed.correlationId).toBe('idx-1-abcdef012345')
  })

  it('fails without correlationId', () => {
    expect(
      GraphStatusChangePayloadSchema.safeParse({ snapshot: null, jobId: null }).success
    ).toBe(false)
  })

  it('carries a jobId while a job is live', () => {
    const parsed = GraphStatusChangePayloadSchema.parse({
      snapshot: VALID_SNAPSHOT,
      correlationId: 'idx-1-abcdef012345',
      jobId: 'job-1-abcdef012345'
    })
    expect(parsed.jobId).toBe('job-1-abcdef012345')
  })
})

describe('GraphStatusResponseSchema', () => {
  it('parses an empty status request and rejects an unknown key', () => {
    expect(GraphStatusRequestSchema.parse({})).toEqual({})
    expect(GraphStatusRequestSchema.safeParse({ force: true }).success).toBe(false)
  })

  it('round-trips the envelope', () => {
    const parsed = GraphStatusResponseSchema.parse({
      snapshot: VALID_SNAPSHOT,
      error: null,
      correlationId: 'idx-1-abcdef012345'
    })
    expect(parsed.snapshot?.state).toBe('ready')
  })

  it('fails without correlationId', () => {
    expect(GraphStatusResponseSchema.safeParse({ snapshot: null, error: null }).success).toBe(false)
  })
})

describe('GraphPriorityPathsRequestSchema (FR-049)', () => {
  it('parses an empty list', () => {
    expect(GraphPriorityPathsRequestSchema.parse({ paths: [] }).paths).toEqual([])
  })

  it('accepts exactly MAX_PRIORITY_PATHS entries', () => {
    const paths = Array.from({ length: GRAPH.MAX_PRIORITY_PATHS }, (_, i) => `docs/a${i}.md`)
    expect(GraphPriorityPathsRequestSchema.parse({ paths }).paths).toHaveLength(
      GRAPH.MAX_PRIORITY_PATHS
    )
  })

  it('rejects one path over the cap', () => {
    const paths = Array.from({ length: GRAPH.MAX_PRIORITY_PATHS + 1 }, (_, i) => `a${i}.md`)
    expect(GraphPriorityPathsRequestSchema.safeParse({ paths }).success).toBe(false)
  })

  // A read-into-index primitive reachable through the MCP surface if unguarded.
  it.each(['/etc/passwd', '../../../.ssh/id_rsa', 'C:\\Windows\\win.ini', '..\\..\\secret'])(
    'rejects the unconfined path %j',
    (path) => {
      expect(GraphPriorityPathsRequestSchema.safeParse({ paths: [path] }).success).toBe(false)
    }
  )

  it('rejects an unknown key', () => {
    expect(
      GraphPriorityPathsRequestSchema.safeParse({ paths: [], priority: 1 }).success
    ).toBe(false)
  })

  it('round-trips the response', () => {
    const payload = { accepted: 2, rejected: 1, correlationId: 'idx-1-abcdef012345' }
    expect(GraphPriorityPathsResponseSchema.parse(payload)).toEqual(payload)
  })

  it('fails the response without correlationId', () => {
    expect(
      GraphPriorityPathsResponseSchema.safeParse({ accepted: 0, rejected: 0 }).success
    ).toBe(false)
  })
})
