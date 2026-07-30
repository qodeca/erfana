// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the two-level correlation id helpers.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 8
 */
import { describe, expect, it } from 'vitest'
import {
  GRAPH_CORRELATION_ID_PATTERN,
  GRAPH_JOB_ID_PATTERN,
  generateGraphCorrelationId,
  generateGraphJobId
} from './graphCorrelation'

const DRAWS = 10_000

describe('generateGraphCorrelationId', () => {
  it('matches idx-<epochMs>-<12 hex>', () => {
    expect(generateGraphCorrelationId()).toMatch(GRAPH_CORRELATION_ID_PATTERN)
  })

  it('embeds a plausible current timestamp', () => {
    const before = Date.now()
    const stamp = Number(generateGraphCorrelationId().split('-')[1])
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThanOrEqual(Date.now())
  })

  it('is not a job id', () => {
    expect(generateGraphCorrelationId()).not.toMatch(GRAPH_JOB_ID_PATTERN)
  })
})

describe('generateGraphJobId', () => {
  it('matches job-<epochMs>-<12 hex>', () => {
    expect(generateGraphJobId()).toMatch(GRAPH_JOB_ID_PATTERN)
  })

  it('is not a correlation id', () => {
    expect(generateGraphJobId()).not.toMatch(GRAPH_CORRELATION_ID_PATTERN)
  })
})

describe('id uniqueness', () => {
  // Probabilistic, not a guarantee: 48 CSPRNG bits over 10 000 draws gives
  // birthday collision odds of ~1.8e-7. Asserted as a safety check.
  function drawUnique(mint: () => string): number {
    const ids = new Set<string>()
    for (let i = 0; i < DRAWS; i++) ids.add(mint())
    return ids.size
  }

  it('draws 10 000 distinct correlation ids', () => {
    expect(drawUnique(generateGraphCorrelationId)).toBe(DRAWS)
  })

  it('draws 10 000 distinct job ids', () => {
    expect(drawUnique(generateGraphJobId)).toBe(DRAWS)
  })

  // A 2-element Set has size 2 regardless of prefix, so the discriminating
  // property is asserted directly: the two ids carry DIFFERENT prefixes, and
  // each fails the OTHER family's pattern. If the prefixes ever converged (the
  // collision this test is named for) a job id would satisfy the correlation
  // pattern and vice versa, reddening these.
  it('mints distinct prefixes so neither id matches the other family pattern', () => {
    const correlationId = generateGraphCorrelationId()
    const jobId = generateGraphJobId()

    const prefixOf = (id: string): string => id.split('-')[0]
    expect(prefixOf(correlationId)).not.toBe(prefixOf(jobId))

    expect(jobId).not.toMatch(GRAPH_CORRELATION_ID_PATTERN)
    expect(correlationId).not.toMatch(GRAPH_JOB_ID_PATTERN)
  })
})
