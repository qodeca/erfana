// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import {
  NAV_FOLD_STEPS,
  UNFOLD_SLACK_PX,
  foldedNavItems,
  isFolded,
  navFoldAttribute,
  navFoldCount,
  parseFoldStep,
  type FoldedNavInput
} from './navFold.logic'

/** The room each step gives back: steps 3 and 4 two tools, 5 the margins, 6 a badge word, 7 one tool. */
const FREED = { 3: 72, 4: 72, 5: 8, 6: 59, 7: 36 } as const

describe('navFoldCount (design § States › Tiers, steps 3–7)', () => {
  it('takes no step while the origin fits, at the edge included', () => {
    expect(navFoldCount({ room: 300, needed: 156, freed: FREED, current: 0 })).toBe(0)
    expect(navFoldCount({ room: 156, needed: 156, freed: FREED, current: 0 })).toBe(0)
  })

  it('takes the fewest steps, in order, that give the origin its room', () => {
    expect(navFoldCount({ room: 100, needed: 156, freed: FREED, current: 0 })).toBe(1)
    expect(navFoldCount({ room: 49, needed: 156, freed: FREED, current: 0 })).toBe(2)
    // 10 + 72 + 72 + 8 = 162: the margins are the third step.
    expect(navFoldCount({ room: 10, needed: 156, freed: FREED, current: 0 })).toBe(3)
    expect(navFoldCount({ room: 0, needed: 156, freed: FREED, current: 0 })).toBe(4)
    // A field squeezed past shut: -80 + 72 + 72 + 8 + 59 = 131, so Back goes too.
    expect(navFoldCount({ room: -80, needed: 156, freed: FREED, current: 0 })).toBe(5)
  })

  it('takes every step when the origin never fits (the formatter then cuts the domain, step 8)', () => {
    expect(navFoldCount({ room: -1000, needed: 156, freed: FREED, current: 0 })).toBe(NAV_FOLD_STEPS.length)
  })

  it('takes no step without a web origin to fit, or before layout', () => {
    expect(navFoldCount({ room: 0, needed: 0, freed: FREED, current: 3 })).toBe(0)
    expect(navFoldCount({ room: Number.NaN, needed: 156, freed: FREED, current: 2 })).toBe(0)
  })

  it('gives steps back only with a pixel to spare, so a width on an edge settles', () => {
    // 84 + 72 = 156: step 3 alone fits exactly, but giving step 4 back needs the slack.
    expect(navFoldCount({ room: 84, needed: 156, freed: FREED, current: 2 })).toBe(2)
    expect(navFoldCount({ room: 84 + UNFOLD_SLACK_PX, needed: 156, freed: FREED, current: 2 })).toBe(1)
    expect(navFoldCount({ room: 400, needed: 156, freed: FREED, current: 5 })).toBe(0)
  })

  it('folds further at once when the room shrinks', () => {
    expect(navFoldCount({ room: 0, needed: 156, freed: FREED, current: 1 })).toBe(4)
  })
})

describe('fold attribute and steps', () => {
  it('lists the taken steps for the row', () => {
    expect(navFoldAttribute(0)).toBeUndefined()
    expect(navFoldAttribute(1)).toBe('3')
    expect(navFoldAttribute(5)).toBe('3 4 5 6 7')
  })

  it('knows which steps are taken', () => {
    expect(isFolded(3, 0)).toBe(false)
    expect(isFolded(3, 1)).toBe(true)
    expect(isFolded(7, 4)).toBe(false)
    expect(isFolded(7, 5)).toBe(true)
  })

  it('reads a data-fold-step value', () => {
    expect(parseFoldStep('3')).toBe(3)
    expect(parseFoldStep('7')).toBe(7)
    expect(parseFoldStep('8')).toBeNull()
    expect(parseFoldStep(null)).toBeNull()
    expect(parseFoldStep(undefined)).toBeNull()
  })
})

describe('foldedNavItems', () => {
  const input = (patch: Partial<FoldedNavInput> = {}): FoldedNavInput => ({
    count: 0,
    canGoBack: true,
    canGoForward: true,
    loading: false,
    keys: { back: '⌘[', forward: '⌘]', reload: '⌘R' },
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
    ...patch
  })

  it('adds nothing while the navigation tools are on the row (step 3 tools are in More already)', () => {
    expect(foldedNavItems(input({ count: 0 }))).toEqual([])
    expect(foldedNavItems(input({ count: 1 }))).toEqual([])
  })

  it('lists Forward and Reload from step 4, and Back first from step 7', () => {
    expect(foldedNavItems(input({ count: 2 })).map(item => item.label)).toEqual(['Forward', 'Reload'])
    expect(foldedNavItems(input({ count: 4 })).map(item => item.label)).toEqual(['Forward', 'Reload'])
    const all = foldedNavItems(input({ count: 5 }))
    expect(all.map(item => item.label)).toEqual(['Back', 'Forward', 'Reload'])
    expect(all.map(item => item.shortcut)).toEqual(['⌘[', '⌘]', '⌘R'])
  })

  it('gives Stop loading while a page loads, and runs each action', () => {
    const actions = input({ count: 5, loading: true })
    const items = foldedNavItems(actions)
    expect(items.map(item => item.label)).toEqual(['Back', 'Forward', 'Stop loading'])
    items.forEach(item => item.action())
    expect(actions.onBack).toHaveBeenCalledOnce()
    expect(actions.onForward).toHaveBeenCalledOnce()
    expect(actions.onStop).toHaveBeenCalledOnce()
    expect(actions.onReload).not.toHaveBeenCalled()
  })

  it('disables Back and Forward with no history, with the reason', () => {
    const items = foldedNavItems(input({ count: 5, canGoBack: false, canGoForward: false }))
    expect(items[0]).toMatchObject({ label: 'Back', disabled: true, reason: 'No earlier page' })
    expect(items[1]).toMatchObject({ label: 'Forward', disabled: true, reason: 'No later page' })
    expect(items[2].disabled).toBeUndefined()
  })
})
