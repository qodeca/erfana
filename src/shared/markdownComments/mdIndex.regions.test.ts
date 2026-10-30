// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Generated regions (design § 4.4, 024-FR-023): each START pairs with the
 * first END of its name after it, in one pass over a container's comments –
 * security audit of 8a4e442e, L1: a search per START was quadratic.
 *
 * The cost is pinned by counting name lookups, not by a clock: with 100,000
 * comment blocks the Markdown parse alone takes about 20 s, which would hide
 * the pairing's share.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexMarkdown } from './mdIndex'

const lookups = vi.hoisted(() => ({ count: 0 }))

vi.mock('./mdCommentScan', async importOriginal => {
  const actual = await importOriginal<typeof import('./mdCommentScan')>()
  return {
    ...actual,
    regionEndName: (data: string) => {
      lookups.count += 1
      return actual.regionEndName(data)
    },
    regionStartName: (data: string) => {
      lookups.count += 1
      return actual.regionStartName(data)
    }
  }
})

beforeEach(() => {
  lookups.count = 0
})

/** The regions of `text` as [START line, END line] pairs, 1-based. */
function regionLines(text: string): Array<[number, number]> {
  const index = indexMarkdown(text, 0)
  const lineOf = (offset: number): number => text.slice(0, offset).split('\n').length
  return index.regions.map(region => [lineOf(region.start), lineOf(region.end - 1)])
}

describe('generated regions pair in one pass', () => {
  it('pairs each START with the first END of its name after it; an unclosed START or a stray END makes none', () => {
    const text = [
      '<!-- END -->',
      '<!-- A:START -->',
      '<!-- START -->',
      '<!-- A:START -->',
      '<!-- B-END -->',
      '<!-- A:END -->',
      '<!-- END -->',
      '<!-- A:BEGIN -->',
      '<!-- A:END -->',
      '<!-- B:START -->',
      ''
    ].join('\n')
    expect(regionLines(text)).toEqual([
      [2, 6],
      [3, 7],
      [4, 6],
      [8, 9]
    ])
  })

  it('many STARTs and one END: every START pairs, with a bounded number of lookups per comment', () => {
    const count = 10_000
    const text = `${'<!-- START -->\n'.repeat(count)}<!-- END -->\n`
    const index = indexMarkdown(text, 0)
    expect(index.regions).toHaveLength(count)
    expect(index.regions.every(region => region.end === text.length - 1)).toBe(true)
    // The parse itself asks too (mdSlots, the comment scan); a search per START asked about 50 million times here.
    expect(lookups.count).toBeLessThan(10 * (count + 1))
  }, 60_000)
})
