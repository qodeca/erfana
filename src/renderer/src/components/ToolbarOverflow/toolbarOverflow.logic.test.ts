// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overflow computation (#451), held to the Toolbar overflow card's order:
 * the title keeps its reserve while buttons move one at a time (rightmost
 * first, raised buttons last), then the title goes, then the icon; … never
 * holds a single button that would fit in its place.
 */
import { describe, it, expect } from 'vitest'
import {
  computeOverflow,
  menuSeparatorsBefore,
  moveOrder,
  sameLayout,
  type OverflowInput,
  type OverflowItem
} from './toolbarOverflow.logic'

const BTN = 24
const GAP = 8

function items(ids: string[], raised: string[] = []): OverflowItem[] {
  return ids.map((id) => ({ id, width: BTN, moveLast: raised.includes(id) }))
}

/** The terminal header as it ships: padding 12, gaps 8, icon 16, title reserve 32. */
function terminal(available: number): OverflowInput {
  return {
    available,
    rowGap: GAP,
    itemGap: GAP,
    iconWidth: 16,
    titleReserve: 32,
    hasIcon: true,
    hasTitle: true,
    moreWidth: BTN,
    items: items(['screen', 'window', 'area', 'photo', 'bottom', 'restart', 'lock', 'maximize'], ['maximize'])
  }
}

/** Width of `n` buttons side by side. */
function run(n: number): number {
  return n * BTN + (n - 1) * GAP
}

/** Icon + title reserve + their gaps. */
const LEAD = 16 + GAP + 32 + GAP

describe('moveOrder', () => {
  it('moves the rightmost first and raised buttons after every other', () => {
    expect(moveOrder(items(['a', 'b', 'c', 'd'], ['b']))).toEqual(['d', 'c', 'a', 'b'])
  })

  it('keeps several raised buttons rightmost-first among themselves', () => {
    expect(moveOrder(items(['a', 'b', 'c'], ['a', 'c']))).toEqual(['b', 'c', 'a'])
  })

  it('is empty for an empty toolbar', () => {
    expect(moveOrder([])).toEqual([])
  })
})

