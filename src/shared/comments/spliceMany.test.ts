// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import type { KindDocument } from './fileKind'
import { composePlans, verifyPlans } from './spliceMany'
import type { SplicePlan } from './splice'

const replace = (start: number, end: number, insert: string): SplicePlan => ({ op: 'replace', start, end, insert })
const remove = (start: number, end: number): SplicePlan => ({ op: 'delete', start, end, insert: '' })

/** A parse that only counts: `blocks` blocks, each at the offset listed, with `data`. */
function parsed(blocks: readonly { start: number; data?: unknown }[], comments = blocks.length): KindDocument {
  return {
    state: { blocks: blocks.map(b => ({ kind: 'ok', nodeRange: [b.start, b.start + 1], data: b.data })) },
    index: { comments: Array.from({ length: comments }) }
  } as unknown as KindDocument
}

describe('composePlans', () => {
  it('turns plans in any order into one range holding the text between them', () => {
    const composed = composePlans('aXbYc', [replace(3, 4, 'yy'), replace(1, 2, 'xx')])
    expect(composed).toEqual({ ok: true, plans: [replace(1, 2, 'xx'), replace(3, 4, 'yy')], plan: { op: 'replace', start: 1, end: 4, insert: 'xxbyy' } })
  })

  it('one plan is that plan', () => {
    const composed = composePlans('aXb', [remove(1, 2)])
    expect(composed.ok && composed.plan).toEqual({ op: 'replace', start: 1, end: 2, insert: '' })
  })

  it('refuses no plans at all, and overlapping ranges', () => {
    expect(composePlans('abc', []).ok).toBe(false)
    expect(composePlans('abcd', [replace(0, 2, 'x'), replace(1, 3, 'y')]).ok).toBe(false)
  })

  it('takes plans that touch', () => {
    expect(composePlans('abcd', [remove(0, 2), remove(2, 4)]).ok).toBe(true)
  })
})

describe('verifyPlans', () => {
  const origin = { text: 'aXbYc', blockCount: 2, commentCount: 2 }
  const data = { id: 'one' } as unknown as SplicePlan['data']
  const plans = [{ ...replace(1, 2, 'xx'), data }, replace(3, 4, 'yy')]
  const composedOf = (list: readonly SplicePlan[]) => {
    const composed = composePlans(origin.text, list)
    if (!composed.ok) throw new Error('no plan')
    return composed
  }
  const kind = (doc: KindDocument) => ({ parse: vi.fn(() => doc), verify: vi.fn(() => ({ ok: true }) as const) })

  it('passes the file the plans make, and checks the kind once on the composed range', () => {
    const check = kind(parsed([{ start: 1, data }, { start: 4 }]))
    const composed = composedOf(plans)
    expect(verifyPlans(origin, 'axxbyyc', composed, check).ok).toBe(true)
    expect(check.parse).toHaveBeenCalledTimes(1)
    expect(check.verify).toHaveBeenCalledTimes(1)
    expect(check.verify.mock.calls[0]).toContainEqual(composed.plan)
  })

  it('finds a later written block at its shifted place', () => {
    const later = [replace(1, 2, 'xxx'), { ...replace(3, 4, 'y'), data }]
    expect(verifyPlans(origin, 'axxxbyc', composedOf(later), kind(parsed([{ start: 1 }, { start: 5, data }]))).ok).toBe(true)
  })

  it('refuses a text that is not the plans applied', () => {
    expect(verifyPlans(origin, 'axxbyyZ', composedOf(plans), kind(parsed([]))).ok).toBe(false)
  })

  it('refuses a block count that is not the deletes taken away', () => {
    const removed = [remove(1, 2), remove(3, 4)]
    expect(verifyPlans(origin, 'abc', composedOf(removed), kind(parsed([{ start: 0 }], 0)))).toEqual({ ok: false, reason: 'block-count' })
    expect(verifyPlans(origin, 'abc', composedOf(removed), kind(parsed([], 1)))).toEqual({ ok: false, reason: 'comment-count' })
    expect(verifyPlans(origin, 'abc', composedOf(removed), kind(parsed([], 0))).ok).toBe(true)
  })

  it('refuses when the kind refuses, and a written block that reads back otherwise', () => {
    const refusing = { parse: () => parsed([{ start: 1, data }, { start: 4 }]), verify: () => ({ ok: false, reason: 'render-changed' }) as const }
    expect(verifyPlans(origin, 'axxbyyc', composedOf(plans), refusing)).toEqual({ ok: false, reason: 'render-changed' })
    expect(verifyPlans(origin, 'axxbyyc', composedOf(plans), kind(parsed([{ start: 1, data: { id: 'other' } }, { start: 4 }])))).toEqual({ ok: false, reason: 'block-data' })
  })
})
