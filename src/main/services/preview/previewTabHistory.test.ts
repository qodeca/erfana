// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A preview tab's own Back and Forward list (issue #124, part 3 §3.5).
 *
 * Pins the browser-like list rules, the cap, the generation that grows on
 * every change, and `dropNeighbour`: a Back or Forward onto a page that is gone
 * removes that entry, and the next step goes one further (RU2-3).
 *
 * @see previewTabHistory.ts
 */
import { describe, expect, it } from 'vitest'

import type { PreviewPageTarget } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  canStep,
  createTabHistory,
  currentEntry,
  dropNeighbour,
  historyState,
  neighbourEntry,
  pushEntry,
  replaceCurrent,
  stepHistory,
  type PreviewTabHistory
} from './previewTabHistory'

const ROOT = '/projects/site'

/** A page of the test project, at its top or at `anchor`. */
function page(name: string, anchor: string | null = null): PreviewPageTarget {
  return { filePath: `${ROOT}/${name}.html`, anchor }
}

/** A history made by opening each page in turn; it shows the last one. */
function opened(first: string, ...rest: string[]): PreviewTabHistory {
  return rest.reduce((history, name) => pushEntry(history, page(name)), createTabHistory(page(first)))
}

/** The entries as short names (`a`, `a#intro`), for readable assertions. */
function names(history: PreviewTabHistory): string[] {
  return history.entries.map((entry) => {
    const name = entry.filePath.slice(ROOT.length + 1, -'.html'.length)
    return entry.anchor === null ? name : `${name}#${entry.anchor}`
  })
}

