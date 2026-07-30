// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph index-worker protocol.
 *
 * The worker is the only component that writes to disk, so `safeParse` runs in
 * BOTH directions and the discriminated unions must be exhaustive: a message
 * whose `type` falls out of the union is dropped, and a dropped `result`
 * silently strands a `pending` entry until its timeout.
 *
 * The envelope carries TWO fences — `switchVersion` and `sessionVersion` — on
 * every message in both directions. `jobVersion` is a third fence but is
 * **per-message**: only the job-scoped members (`index`, `result`, `progress`)
 * declare it, so the assertions below pin exactly where it is required and
 * where its absence is correct, rather than asserting a blanket triple fence the
 * schemas do not implement. `jobId` is a correlation string and cannot serve
 * either purpose, which is why it is asserted as present-and-required rather
 * than treated as a fence.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-worker-contracts.md §8.2, §8.8
 */
import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../errors'
import { GRAPH } from '../graph-constants'
import {
  GRAPH_PHASES,
  GraphPhaseDurationsSchema,
  GraphWorkerBatchEntrySchema,
  GraphWorkerCloseRequestSchema,
  GraphWorkerErrorMessageSchema,
  GraphWorkerIndexRequestSchema,
  GraphWorkerIndexResultMessageSchema,
  GraphWorkerMessageSchema,
  GraphWorkerOpenRequestSchema,
  GraphWorkerProgressMessageSchema,
  GraphWorkerReadyMessageSchema,
  GraphWorkerRebuildRequestSchema,
  GraphWorkerRequestSchema,
  GraphWorkerSkipSchema
} from './graph-worker-schema'

/** Structural omission — the payload genuinely lacks the key, rather than
 *  carrying it as an explicit `undefined`, which zod can treat differently. */
function omitKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
}

/** Every message in both directions carries these five fields. */
const ENVELOPE = {
  id: 1,
  switchVersion: 0,
  sessionVersion: 0,
  correlationId: 'idx-1-abcdef012345',
  jobId: 'job-1-abcdef012345'
}

const OPEN = {
  ...ENVELOPE,
  type: 'open' as const,
  dbPath: '/p/.erfana/graph.db',
  projectPath: '/p',
  expectedSchemaVersion: 1
}

const INDEX = {
  ...ENVELOPE,
  type: 'index' as const,
  jobVersion: 0,
  mode: 'incremental' as const,
  batch: [{ path: 'a.md', op: 'upsert' as const }]
}

const REBUILD = { ...ENVELOPE, type: 'rebuild' as const, reason: 'corruption' as const }
const CLOSE = { ...ENVELOPE, type: 'close' as const }

const READY = {
  ...ENVELOPE,
  type: 'ready' as const,
  generation: '-8134159219358100000',
  schemaVersion: 1,
  rebuilt: false,
  autoRebuildCount: 0,
  phaseDurationsMs: { open: 1.5, integrity_check: 2 }
}

const RESULT = {
  ...ENVELOPE,
  type: 'result' as const,
  jobVersion: 0,
  indexedFiles: 3,
  skippedFiles: [],
  sectionsWritten: 12,
  sectionsDeleted: 4,
  completedAtMs: 1_700_000_000_000,
  batchDurationMs: 42.5,
  phaseDurationsMs: { read: 1, parse: 2, hash: 0.5, write_txn: 3 }
}

const WORKER_ERROR = {
  ...ENVELOPE,
  type: 'error' as const,
  code: ErrorCode.GRAPH_INDEX_BATCH_FAILED
}

const PROGRESS = {
  ...ENVELOPE,
  type: 'progress' as const,
  jobVersion: 0,
  processedFiles: 5,
  totalFiles: 10,
  skippedFiles: 1,
  currentFilePath: 'docs/a.md'
}

