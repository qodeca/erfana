// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * modelId — the #383 capability-table refresh: the "verified on" date moved
 * with it, and the newly listed rows also answer for their dated snapshot ids.
 *
 * Split out of `modelId.test.ts` (already over the 500-line convention). The
 * 180-day freshness test there only bounds the date's AGE, so leaving
 * `CAPABILITIES_VERIFIED_ON` at the pre-#383 value (2026-08-07) would still pass
 * it for months. The check below pins the date to the refresh the design
 * document records, read from the document rather than hard-coded here, so the
 * next §2.0 run moves the floor by editing the design alone.
 *
 * Expectations are hand-written from design §2.1, §6.2 and §7.1, never derived
 * from `modelId.ts`.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models and when /model names a 1M-only model
 * @see docs/designs/context-meter/41-model-capability-registry.md §2.0 step 5, §2.1, §6.2, §7.1
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CAPABILITIES_VERIFIED_ON,
  isFamilyGuess,
  parseModelId,
  stickyModelKey,
  windowForModelId
} from './modelId'
import { friendlyModelName } from './friendlyModelName'

const EXTENDED = 1_000_000

const DESIGN_PATH = resolve(
  __dirname,
  '../../../../docs/designs/context-meter/41-model-capability-registry.md'
)

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g

/**
 * The §2.1 sentence that records every run of the §2.0 gate ("The gate ran on
 * … and again on …"). Throws rather than returning nothing, so a reworded
 * sentence cannot make the comparison below vacuously true.
 */
function designGateRunDates(markdown: string): string[] {
  const line = markdown.split('\n').find((l) => l.startsWith('The gate ran on '))
  if (line === undefined) throw new Error('design §2.1: "The gate ran on …" sentence not found')
  const runs = line.slice(0, line.indexOf(';') === -1 ? undefined : line.indexOf(';'))
  const dates = [...runs.matchAll(ISO_DATE)].map((m) => m[1])
  if (dates.length === 0) throw new Error('design §2.1: no run date in the gate sentence')
  return dates
}

describe('#383 - CAPABILITIES_VERIFIED_ON moved with the table refresh', () => {
  const markdown = readFileSync(DESIGN_PATH, 'utf8')
  const runs = designGateRunDates(markdown)
  const latestRun = [...runs].sort().at(-1) as string

  it('reads both recorded gate runs from the design, the #41 one and the #383 one', () => {
    // Guards the parser: the first run (#41) and at least one refresh after it.
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(runs[0]).toBe('2026-08-07')
  })

  it('is on or after the latest gate run the design records (§2.0 step 5)', () => {
    // ISO dates compare correctly as strings; parsed too, so a malformed value fails.
    expect(Number.isNaN(Date.parse(`${CAPABILITIES_VERIFIED_ON}T00:00:00Z`))).toBe(false)
    expect(
      CAPABILITIES_VERIFIED_ON >= latestRun,
      `CAPABILITIES_VERIFIED_ON (${CAPABILITIES_VERIFIED_ON}) predates the §2.0 run the design records on ${latestRun}`
    ).toBe(true)
  })

  it('matches the value the design says modelId.ts records', () => {
    const quoted = /`CAPABILITIES_VERIFIED_ON = '(\d{4}-\d{2}-\d{2})'`/.exec(markdown)
    expect(quoted, 'design §2.1 no longer quotes the constant').not.toBeNull()
    expect(CAPABILITIES_VERIFIED_ON).toBe(quoted?.[1])
  })
})

describe('#383 - a dated snapshot of a newly listed model resolves through its row', () => {
  // §7.1 lookup: dated canonical id first, then the undated alias. These rows
  // were added by #383, so their dated forms must hit the listed row — a 1M
  // that is NOT a family guess and therefore not shown as `(inferred)` for a
  // 200k answer, and not carried by the unbounded §7.2 guess.
  const dated: ReadonlyArray<[id: string, label: string]> = [
    ['claude-opus-5-5-20261101', 'Opus 5.5'],
    ['claude-sonnet-5-5-20261101', 'Sonnet 5.5'],
    ['claude-haiku-5-5-20261101', 'Haiku 5.5'],
    ['claude-fable-5-1-20261101', 'Fable 5.1'],
    ['claude-mythos-5-1-20261101', 'Mythos 5.1']
  ]

  it.each(dated)('%s → 1M from the listed row, not a family guess', (id, label) => {
    expect(windowForModelId(id)).toBe(EXTENDED)
    expect(isFamilyGuess(id)).toBe(false)
    expect(friendlyModelName(id)).toBe(label)
  })

  it('keeps the date in the canonical id but drops it from the sticky key', () => {
    // Decision (b): the dated and undated ids are ONE model for latching.
    expect(parseModelId('claude-opus-5-5-20261101')?.canonicalId).toBe('claude-opus-5-5-20261101')
    expect(stickyModelKey('claude-opus-5-5-20261101')).toBe(stickyModelKey('claude-opus-5-5'))
  })

  it('a dated id of an UNLISTED newer model is still a guess (control)', () => {
    // Proves the assertion above can fail: the date does not make an id listed.
    expect(windowForModelId('claude-opus-5-6-20261101')).toBe(EXTENDED)
    expect(isFamilyGuess('claude-opus-5-6-20261101')).toBe(true)
  })
})
