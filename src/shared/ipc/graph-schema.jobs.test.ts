// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph job payloads: reindex, cancel and corpus stats.
 *
 * Split out of `graph-status-schema.test.ts` to keep both inside the house cap.
 *
 * Two design decisions are pinned here because nothing else enforces them:
 *
 * - A reindex REJECTION still carries a `jobId`, because reindex is idempotent
 *   and the caller needs to follow the running job rather than retry blindly.
 * - `GraphCorpusStatsResponse` is an ENVELOPE, not a bare nullable payload: the
 *   Settings panel must distinguish "no project" from "reader down" from "the
 *   query threw", or it picks no `ERROR_MESSAGES` entry and renders a blank.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 1
 * @see specs/designs/sd-021-ipc-contracts.md §7
 */
import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../errors'
import {
  GraphCancelReindexRequestSchema,
  GraphCancelReindexResponseSchema,
  GraphCorpusStatsRequestSchema,
  GraphCorpusStatsResponseSchema,
  GraphCorpusStatsSchema,
  GraphReindexMode,
  GraphReindexReason,
  GraphReindexRequestSchema,
  GraphReindexResponseSchema,
  type GraphReindexRequest,
  type GraphReindexRequestInput
} from './graph-schema'

/** Structural omission — the payload genuinely lacks the key, rather than
 *  carrying it as an explicit `undefined`, which zod can treat differently. */
function omitKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
}

const VALID_STATS = {
  fileCount: 3,
  sectionCount: 12,
  wordCount: 900,
  uniqueContentCount: 11,
  skippedFileCount: 1,
  lastIndexedAtMs: 1_700_000_000_000,
  schemaVersion: 1,
  schemaStability: 'beta' as const,
  dbSizeBytes: 4096
}

describe('GraphReindexRequestSchema', () => {
  it('parses {} with every field defaulted', () => {
    expect(GraphReindexRequestSchema.parse({})).toEqual({ mode: 'full', reason: 'user' })
  })

  // The preload passes `request ?? {}` precisely because of this asymmetry.
  it('fails on parse(undefined) even though parse({}) succeeds', () => {
    expect(GraphReindexRequestSchema.safeParse(undefined).success).toBe(false)
    expect(GraphReindexRequestSchema.safeParse({}).success).toBe(true)
  })

  it('types the input as fully optional and the output as resolved', () => {
    const input: GraphReindexRequestInput = {}
    // @ts-expect-error mode and reason are required on the OUTPUT type.
    const notAnOutput: GraphReindexRequest = {}
    void notAnOutput

    // The `@ts-expect-error` above is the type-level half. The runtime half is
    // that parsing the fully-omitted INPUT yields exactly that resolved OUTPUT
    // — previously `expect([...]).toHaveLength(3)`, which is true of any
    // three-element array literal and could not fail.
    const parsed: GraphReindexRequest = GraphReindexRequestSchema.parse(input)
    expect(parsed).toEqual({ mode: 'full', reason: 'user' })
  })

  it.each(['full', 'incremental'] as const)('accepts mode %s', (mode) => {
    expect(GraphReindexMode.parse(mode)).toBe(mode)
    expect(GraphReindexRequestSchema.parse({ mode }).mode).toBe(mode)
  })

  it.each(['user', 'corruption', 'schema-mismatch', 'overflow-reconcile'] as const)(
    'accepts reason %s',
    (reason) => {
      expect(GraphReindexReason.parse(reason)).toBe(reason)
    }
  )

  it.each(['fts-divergence', 'FULL', 'partial', ''])('rejects the unknown reason %j', (reason) => {
    expect(GraphReindexRequestSchema.safeParse({ reason }).success).toBe(false)
  })

  it.each(['force', 'Mode', 'jobId'])('rejects the unknown request key %s', (key) => {
    expect(GraphReindexRequestSchema.safeParse({ [key]: 'x' }).success).toBe(false)
  })
})