describe('createTabHistory', () => {
  it('starts on one entry, with nowhere to go, at generation 0', () => {
    const history = createTabHistory(page('a'))

    expect(names(history)).toEqual(['a'])
    expect(history.index).toBe(0)
    expect(history.generation).toBe(0)
    expect(currentEntry(history)).toEqual(page('a'))
    expect(canStep(history, 'back')).toBe(false)
    expect(canStep(history, 'forward')).toBe(false)
  })

  it('starts the count where the caller says, so a new list cannot match an old request', () => {
    expect(createTabHistory(page('a'), 7).generation).toBe(7)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses %s as a starting generation',
    (generation) => {
      expect(() => createTabHistory(page('a'), generation)).toThrow(RangeError)
    }
  )

  it('keeps no reference to the caller’s object and cannot be changed', () => {
    const first = page('a')
    const history = createTabHistory(first)
    first.filePath = `${ROOT}/elsewhere.html`

    expect(currentEntry(history)).toEqual(page('a'))
    expect(Object.isFrozen(history)).toBe(true)
    expect(Object.isFrozen(history.entries)).toBe(true)
    expect(Object.isFrozen(history.entries[0])).toBe(true)
  })
})

describe('pushEntry', () => {
  it('adds the page after the current one and moves to it', () => {
    const history = opened('a', 'b')

    expect(names(history)).toEqual(['a', 'b'])
    expect(history.index).toBe(1)
    expect(history.generation).toBe(1)
  })

  it('drops the entries ahead of the current one, as a browser does', () => {
    const onA = stepHistory(stepHistory(opened('a', 'b', 'c'), 'back'), 'back')

    const history = pushEntry(onA, page('d'))

    expect(names(history)).toEqual(['a', 'd'])
    expect(history.index).toBe(1)
    expect(canStep(history, 'forward')).toBe(false)
  })

  it('records an in-page #section jump as an entry of its own', () => {
    const history = pushEntry(opened('a'), page('a', 'intro'))

    expect(names(history)).toEqual(['a', 'a#intro'])
    expect(neighbourEntry(history, 'back')).toEqual(page('a'))
  })

  it('does not record the entry on screen a second time', () => {
    const history = opened('a', 'b')

    expect(pushEntry(history, page('b'))).toBe(history)
  })

  it('keeps the entries ahead when the push changes nothing', () => {
    const onA = stepHistory(opened('a', 'b'), 'back')

    const history = pushEntry(onA, page('a'))

    expect(history).toBe(onA)
    expect(neighbourEntry(history, 'forward')).toEqual(page('b'))
  })

  it(`holds at most ${PREVIEW_LIMITS.MAX_HISTORY_ENTRIES} entries, dropping the oldest`, () => {
    const extra = 10
    const pages = Array.from(
      { length: PREVIEW_LIMITS.MAX_HISTORY_ENTRIES + extra },
      (_, at) => `p${at}`
    )

    const history = opened(pages[0], ...pages.slice(1))

    expect(history.entries).toHaveLength(PREVIEW_LIMITS.MAX_HISTORY_ENTRIES)
    expect(history.index).toBe(PREVIEW_LIMITS.MAX_HISTORY_ENTRIES - 1)
    expect(names(history)[0]).toBe(`p${extra}`)
    expect(currentEntry(history)).toEqual(page(pages[pages.length - 1]))
    expect(history.generation).toBe(pages.length - 1)
  })

  it('never changes the history it was given', () => {
    const before = opened('a', 'b')
    const snapshot = JSON.stringify(before)

    pushEntry(before, page('c'))

    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('replaceCurrent', () => {
  it('swaps the current entry and keeps the rest and the position', () => {
    const onB = stepHistory(opened('a', 'b', 'c'), 'back')

    const history = replaceCurrent(onB, page('x'))

    expect(names(history)).toEqual(['a', 'x', 'c'])
    expect(history.index).toBe(1)
    expect(history.generation).toBe(onB.generation + 1)
    expect(names(onB)).toEqual(['a', 'b', 'c'])
  })

  it('changes nothing for the entry already there', () => {
    const history = opened('a', 'b')

    expect(replaceCurrent(history, page('b'))).toBe(history)
  })
})

describe('stepHistory', () => {
  it('moves one entry back, then forward, without touching the entries', () => {
    const onC = opened('a', 'b', 'c')

    const onB = stepHistory(onC, 'back')
    expect(currentEntry(onB)).toEqual(page('b'))
    expect(onB.generation).toBe(onC.generation + 1)
    expect(onB.entries).toEqual(onC.entries)

    const backOnC = stepHistory(onB, 'forward')
    expect(currentEntry(backOnC)).toEqual(page('c'))
    expect(backOnC.generation).toBe(onB.generation + 1)
  })

  it('changes nothing at the start going back', () => {
    const history = createTabHistory(page('a'))
    expect(stepHistory(history, 'back')).toBe(history)
  })

  it('changes nothing at the end going forward', () => {
    const history = opened('a', 'b')
    expect(stepHistory(history, 'forward')).toBe(history)
  })
})

describe('dropNeighbour', () => {
  it('[X, B-missing, A]: Back drops B, and the next Back reaches X', () => {
    const onA = opened('x', 'b', 'a')

    const dropped = dropNeighbour(onA, 'back')

    expect(names(dropped)).toEqual(['x', 'a'])
    expect(currentEntry(dropped)).toEqual(page('a'))
    expect(neighbourEntry(dropped, 'back')).toEqual(page('x'))
    expect(dropped.generation).toBe(onA.generation + 1)
    expect(currentEntry(stepHistory(dropped, 'back'))).toEqual(page('x'))
  })

  it('Forward drops the entry ahead, stays put, and the next Forward goes one further', () => {
    const onA = stepHistory(stepHistory(opened('a', 'b', 'c'), 'back'), 'back')

    const dropped = dropNeighbour(onA, 'forward')

    expect(names(dropped)).toEqual(['a', 'c'])
    expect(dropped.index).toBe(0)
    expect(neighbourEntry(dropped, 'forward')).toEqual(page('c'))
    expect(dropped.generation).toBe(onA.generation + 1)
  })

  it('changes nothing with no entry behind', () => {
    const history = createTabHistory(page('a'))
    expect(dropNeighbour(history, 'back')).toBe(history)
  })

  it('changes nothing with no entry ahead', () => {
    const history = opened('a', 'b')
    expect(dropNeighbour(history, 'forward')).toBe(history)
  })
})

describe('historyState', () => {
  it('names both neighbours and the generation', () => {
    const onB = stepHistory(opened('a', 'b', 'c'), 'back')

    expect(historyState(onB)).toEqual({
      canGoBack: true,
      canGoForward: true,
      backTarget: page('a'),
      forwardTarget: page('c'),
      generation: 3
    })
  })

  it('offers no step on a one-entry history', () => {
    expect(historyState(createTabHistory(page('a')))).toEqual({
      canGoBack: false,
      canGoForward: false,
      backTarget: null,
      forwardTarget: null,
      generation: 0
    })
  })

  it('hands out copies, never the stored entries', () => {
    const history = opened('a', 'b')

    const state = historyState(history)

    expect(state.backTarget).not.toBe(history.entries[0])
    expect(Object.isFrozen(state.backTarget)).toBe(false)
  })
})

describe('generation', () => {
  it('grows by exactly one on every change and stays put on every no-op', () => {
    let history = createTabHistory(page('a'))
    const steps: Array<(h: PreviewTabHistory) => PreviewTabHistory> = [
      (h) => pushEntry(h, page('b')),
      (h) => pushEntry(h, page('b')),
      (h) => stepHistory(h, 'back'),
      (h) => stepHistory(h, 'back'),
      (h) => replaceCurrent(h, page('a', 'top')),
      (h) => dropNeighbour(h, 'forward'),
      (h) => dropNeighbour(h, 'forward')
    ]
    const generations = steps.map((step) => {
      history = step(history)
      return history.generation
    })

    expect(generations).toEqual([1, 1, 2, 2, 3, 4, 4])
  })
})