describe('computeOverflow', () => {
  it('moves nothing when every button fits – no … button', () => {
    const layout = computeOverflow(terminal(LEAD + run(8)))
    expect(layout).toEqual({ moved: [], showTitle: true, showIcon: true })
  })

  it('treats an exact fit as a fit, and one pixel less as overflow', () => {
    expect(computeOverflow(terminal(LEAD + run(8))).moved).toEqual([])
    expect(computeOverflow(terminal(LEAD + run(8) - 1)).moved.length).toBeGreaterThan(0)
  })

  it('never trades one button for … of the same width: the first overflow moves two', () => {
    // 7 buttons + … is as wide as 8 buttons, so a 1-pixel shortfall moves 2.
    const layout = computeOverflow(terminal(LEAD + run(8) - 1))
    expect(layout.moved).toEqual(['restart', 'lock'])
  })

  it('moves rightmost first but keeps the raised Maximize to the end', () => {
    // Room for 3 buttons + …: maximize is raised, so screen, window and maximize stay.
    const layout = computeOverflow(terminal(LEAD + run(4)))
    expect(layout.moved).toEqual(['area', 'photo', 'bottom', 'restart', 'lock'])
    expect(layout.showTitle).toBe(true)
  })

  it('lists moved buttons in toolbar order, not in the order they moved', () => {
    const layout = computeOverflow(terminal(LEAD + run(2)))
    expect(layout.moved).toEqual(['screen', 'window', 'area', 'photo', 'bottom', 'restart', 'lock'])
  })

  it('keeps Maximize beside … at the dock minimum (170 px panel, 146 px content)', () => {
    const layout = computeOverflow(terminal(170 - 24))
    expect(layout.moved).not.toContain('maximize')
    expect(layout.moved).toHaveLength(7)
    expect(layout).toMatchObject({ showTitle: true, showIcon: true })
  })

  it('moves every button, then drops the title, then the icon', () => {
    // Everything moved, title reserve still there: … + lead.
    expect(computeOverflow(terminal(LEAD + BTN))).toMatchObject({ showTitle: true, showIcon: true })
    expect(computeOverflow(terminal(LEAD + BTN)).moved).toHaveLength(8)
    // No room for the title reserve: the title goes, the icon stays.
    expect(computeOverflow(terminal(16 + GAP + BTN))).toMatchObject({ showTitle: false, showIcon: true })
    // No room for the icon either: only … is left.
    const floor = computeOverflow(terminal(BTN))
    expect(floor).toEqual({ moved: expect.any(Array), showTitle: false, showIcon: false })
    expect(floor.moved).toHaveLength(8)
  })

  it('keeps … as the last thing standing, even at zero width', () => {
    const layout = computeOverflow(terminal(0))
    expect(layout.moved).toHaveLength(8)
    expect(layout).toMatchObject({ showTitle: false, showIcon: false })
  })

  it('never moves a one-button toolbar: the title and icon go instead', () => {
    const input: OverflowInput = { ...terminal(0), items: items(['filter']) }
    expect(computeOverflow({ ...input, available: LEAD + BTN }).moved).toEqual([])
    const narrow = computeOverflow({ ...input, available: 16 + GAP + BTN })
    expect(narrow).toEqual({ moved: [], showTitle: false, showIcon: true })
    expect(computeOverflow({ ...input, available: 10 })).toEqual({ moved: [], showTitle: false, showIcon: false })
  })

  it('moves a single button that is wider than … (it is worth a menu)', () => {
    const input: OverflowInput = {
      ...terminal(0),
      items: [
        { id: 'a', width: BTN },
        { id: 'wide', width: 60 }
      ],
      available: LEAD + BTN + GAP + BTN
    }
    expect(computeOverflow(input).moved).toEqual(['wide'])
  })

  it('handles an empty toolbar and a row with no icon or title', () => {
    expect(computeOverflow({ ...terminal(100), items: [] })).toEqual({ moved: [], showTitle: true, showIcon: true })
    const bare: OverflowInput = { ...terminal(run(2)), hasIcon: false, hasTitle: false, items: items(['a', 'b', 'c']) }
    expect(computeOverflow(bare).moved).toEqual(['b', 'c'])
  })

  it('uses the project row rhythm: New file raised, Change project leftmost', () => {
    const input: OverflowInput = {
      available: 170 - 16,
      rowGap: 0,
      itemGap: 4,
      iconWidth: 0,
      titleReserve: 32,
      hasIcon: false,
      hasTitle: true,
      moreWidth: BTN,
      items: items(['open', 'close', 'new-file', 'new-folder', 'import', 'refresh'], ['new-file'])
    }
    const layout = computeOverflow(input)
    expect(layout.moved).toEqual(['new-folder', 'import', 'refresh'])
  })
})

describe('sameLayout', () => {
  it('compares by content', () => {
    expect(sameLayout({ moved: ['a'], showTitle: true, showIcon: true }, { moved: ['a'], showTitle: true, showIcon: true })).toBe(true)
    expect(sameLayout({ moved: ['a'], showTitle: true, showIcon: true }, { moved: ['b'], showTitle: true, showIcon: true })).toBe(false)
    expect(sameLayout({ moved: [], showTitle: true, showIcon: true }, { moved: [], showTitle: false, showIcon: true })).toBe(false)
  })
})

/**
 * #461: the Markdown and Mermaid toolbars – no icon or title, pinned content
 * (comment tools, the live region) and a spacer that counts at its minimum.
 */