describe('GraphReindexResponseSchema', () => {
  const ACCEPTED = {
    accepted: true,
    jobId: 'job-1-abcdef012345',
    rejectedCode: null,
    correlationId: 'idx-1-abcdef012345'
  }

  it('round-trips an acceptance', () => {
    expect(GraphReindexResponseSchema.parse(ACCEPTED)).toEqual(ACCEPTED)
  })

  // Reindex is idempotent: a rejection still names the RUNNING job so the
  // caller can follow it rather than retry blindly.
  it('carries jobId alongside GRAPH_INDEX_ALREADY_RUNNING', () => {
    const parsed = GraphReindexResponseSchema.parse({
      ...ACCEPTED,
      accepted: false,
      rejectedCode: ErrorCode.GRAPH_INDEX_ALREADY_RUNNING
    })
    expect(parsed.jobId).toBe('job-1-abcdef012345')
    expect(parsed.rejectedCode).toBe(ErrorCode.GRAPH_INDEX_ALREADY_RUNNING)
  })

  it('fails without correlationId', () => {
    const withoutId = omitKey(ACCEPTED, 'correlationId')
    expect(GraphReindexResponseSchema.safeParse(withoutId).success).toBe(false)
  })

  it('rejects a non-graph rejectedCode', () => {
    expect(
      GraphReindexResponseSchema.safeParse({
        ...ACCEPTED,
        rejectedCode: ErrorCode.WHISPER_PROCESS_FAILED
      }).success
    ).toBe(false)
  })
})

describe('GraphCancelReindexSchemas', () => {
  it('parses an empty cancel request', () => {
    expect(GraphCancelReindexRequestSchema.parse({})).toEqual({})
  })

  it('rejects an unknown cancel key', () => {
    expect(GraphCancelReindexRequestSchema.safeParse({ jobId: 'job-1' }).success).toBe(false)
  })

  it('round-trips a cancel response', () => {
    const payload = {
      cancelled: true,
      droppedBatches: 3,
      inFlightAllowedToFinish: true,
      correlationId: 'idx-1-abcdef012345'
    }
    expect(GraphCancelReindexResponseSchema.parse(payload)).toEqual(payload)
  })

  it('fails a cancel response without correlationId', () => {
    expect(
      GraphCancelReindexResponseSchema.safeParse({
        cancelled: false,
        droppedBatches: 0,
        inFlightAllowedToFinish: false
      }).success
    ).toBe(false)
  })
})

describe('GraphCorpusStatsSchema', () => {
  it('round-trips', () => {
    expect(GraphCorpusStatsSchema.parse(VALID_STATS)).toEqual(VALID_STATS)
  })

  it('accepts null lastIndexedAtMs and dbSizeBytes', () => {
    const parsed = GraphCorpusStatsSchema.parse({
      ...VALID_STATS,
      lastIndexedAtMs: null,
      dbSizeBytes: null
    })
    expect(parsed.lastIndexedAtMs).toBeNull()
    expect(parsed.dbSizeBytes).toBeNull()
  })

  // The corpusStats query reads value_int precisely so no string reaches here.
  it("rejects a string schemaVersion, the '1' that TEXT affinity would return", () => {
    expect(GraphCorpusStatsSchema.safeParse({ ...VALID_STATS, schemaVersion: '1' }).success).toBe(
      false
    )
  })

  it.each(['stable', 'beta'] as const)('accepts schemaStability %s', (schemaStability) => {
    expect(GraphCorpusStatsSchema.parse({ ...VALID_STATS, schemaStability }).schemaStability).toBe(
      schemaStability
    )
  })

  it('rejects an unknown schemaStability', () => {
    expect(
      GraphCorpusStatsSchema.safeParse({ ...VALID_STATS, schemaStability: 'frozen' }).success
    ).toBe(false)
  })

  it.each(['fileCount', 'sectionCount', 'wordCount', 'uniqueContentCount', 'skippedFileCount'])(
    'rejects a negative %s',
    (field) => {
      expect(GraphCorpusStatsSchema.safeParse({ ...VALID_STATS, [field]: -1 }).success).toBe(false)
    }
  )
})

describe('GraphCorpusStatsResponseSchema', () => {
  it('parses the no-project envelope: null stats with no error', () => {
    const parsed = GraphCorpusStatsResponseSchema.parse({
      stats: null,
      error: null,
      correlationId: 'idx-1-abcdef012345'
    })
    expect(parsed.stats).toBeNull()
    expect(parsed.error).toBeNull()
  })

  it('parses the reader-down envelope: null stats with an error', () => {
    const parsed = GraphCorpusStatsResponseSchema.parse({
      stats: null,
      error: { code: ErrorCode.GRAPH_DB_NOT_READY, atMs: 1 },
      correlationId: 'idx-1-abcdef012345'
    })
    expect(parsed.error?.code).toBe(ErrorCode.GRAPH_DB_NOT_READY)
  })

  it('fails without correlationId', () => {
    expect(
      GraphCorpusStatsResponseSchema.safeParse({ stats: null, error: null }).success
    ).toBe(false)
  })

  it('parses an empty stats request and rejects an unknown key', () => {
    expect(GraphCorpusStatsRequestSchema.parse({})).toEqual({})
    expect(GraphCorpusStatsRequestSchema.safeParse({ refresh: true }).success).toBe(false)
  })
})