describe('GRAPH_PHASES', () => {
  it('is the frozen 11-phase list §8.8 names', () => {
    expect(GRAPH_PHASES).toEqual([
      'open',
      'integrity_check',
      'audit',
      'rebuild',
      'discover',
      'read',
      'parse',
      'hash',
      'write_txn',
      'fts_merge',
      'search'
    ])
  })

  it('has no duplicate phase', () => {
    expect(new Set(GRAPH_PHASES).size).toBe(GRAPH_PHASES.length)
  })

  // Partial by design — a message reports only the phases it actually ran, so
  // a `ready` need not invent a `write_txn` duration.
  it('accepts a partial record', () => {
    expect(GraphPhaseDurationsSchema.parse({ open: 1 })).toEqual({ open: 1 })
    expect(GraphPhaseDurationsSchema.parse({})).toEqual({})
  })

  it('accepts every phase key', () => {
    const all = Object.fromEntries(GRAPH_PHASES.map((p) => [p, 0]))
    expect(Object.keys(GraphPhaseDurationsSchema.parse(all))).toHaveLength(GRAPH_PHASES.length)
  })

  it.each(['writeTxn', 'integrityCheck', 'merge'])('rejects the unknown phase key %s', (key) => {
    expect(GraphPhaseDurationsSchema.safeParse({ [key]: 1 }).success).toBe(false)
  })

  it('rejects a negative duration', () => {
    expect(GraphPhaseDurationsSchema.safeParse({ open: -1 }).success).toBe(false)
  })
})