describe('pinned items and the spacer (#461)', () => {
  /** [a b] [pinned 40] [spacer, min 0] [c d e] – a bare toolbar row, gaps of 2. */
  function bar(available: number, spacerMin = 0): OverflowInput {
    return {
      available,
      rowGap: 0,
      itemGap: 2,
      iconWidth: 0,
      titleReserve: 0,
      hasIcon: false,
      hasTitle: false,
      moreWidth: BTN,
      items: [
        { id: 'a', width: BTN },
        { id: 'b', width: BTN },
        { id: 'tools', width: 40, pinned: true },
        { id: 'spacer', width: spacerMin, pinned: true },
        { id: 'c', width: BTN },
        { id: 'd', width: BTN },
        { id: 'e', width: BTN }
      ]
    }
  }

  /** Every item at its counted width, plus a gap between each pair (7 items, 6 gaps). */
  const ALL = 5 * BTN + 40 + 0 + 6 * 2

  it('leaves pinned items out of the move order', () => {
    expect(moveOrder(bar(0).items)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('counts a spacer at 0: everything fits at exactly the sum of the rest', () => {
    expect(computeOverflow(bar(ALL)).moved).toEqual([])
    expect(computeOverflow(bar(ALL - 1)).moved).not.toEqual([])
  })

  it('counts a spacer at its minimum width when it has one', () => {
    expect(computeOverflow(bar(ALL, 12)).moved).not.toEqual([])
    expect(computeOverflow(bar(ALL + 12, 12)).moved).toEqual([])
  })

  it('never moves a pinned item, even at the floor', () => {
    const layout = computeOverflow(bar(0))
    expect(layout.moved).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(layout.moved).not.toContain('tools')
    expect(layout.moved).not.toContain('spacer')
  })

  it('moves the rightmost buttons first, past the pinned content', () => {
    // Room for a, b, tools, spacer, … and one more button: c stays, d and e move.
    const keep = 3 * BTN + 40 + 0 + BTN + 5 * 2
    expect(computeOverflow(bar(keep)).moved).toEqual(['d', 'e'])
  })

  it('works with nothing but pinned items', () => {
    const input: OverflowInput = { ...bar(10), items: [{ id: 'status', width: 0, pinned: true }] }
    expect(computeOverflow(input).moved).toEqual([])
  })
})

describe('menuSeparatorsBefore (#461)', () => {
  /** The Markdown toolbar in the editor view, shortened: [b i] | [code link] | [find] ~ [modes] | [pdf docx]. */
  const entries = [
    { id: 'b' },
    { id: 'i' },
    { id: 'code', separatorBefore: true },
    { id: 'link' },
    { id: 'find', separatorBefore: true },
    { id: 'status' },
    { id: 'spacer', spacer: true },
    { id: 'editor' },
    { id: 'preview' },
    { id: 'pdf', separatorBefore: true },
    { id: 'docx' }
  ]

  it('separates moved buttons that came from different groups', () => {
    expect([...menuSeparatorsBefore(entries, ['find', 'editor', 'preview', 'pdf', 'docx'])]).toEqual([
      'editor',
      'pdf'
    ])
  })

  it('never puts a separator first: the first menu item never gets one', () => {
    expect([...menuSeparatorsBefore(entries, ['pdf', 'docx'])]).toEqual([])
    expect([...menuSeparatorsBefore(entries, ['code', 'link'])]).toEqual([])
  })

  it('never puts one last or doubles it when a whole group stays in the row', () => {
    // link and the export group moved, find and the modes stayed: one separator, before pdf.
    expect([...menuSeparatorsBefore(entries, ['link', 'pdf', 'docx'])]).toEqual(['pdf'])
  })

  it('treats a spacer as a group boundary', () => {
    expect([...menuSeparatorsBefore(entries, ['find', 'editor'])]).toEqual(['editor'])
  })

  it('returns nothing for an empty menu or a single group', () => {
    expect(menuSeparatorsBefore(entries, []).size).toBe(0)
    expect(menuSeparatorsBefore(entries, ['b', 'i']).size).toBe(0)
  })
})

describe('terminal header at the default 300 px width (#462)', () => {
  /** The owner's order: Maximize after the captures, then the three that hide first. */
  const OWNER_ORDER = ['screen', 'window', 'area', 'photo', 'maximize', 'lock', 'restart', 'bottom']
  const atDefault = (ids: string[]): OverflowInput => ({ ...terminal(300 - 2 * 12), items: items(ids, ['maximize']) })

  it('moves only Scroll lock, Restart and Scroll to bottom; the captures and Maximize stay', () => {
    expect(computeOverflow(atDefault(OWNER_ORDER)).moved).toEqual(['lock', 'restart', 'bottom'])
  })

  it('Linux, with no screen capture: all five buttons fit, so nothing moves', () => {
    expect(computeOverflow(atDefault(['photo', 'maximize', 'lock', 'restart', 'bottom'])).moved).toEqual([])
  })

  it('narrower than the default, the captures move only after the three hide-first buttons', () => {
    const order = moveOrder(items(OWNER_ORDER, ['maximize']))
    expect(order.slice(0, 3)).toEqual(['bottom', 'restart', 'lock'])
    expect(order.at(-1)).toBe('maximize')
  })
})
