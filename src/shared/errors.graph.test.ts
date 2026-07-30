// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph/MCP slice of `ErrorCode` + `ERROR_MESSAGES`.
 *
 * `Record<ErrorCode, string>` already forces an entry to EXIST for every code —
 * that is what `npm run typecheck` proves. It cannot prove the entry is
 * non-empty, is not a copy-paste of its neighbour, or that `GRAPH_ERROR_CODES`
 * (the IPC-boundary list) and the `GRAPH_`/`MCP_` prefixed enum members are the
 * same set. A code added to the enum but forgotten in the boundary list would
 * typecheck, ship, and then fail `safeParse` on the wire.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 3
 * @see specs/designs/sd-021-cross-cutting.md §9.2 - the code table with user copy
 */
import { describe, it, expect } from 'vitest'
import { ERROR_MESSAGES, ErrorCode, AppError, getUserFriendlyMessage } from './errors'
import { GRAPH_ERROR_CODES } from './ipc/graph-schema'

/** Every enum member whose name is prefixed for this feature. */
const PREFIXED_CODES = Object.values(ErrorCode).filter(
  (code) => code.startsWith('GRAPH_') || code.startsWith('MCP_')
)

describe('graph/MCP error codes', () => {
  it('adds 26 codes', () => {
    expect(PREFIXED_CODES).toHaveLength(26)
  })

  it('matches GRAPH_ERROR_CODES.length', () => {
    expect(PREFIXED_CODES).toHaveLength(GRAPH_ERROR_CODES.length)
  })

  // The real assertion: a code added to one and forgotten in the other cannot
  // be caught by the type system, because both are structurally `ErrorCode[]`.
  it('is exactly the same set as the IPC boundary list', () => {
    expect(new Set(GRAPH_ERROR_CODES)).toEqual(new Set(PREFIXED_CODES))
  })

  it('has no duplicate member in the boundary list', () => {
    expect(new Set(GRAPH_ERROR_CODES).size).toBe(GRAPH_ERROR_CODES.length)
  })

  it('names every enum member identically to its value', () => {
    for (const code of PREFIXED_CODES) {
      expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code)
    }
  })

  // The phantom: revision 2 named `GRAPH_DB_NOT_WRITABLE` two sentences before
  // using the real `GRAPH_DB_DIR_NOT_WRITABLE`. m9 deleted it. If someone
  // re-adds it, C7 gains two codes for one condition.
  it('does not carry the phantom GRAPH_DB_NOT_WRITABLE', () => {
    expect(Object.values(ErrorCode)).not.toContain('GRAPH_DB_NOT_WRITABLE')
    expect(PREFIXED_CODES).toContain(ErrorCode.GRAPH_DB_DIR_NOT_WRITABLE)
  })

  it('splits into 23 GRAPH_ codes and 3 MCP_ codes', () => {
    expect(PREFIXED_CODES.filter((c) => c.startsWith('GRAPH_'))).toHaveLength(23)
    expect(PREFIXED_CODES.filter((c) => c.startsWith('MCP_'))).toHaveLength(3)
  })
})

describe('ERROR_MESSAGES coverage', () => {
  it.each(PREFIXED_CODES)('%s has a non-empty message', (code) => {
    const message = ERROR_MESSAGES[code]
    expect(typeof message).toBe('string')
    expect(message.trim().length).toBeGreaterThan(0)
  })

  it.each(PREFIXED_CODES)('%s does not fall back to the UNKNOWN_ERROR copy', (code) => {
    expect(ERROR_MESSAGES[code]).not.toBe(ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR])
  })

  // A duplicated string is exactly what the Record type cannot catch, and the
  // symptom is a user seeing the same sentence for two unrelated failures.
  it('has a distinct message for every graph/MCP code', () => {
    const messages = PREFIXED_CODES.map((code) => ERROR_MESSAGES[code])
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('does not reuse a non-graph message for a graph code', () => {
    const otherMessages = new Set(
      Object.values(ErrorCode)
        .filter((c) => !PREFIXED_CODES.includes(c))
        .map((c) => ERROR_MESSAGES[c])
    )
    const collisions = PREFIXED_CODES.filter((c) => otherMessages.has(ERROR_MESSAGES[c]))
    expect(collisions).toEqual([])
  })

  it.each(PREFIXED_CODES)('%s copy is user-facing prose, not a code echo', (code) => {
    const message = ERROR_MESSAGES[code]
    expect(message).not.toContain(code)
    expect(message).not.toMatch(/SQLITE_|\bundefined\b|\[object /)
  })

  it.each(PREFIXED_CODES)('%s copy leaks no absolute path', (code) => {
    // A leading '/' or a drive letter would mean an operational detail escaped
    // into user copy; '.erfana' as a bare relative name is intended.
    expect(ERROR_MESSAGES[code]).not.toMatch(/(^|\s)[/~]|[A-Z]:\\/)
  })

  it('routes an AppError through the mapped copy', () => {
    const error = new AppError('internal detail', ErrorCode.GRAPH_DB_CORRUPTED)
    expect(getUserFriendlyMessage(error)).toBe(ERROR_MESSAGES[ErrorCode.GRAPH_DB_CORRUPTED])
    expect(getUserFriendlyMessage(error)).not.toContain('internal detail')
  })
})

describe('copy intent for the states the design calls out', () => {
  // E5: the first recovery is silent and automatic; the copy must not prompt.
  it('describes automatic recovery for GRAPH_DB_CORRUPTED', () => {
    expect(ERROR_MESSAGES[ErrorCode.GRAPH_DB_CORRUPTED]).toMatch(/automatic/i)
  })

  it('describes automatic recovery for GRAPH_DB_SCHEMA_MISMATCH', () => {
    expect(ERROR_MESSAGES[ErrorCode.GRAPH_DB_SCHEMA_MISMATCH]).toMatch(/automatic/i)
  })

  // E5 again: a LOOP is not silent — the budget-exhausted copy must hand the
  // user the manual lever rather than promise another retry.
  it('points GRAPH_DB_REBUILD_FAILED at the manual Rebuild index button', () => {
    expect(ERROR_MESSAGES[ErrorCode.GRAPH_DB_REBUILD_FAILED]).toMatch(/Rebuild index/)
  })

  it('points GRAPH_WORKER_DISABLED at the same manual lever', () => {
    expect(ERROR_MESSAGES[ErrorCode.GRAPH_WORKER_DISABLED]).toMatch(/Rebuild index/)
  })
})