describe('main → worker requests', () => {
  it.each([
    ['open', OPEN, GraphWorkerOpenRequestSchema],
    ['index', INDEX, GraphWorkerIndexRequestSchema],
    ['rebuild', REBUILD, GraphWorkerRebuildRequestSchema],
    ['close', CLOSE, GraphWorkerCloseRequestSchema]
  ] as const)('round-trips a %s request', (_label, payload, schema) => {
    expect(schema.parse(payload)).toEqual(payload)
  })

  describe('discriminated union exhaustiveness', () => {
    it.each([OPEN, INDEX, REBUILD, CLOSE])('routes $type through the union', (payload) => {
      expect(GraphWorkerRequestSchema.parse(payload).type).toBe(payload.type)
    })

    it('covers exactly the four request verbs', () => {
      const verbs = [OPEN, INDEX, REBUILD, CLOSE].map(
        (m) => GraphWorkerRequestSchema.parse(m).type
      )
      expect(new Set(verbs)).toEqual(new Set(['open', 'index', 'rebuild', 'close']))
    })

    // Cancellation is cooperative and main-side: better-sqlite3 cannot be
    // interrupted, so there is deliberately no `cancel` verb to add here.
    it.each(['cancel', 'vacuum', 'search', 'Open', ''])(
      'rejects the unknown verb %j',
      (type) => {
        expect(GraphWorkerRequestSchema.safeParse({ ...ENVELOPE, type }).success).toBe(false)
      }
    )

    it('rejects a message with no type at all', () => {
      expect(GraphWorkerRequestSchema.safeParse({ ...ENVELOPE }).success).toBe(false)
    })
  })

  describe('envelope fences', () => {
    it.each(['id', 'switchVersion', 'sessionVersion', 'correlationId', 'jobId'])(
      'requires %s on every request',
      (field) => {
        const withoutField = omitKey(OPEN, field)
        expect(GraphWorkerRequestSchema.safeParse(withoutField).success).toBe(false)
      }
    )

    it('rejects id = 0 — the pending map keys on a positive integer', () => {
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, id: 0 }).success).toBe(false)
    })

    it.each(['switchVersion', 'sessionVersion'])('accepts %s = 0 but rejects -1', (field) => {
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, [field]: 0 }).success).toBe(true)
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, [field]: -1 }).success).toBe(false)
    })

    it('requires jobVersion on index but not on open', () => {
      const withoutJobVersion = omitKey(INDEX, 'jobVersion')
      expect(GraphWorkerRequestSchema.safeParse(withoutJobVersion).success).toBe(false)
      expect(GraphWorkerRequestSchema.safeParse(OPEN).success).toBe(true)
    })

    it('rejects a blank correlationId or jobId', () => {
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, correlationId: '' }).success).toBe(false)
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, jobId: '' }).success).toBe(false)
    })
  })

  describe('strictObject (S-M2)', () => {
    // The renderer's permissiveness argument — main adds a field without
    // breaking an older renderer mid-upgrade — has no analogue for a worker
    // shipping in the same binary. What a plain z.object buys here is silence.
    it.each([
      ['open', OPEN, GraphWorkerOpenRequestSchema],
      ['index', INDEX, GraphWorkerIndexRequestSchema],
      ['rebuild', REBUILD, GraphWorkerRebuildRequestSchema],
      ['close', CLOSE, GraphWorkerCloseRequestSchema]
    ] as const)('rejects an unknown key on a %s request', (_label, payload, schema) => {
      expect(schema.safeParse({ ...payload, futureField: 1 }).success).toBe(false)
    })

    // The named bug: jobVersion is a SECURITY-relevant fence, and a mis-cased
    // sibling would be stripped, leaving the request parsed and unfenced.
    it('rejects the jobversion case typo rather than disarming the job fence', () => {
      const { jobVersion, ...withoutFence } = INDEX
      expect(
        GraphWorkerRequestSchema.safeParse({ ...withoutFence, jobversion: jobVersion }).success
      ).toBe(false)
    })

    it('rejects an unknown key on a batch entry', () => {
      expect(
        GraphWorkerBatchEntrySchema.safeParse({ path: 'a.md', op: 'upsert', mtimeMs: 1 }).success
      ).toBe(false)
    })

    it('rejects an unknown key through the request union', () => {
      expect(GraphWorkerRequestSchema.safeParse({ ...OPEN, dbpath: '/p' }).success).toBe(false)
    })
  })

  it.each(['dbPath', 'projectPath'])('bounds %s at 4096 characters (S-L2)', (field) => {
    expect(
      GraphWorkerOpenRequestSchema.safeParse({ ...OPEN, [field]: 'x'.repeat(4097) }).success
    ).toBe(false)
  })

  describe('index batch', () => {
    it.each(['upsert', 'delete', 'deleteSubtree'] as const)('accepts op %s', (op) => {
      expect(GraphWorkerBatchEntrySchema.parse({ path: 'a.md', op }).op).toBe(op)
    })

    it.each(['insert', 'update', 'unlink', 'UPSERT'])('rejects the unknown op %j', (op) => {
      expect(GraphWorkerBatchEntrySchema.safeParse({ path: 'a.md', op }).success).toBe(false)
    })

    it('rejects an empty path', () => {
      expect(GraphWorkerBatchEntrySchema.safeParse({ path: '', op: 'upsert' }).success).toBe(false)
    })

    // The batch is the write path INTO the index, so an absolute, traversal, ADS
    // or reserved-name entry is a read-into-index primitive — now confined.
    it.each([
      ['a POSIX absolute', '/etc/passwd'],
      ['a traversal', '../a.md'],
      ['a drive path', 'C:\\x'],
      ['an NTFS ADS', 'notes.md:hidden'],
      ['a reserved device name', 'COM1']
    ])('rejects %s (%j) on a batch entry', (_label, path) => {
      expect(GraphWorkerBatchEntrySchema.safeParse({ path, op: 'upsert' }).success).toBe(false)
    })

    it('accepts an ordinary project-relative batch path', () => {
      expect(GraphWorkerBatchEntrySchema.parse({ path: 'docs/notes.md', op: 'upsert' }).path).toBe(
        'docs/notes.md'
      )
    })

    it('accepts a batch at exactly MAX_BATCH_SIZE', () => {
      const batch = Array.from({ length: GRAPH.MAX_BATCH_SIZE }, (_, i) => ({
        path: `a${i}.md`,
        op: 'upsert' as const
      }))
      expect(GraphWorkerIndexRequestSchema.parse({ ...INDEX, batch }).batch).toHaveLength(
        GRAPH.MAX_BATCH_SIZE
      )
    })

    // The bound is why a subtree delete can materialise every affected section
    // at once without an unbounded transaction.
    it('rejects a batch one entry over MAX_BATCH_SIZE', () => {
      const batch = Array.from({ length: GRAPH.MAX_BATCH_SIZE + 1 }, (_, i) => ({
        path: `a${i}.md`,
        op: 'upsert' as const
      }))
      expect(GraphWorkerIndexRequestSchema.safeParse({ ...INDEX, batch }).success).toBe(false)
    })

    it('accepts an empty batch', () => {
      expect(GraphWorkerIndexRequestSchema.parse({ ...INDEX, batch: [] }).batch).toEqual([])
    })
  })

  it('rejects an unknown reindex reason on rebuild', () => {
    expect(
      GraphWorkerRebuildRequestSchema.safeParse({ ...REBUILD, reason: 'fts-divergence' }).success
    ).toBe(false)
  })

  it('requires a non-empty dbPath and projectPath on open', () => {
    expect(GraphWorkerOpenRequestSchema.safeParse({ ...OPEN, dbPath: '' }).success).toBe(false)
    expect(GraphWorkerOpenRequestSchema.safeParse({ ...OPEN, projectPath: '' }).success).toBe(false)
  })

  it('rejects expectedSchemaVersion 0 — versions are 1-based', () => {
    expect(
      GraphWorkerOpenRequestSchema.safeParse({ ...OPEN, expectedSchemaVersion: 0 }).success
    ).toBe(false)
  })
})

