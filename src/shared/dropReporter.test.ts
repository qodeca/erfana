// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the bounds drop reporter (issue #124, P1-AC1).
 *
 * The reporter is what turns "a page covered the tree and nobody knows why"
 * into a log line naming the step that dropped the update. These pin both
 * halves of that job: nothing is lost (the first drop of every reason is
 * written, and a later line says how many were swallowed), and nothing floods
 * (repeats are capped per window, reasons per scope).
 *
 * @see dropReporter.ts
 */
import { describe, expect, it } from 'vitest'

import {
  BOUNDS_DROP_MESSAGE,
  createDropReporter,
  type BoundsDrop,
  type DropLogEntry,
  type DropSource
} from './dropReporter'
import { PREVIEW_LIMITS } from './preview-limits'
import { stablePathDigest } from './stablePathDigest'

const WINDOW_MS = 1_000

/** A reporter on a hand-driven clock, collecting what it emits. */
function setup(options: { source?: DropSource; windowMs?: number } = {}): {
  report: (drop: BoundsDrop) => void
  lines: DropLogEntry[]
  advance: (ms: number) => void
} {
  let clock = 0
  const lines: DropLogEntry[] = []
  const reporter = createDropReporter({
    source: options.source ?? 'renderer',
    now: () => clock,
    windowMs: options.windowMs,
    emit: (line) => {
      lines.push(line)
    }
  })
  return {
    report: (drop) => reporter.report(drop),
    lines,
    advance: (ms) => {
      clock += ms
    }
  }
}

const STALE: BoundsDrop = {
  reason: 'stale-seq',
  level: 'warn',
  panelId: 'preview-a',
  seq: 3,
  lastSeq: 7
}

/** `count` distinct reasons, numbered from `from`. */
function reasons(count: number, from = 0): string[] {
  return Array.from({ length: count }, (_, i) => `reason-${from + i}`)
}

describe('createDropReporter – the first drop of each reason', () => {
  it('is written at once, with its fields as context and the rect rounded', () => {
    const { report, lines } = setup()
    report({ ...STALE, rect: { x: 10.4, y: 20.6, width: 300.5, height: 199.49 } })
    expect(lines).toEqual([
      {
        level: 'warn',
        message: BOUNDS_DROP_MESSAGE,
        context: {
          source: 'renderer',
          reason: 'stale-seq',
          panelId: stablePathDigest('preview-a'),
          seq: 3,
          lastSeq: 7,
          rect: { x: 10, y: 21, w: 301, h: 199 }
        }
      }
    ])
  })

  it('is written for every reason on its own, even inside one window', () => {
    const { report, lines } = setup({ windowMs: WINDOW_MS })
    report({ reason: 'no-placeholder', level: 'info' })
    report({ reason: 'degenerate-rect', level: 'info' })
    report(STALE)
    expect(lines.map((line) => line.context.reason)).toEqual([
      'no-placeholder',
      'degenerate-rect',
      'stale-seq'
    ])
  })

  it("keeps the drop point's level", () => {
    const { report, lines } = setup()
    report({ reason: 'a', level: 'info' })
    report({ reason: 'b', level: 'warn' })
    report({ reason: 'c', level: 'error' })
    expect(lines.map((line) => line.level)).toEqual(['info', 'warn', 'error'])
  })

  it('carries only the fields it was given, and never puts them in the message', () => {
    const { report, lines } = setup({ source: 'main' })
    report({ reason: 'view-defunct', level: 'info' })
    expect(lines).toEqual([
      {
        level: 'info',
        message: BOUNDS_DROP_MESSAGE,
        context: { source: 'main', reason: 'view-defunct' }
      }
    ])
  })
})

describe('createDropReporter – repeats inside the window', () => {
  it('are swallowed, and the next line says how many', () => {
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    report(STALE)
    for (let i = 0; i < 4; i += 1) {
      advance(100)
      report(STALE)
    }
    expect(lines).toHaveLength(1)

    advance(WINDOW_MS)
    report({ ...STALE, seq: 9 })
    expect(lines).toHaveLength(2)
    expect(lines[1].context).toMatchObject({ reason: 'stale-seq', seq: 9, suppressed: 4 })
  })

  it('start counting again after each line', () => {
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    report(STALE)
    report(STALE)
    advance(WINDOW_MS)
    report(STALE)
    report(STALE)
    report(STALE)
    advance(WINDOW_MS)
    report(STALE)
    expect(lines.map((line) => line.context.suppressed)).toEqual([undefined, 1, 2])
  })

  it('leave `suppressed` out when nothing was swallowed', () => {
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    report(STALE)
    advance(WINDOW_MS)
    report(STALE)
    expect(lines).toHaveLength(2)
    expect(lines[1].context).not.toHaveProperty('suppressed')
  })

  it('are counted per reason, not across reasons', () => {
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    const clamp: BoundsDrop = { reason: 'empty-clamp', level: 'warn' }
    report(STALE)
    report(clamp)
    report(STALE)
    report(STALE)
    report(clamp)
    advance(WINDOW_MS)
    report(STALE)
    report(clamp)
    expect(lines.slice(2).map((line) => [line.context.reason, line.context.suppressed])).toEqual([
      ['stale-seq', 2],
      ['empty-clamp', 1]
    ])
  })

  it('use the shared five-second window by default', () => {
    expect(PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS).toBe(5_000)
    const { report, lines, advance } = setup()
    report(STALE)
    advance(PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS - 1)
    report(STALE)
    expect(lines).toHaveLength(1)
    advance(1)
    report(STALE)
    expect(lines).toHaveLength(2)
    expect(lines[1].context.suppressed).toBe(1)
  })
})

describe('createDropReporter – at most 16 reasons per scope', () => {
  it('gives each of the first 16 reasons a slot of its own', () => {
    expect(PREVIEW_LIMITS.BOUNDS_DROP_MAX_REASONS).toBe(16)
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    for (const reason of reasons(16)) {
      report({ reason, level: 'info' })
    }
    expect(lines).toHaveLength(16)

    // Each one still rate-limits on its own.
    for (const reason of reasons(16)) {
      report({ reason, level: 'info' })
    }
    expect(lines).toHaveLength(16)
    advance(WINDOW_MS)
    for (const reason of reasons(16)) {
      report({ reason, level: 'info' })
    }
    expect(lines).toHaveLength(32)
    expect(lines.slice(16).map((line) => line.context.suppressed)).toEqual(Array(16).fill(1))
  })

  it('makes every further reason share one rate-capped slot', () => {
    const { report, lines, advance } = setup({ windowMs: WINDOW_MS })
    for (const reason of reasons(16)) {
      report({ reason, level: 'info' })
    }

    // The 17th reason is still written, so nothing is lost silently…
    report({ reason: 'reason-16', level: 'warn' })
    expect(lines).toHaveLength(17)
    expect(lines[16].context.reason).toBe('reason-16')

    // …but 50 more new reasons inside the window write nothing more.
    for (const reason of reasons(50, 17)) {
      report({ reason, level: 'warn' })
    }
    expect(lines).toHaveLength(17)

    // After the window the shared slot writes once, with its count.
    advance(WINDOW_MS)
    report({ reason: 'reason-99', level: 'warn' })
    expect(lines).toHaveLength(18)
    expect(lines[17].context).toMatchObject({ reason: 'reason-99', suppressed: 50 })
  })
})
