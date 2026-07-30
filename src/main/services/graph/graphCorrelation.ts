// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Two-level correlation ids for the graph engine.
 *
 * A 10 000-file reindex at the default batch size produces ~200 `index`
 * messages. A flat per-batch id with nothing tying it to a parent means grepping
 * one id yields one batch, with no way to enumerate its siblings, count failures
 * or bound wall time — NFR-011 failing on the longest, most failure-prone
 * operation in the system. So:
 *
 * - **`jobId`** is minted once per reindex or DB swap.
 * - **`correlationId`** is minted once per batch or request.
 * - Both are required on every worker message in both directions, echoed
 *   verbatim, and present in every graph log context.
 *
 * Contract-only for #21: nothing calls these yet.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7.9 - correlation policy
 * @see specs/designs/sd-021-cross-cutting.md §9.9 - diagnosability
 */
import { randomBytes } from 'node:crypto'

/** Bytes of CSPRNG entropy per id — 48 bits, rendered as 12 lowercase hex digits. */
const ID_ENTROPY_BYTES = 6

/** Matches {@link generateGraphCorrelationId} output. */
export const GRAPH_CORRELATION_ID_PATTERN = /^idx-\d+-[0-9a-f]{12}$/

/** Matches {@link generateGraphJobId} output. */
export const GRAPH_JOB_ID_PATTERN = /^job-\d+-[0-9a-f]{12}$/

function mintId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(ID_ENTROPY_BYTES).toString('hex')}`
}

/**
 * Mint a per-request / per-batch correlation id.
 *
 * `Date.now()` orders ids in a log bundle; the 48 CSPRNG bits make them unique.
 * Uniqueness is probabilistic, not guaranteed: at 10 000 ids drawn inside a
 * single millisecond the birthday collision odds are ≈1.8 × 10⁻⁷. That is a
 * safety property, not an invariant — nothing may key persistent state on
 * uniqueness alone.
 *
 * @returns e.g. `idx-1753632000000-9f2c1ab40d7e`
 */
export function generateGraphCorrelationId(): string {
  return mintId('idx')
}

/**
 * Mint a per-reindex / per-DB-swap job id — the parent scope spanning ~200
 * batch correlation ids.
 *
 * @returns e.g. `job-1753632000000-3b7de91c0552`
 */
export function generateGraphJobId(): string {
  return mintId('job')
}