describe('worker → main messages', () => {
  it.each([
    ['ready', READY, GraphWorkerReadyMessageSchema],
    ['result', RESULT, GraphWorkerIndexResultMessageSchema],
    ['error', WORKER_ERROR, GraphWorkerErrorMessageSchema],
    ['progress', PROGRESS, GraphWorkerProgressMessageSchema]
  ] as const)('round-trips a %s message', (_label, payload, schema) => {
    expect(schema.parse(payload)).toEqual(payload)
  })

  describe('discriminated union exhaustiveness', () => {
    it.each([READY, RESULT, WORKER_ERROR, PROGRESS])('routes $type through the union', (payload) => {
      expect(GraphWorkerMessageSchema.parse(payload).type).toBe(payload.type)
    })

    it('covers exactly the four inbound types', () => {
      const types = [READY, RESULT, WORKER_ERROR, PROGRESS].map(
        (m) => GraphWorkerMessageSchema.parse(m).type
      )
      expect(new Set(types)).toEqual(new Set(['ready', 'result', 'error', 'progress']))
    })

    it.each(['done', 'log', 'Ready', 'result '])('drops the unknown type %j', (type) => {
      expect(GraphWorkerMessageSchema.safeParse({ ...ENVELOPE, type }).success).toBe(false)
    })

    // The fencing rule is per message class, not blanket: `ready` and `error`
    // have no third fence to check, so an adapter written to "drop unless all
    // three match" would drop every one of them.
    it('declares jobVersion only on the job-scoped members', () => {
      expect(GraphWorkerReadyMessageSchema.parse(READY)).not.toHaveProperty('jobVersion')
      expect(GraphWorkerErrorMessageSchema.parse(WORKER_ERROR)).not.toHaveProperty('jobVersion')
      expect(GraphWorkerIndexResultMessageSchema.parse(RESULT).jobVersion).toBe(0)
      expect(GraphWorkerProgressMessageSchema.parse(PROGRESS).jobVersion).toBe(0)
    })
  })

  describe('ready', () => {
    // Random 64-bit token, not a counter: C2 needs difference, not monotonicity.
    it.each(['0', '1', '-9223372036854775808', '9223372036854775807'])(
      'accepts the decimal generation %s',
      (generation) => {
        expect(GraphWorkerReadyMessageSchema.parse({ ...READY, generation }).generation).toBe(
          generation
        )
      }
    )

    it.each(['0x1f', '1.5', '', 'abc', ' 1'])(
      'rejects the non-decimal generation %j',
      (generation) => {
        expect(GraphWorkerReadyMessageSchema.safeParse({ ...READY, generation }).success).toBe(
          false
        )
      }
    )

    it('carries rebuilt, which unconditionally clears the reader cache (M4)', () => {
      expect(GraphWorkerReadyMessageSchema.parse({ ...READY, rebuilt: true }).rebuilt).toBe(true)
    })

    it('requires rebuilt rather than defaulting it to false', () => {
      const withoutRebuilt = omitKey(READY, 'rebuilt')
      expect(GraphWorkerReadyMessageSchema.safeParse(withoutRebuilt).success).toBe(false)
    })

    it('carries the persisted autoRebuildCount for the B4 budget', () => {
      expect(
        GraphWorkerReadyMessageSchema.parse({ ...READY, autoRebuildCount: 2 }).autoRebuildCount
      ).toBe(2)
    })
  })

  describe('result', () => {
    it('carries per-file skips with a graph code', () => {
      const parsed = GraphWorkerIndexResultMessageSchema.parse({
        ...RESULT,
        skippedFiles: [
          { path: 'big.md', code: ErrorCode.GRAPH_INDEX_FILE_TOO_LARGE },
          { path: 'bad.md', code: ErrorCode.GRAPH_INDEX_PARSE_FAILED }
        ]
      })
      expect(parsed.skippedFiles).toHaveLength(2)
    })

    it('rejects a non-graph code on a skip', () => {
      expect(
        GraphWorkerSkipSchema.safeParse({ path: 'a.md', code: ErrorCode.WHISPER_PROCESS_FAILED })
          .success
      ).toBe(false)
    })

    it('requires jobVersion so a cancelled job cannot drive the next accumulator', () => {
      const withoutJobVersion = omitKey(RESULT, 'jobVersion')
      expect(GraphWorkerIndexResultMessageSchema.safeParse(withoutJobVersion).success).toBe(false)
    })

    it.each(['indexedFiles', 'sectionsWritten', 'sectionsDeleted'])(
      'rejects a negative %s',
      (field) => {
        expect(
          GraphWorkerIndexResultMessageSchema.safeParse({ ...RESULT, [field]: -1 }).success
        ).toBe(false)
      }
    )

    it('accepts a fractional batchDurationMs but not a negative one', () => {
      expect(
        GraphWorkerIndexResultMessageSchema.parse({ ...RESULT, batchDurationMs: 0.25 })
          .batchDurationMs
      ).toBe(0.25)
      expect(
        GraphWorkerIndexResultMessageSchema.safeParse({ ...RESULT, batchDurationMs: -1 }).success
      ).toBe(false)
    })
  })

  describe('error', () => {
    it('accepts an optional log-only detail', () => {
      const parsed = GraphWorkerErrorMessageSchema.parse({
        ...WORKER_ERROR,
        detail: 'SQLITE_CONSTRAINT: /Users/x/p/.erfana/graph.db'
      })
      expect(parsed.detail).toContain('SQLITE_CONSTRAINT')
    })

    it('parses without a detail', () => {
      expect(GraphWorkerErrorMessageSchema.parse(WORKER_ERROR).detail).toBeUndefined()
    })

    it('rejects an over-length detail', () => {
      expect(
        GraphWorkerErrorMessageSchema.safeParse({ ...WORKER_ERROR, detail: 'x'.repeat(2049) })
          .success
      ).toBe(false)
    })

    it('rejects a non-graph code', () => {
      expect(
        GraphWorkerErrorMessageSchema.safeParse({
          ...WORKER_ERROR,
          code: ErrorCode.WHISPER_PROCESS_FAILED
        }).success
      ).toBe(false)
    })

    it('accepts GRAPH_WORKER_PROTOCOL, the reply to a malformed request', () => {
      expect(
        GraphWorkerErrorMessageSchema.parse({
          ...WORKER_ERROR,
          code: ErrorCode.GRAPH_WORKER_PROTOCOL
        }).code
      ).toBe(ErrorCode.GRAPH_WORKER_PROTOCOL)
    })
  })

  describe('progress', () => {
    // A stream, not a reply: it carries an id for fencing symmetry but must
    // never be routed through the adapter's pending map.
    it('carries the full envelope including id', () => {
      expect(GraphWorkerProgressMessageSchema.parse(PROGRESS).id).toBe(1)
    })

    it('accepts a null currentFilePath', () => {
      expect(
        GraphWorkerProgressMessageSchema.parse({ ...PROGRESS, currentFilePath: null })
          .currentFilePath
      ).toBeNull()
    })

    it('requires currentFilePath to be present, even as null', () => {
      const withoutPath = omitKey(PROGRESS, 'currentFilePath')
      expect(GraphWorkerProgressMessageSchema.safeParse(withoutPath).success).toBe(false)
    })
  })
})
