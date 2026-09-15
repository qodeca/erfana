// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page navigator (issue #124, WI-17b; part 3 §3.5): the first page, a
 * same-tab move, and Back and Forward, over the real `previewLivePage` fed by
 * fake Electron event sequences. How an intent ends and the in-page steps are
 * in `previewPageNavigator.intent.test.ts`; the shared harness is in
 * `__test-helpers__/previewPageNavigatorHarness.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  A,
  B,
  C,
  at,
  makeHarness,
  nativeOf,
  onB,
  urlFor
} from './__test-helpers__/previewPageNavigatorHarness'
import { nativeHistoryOf } from './previewPageNavigator'
import { createTabHistory, pushEntry, stepHistory } from './previewTabHistory'

describe('previewPageNavigator — the first page', () => {
  it("writes the view's first history into the panel store at once", () => {
    const h = makeHarness()

    expect(h.store.set).toHaveBeenCalledTimes(1)
    expect(h.history()?.entries).toEqual([at(A)])
  })

  it('writes nothing when the store already holds that history (a resume)', () => {
    const survived = onB()
    const h = makeHarness({ initialHistory: survived, stored: survived })

    expect(h.store.set).not.toHaveBeenCalled()
  })

  it('loads the first entry at its anchor and names it at the commit, with the history state', () => {
    const survived = pushEntry(createTabHistory(at(A)), at(B, 'pricing'))
    const h = makeHarness({
      initialHistory: survived,
      stored: survived,
      initialSameDocument: false
    })

    void h.navigator.loadFirst(B)
    expect(h.loadUrl).toHaveBeenCalledWith(`${urlFor(B)}#pricing`)
    expect(h.onMoveStarted).not.toHaveBeenCalled()
    expect(h.navigator.isNavigationPending()).toBe(false)
    h.fire.didNavigate(`${urlFor(B)}#pricing`)

    expect(h.emitPageChanged.mock.calls).toEqual([
      [
        {
          filePath: B,
          anchor: 'pricing',
          sameDocument: false,
          failed: false,
          canGoBack: true,
          canGoForward: false,
          backTarget: at(A),
          forwardTarget: null,
          generation: survived.generation
        }
      ]
    ])
    expect(h.store.set).not.toHaveBeenCalled()
  })

  it('names a first page that commits with its 404 as failed (S15)', () => {
    const h = makeHarness()

    void h.navigator.loadFirst(A)
    h.fire.didNavigate(urlFor(A), 404)

    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: A, sameDocument: true, failed: true, generation: 0 })
    )
  })
})

describe('previewPageNavigator — a same-tab move', () => {
  it('loads the target at its anchor, pauses the pipeline and stays pending until the commit', () => {
    const h = makeHarness()

    void h.navigator.move({ kind: 'open', target: at(B, 'plans'), realPath: B })

    expect(h.loadUrl).toHaveBeenCalledWith(`${urlFor(B)}#plans`)
    expect(h.onMoveStarted).toHaveBeenCalledTimes(1)
    expect(h.navigator.isNavigationPending()).toBe(true)
    expect(h.emitPageChanged).not.toHaveBeenCalled()
  })

  it('pushes the entry at the commit and names it, with Back to the page it left', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })

    h.fire.didNavigate(urlFor(B))

    expect(h.history()?.entries).toEqual([at(A), at(B)])
    expect(h.emitPageChanged).toHaveBeenCalledWith({
      filePath: B,
      anchor: null,
      sameDocument: false,
      failed: false,
      canGoBack: true,
      canGoForward: false,
      backTarget: at(A),
      forwardTarget: null,
      generation: 1
    })
    expect(h.navigator.isNavigationPending()).toBe(false)
  })

  it('an anchor step on the page on screen is same-document', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(A, 'faq'), realPath: A })

    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.history()?.entries).toEqual([at(A), at(A, 'faq')])
    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: A, anchor: 'faq', sameDocument: true })
    )
  })

  it('a load of the file on screen that commits keeps its page scope, so it is same-document too', () => {
    const onFaq = pushEntry(createTabHistory(at(A)), at(A, 'faq'))
    const h = makeHarness({ initialHistory: onFaq, stored: onFaq })
    void h.navigator.move({ kind: 'open', target: at(A), realPath: A })

    h.fire.didNavigate(urlFor(A))

    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: A, anchor: null, sameDocument: true })
    )
  })

  it('names a move that commits with its 404 as failed (S15)', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })

    h.fire.didNavigate(urlFor(B), 404)

    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: B, failed: true, sameDocument: false })
    )
    expect(h.history()?.entries).toEqual([at(A), at(B)])
  })
})

describe('previewPageNavigator — Back and Forward', () => {
  it('steps natively when the neighbouring Chromium entry is exactly the target (S6)', () => {
    const basis = onB()
    const native = nativeOf([urlFor(A), urlFor(B)])
    const h = makeHarness({ initialHistory: basis, stored: basis, native })

    void h.navigator.move({ kind: 'back', target: at(A), realPath: A, basis })
    expect(native.goToIndex.mock.calls).toEqual([[0]])
    expect(h.loadUrl).not.toHaveBeenCalled()
    h.fire.didNavigate(urlFor(A))

    expect(h.history()?.index).toBe(0)
    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: A,
        canGoBack: false,
        canGoForward: true,
        forwardTarget: at(B),
        generation: basis.generation + 1
      })
    )
  })

  it('steps forward natively too', () => {
    const basis = stepHistory(onB(), 'back')
    const native = nativeOf([urlFor(A), urlFor(B)], 0)
    const h = makeHarness({ initialHistory: basis, stored: basis, native })

    void h.navigator.move({ kind: 'forward', target: at(B), realPath: B, basis })
    h.fire.didNavigate(urlFor(B))

    expect(native.goToIndex.mock.calls).toEqual([[1]])
    expect(h.history()?.index).toBe(1)
  })

  it("steps onto the page a script pushState'd from by its index, which goBack() skips", () => {
    // Chromium's history intervention marks the entry a page pushState'd from
    // without a user gesture; goBack() skips a marked entry and, with nothing
    // behind it, does nothing at all – no event, and the step pending for good.
    const pushed = pushEntry(createTabHistory(at(A)), at(A, 'pushed'))
    const native = { ...nativeOf([urlFor(A), `${urlFor(A)}#pushed`]), goBack: vi.fn<() => void>() }
    const h = makeHarness({ initialHistory: pushed, stored: pushed, native })

    void h.navigator.move({ kind: 'back', target: at(A), realPath: A, basis: pushed })
    expect(native.goToIndex).toHaveBeenCalledWith(0)
    expect(native.goBack).not.toHaveBeenCalled()
    h.fire.inPage(urlFor(A))

    expect(h.history()?.index).toBe(0)
    expect(h.navigator.isNavigationPending()).toBe(false)
  })

  it.each([
    ['a frame entry sits in between', nativeOf([urlFor(A), `${urlFor(B)}?frame`, urlFor(B)])],
    ['the view slept and has no entry behind', nativeOf([urlFor(B)])],
    [
      'the native history throws',
      {
        ...nativeOf([urlFor(A), urlFor(B)]),
        getActiveIndex: () => {
          throw new Error('destroyed')
        }
      }
    ]
  ])('loads the target by URL when %s', (_label, native) => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis, native })

    void h.navigator.move({ kind: 'back', target: at(A), realPath: A, basis })

    expect(h.loadUrl).toHaveBeenCalledWith(urlFor(A))
    expect(native.goToIndex).not.toHaveBeenCalled()
  })

  it('loads by URL when the view has no native history', () => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis })

    void h.navigator.move({ kind: 'back', target: at(A, 'top'), realPath: A, basis })

    expect(h.loadUrl).toHaveBeenCalledWith(`${urlFor(A)}#top`)
  })

  it('gives the entry it steps onto the spelling the gate named it with', () => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis })
    const gated = at('/proj/./a.html')

    void h.navigator.move({ kind: 'back', target: gated, realPath: A, basis })
    h.fire.didNavigate(urlFor(A))

    expect(h.history()?.entries).toEqual([gated, at(B)])
    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: gated.filePath })
    )
  })

  it('records the page it shows when the list changed while the step was on its way', () => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis })
    void h.navigator.move({ kind: 'back', target: at(A), realPath: A, basis })

    h.store.set(pushEntry(basis, at(C)))
    h.fire.didNavigate(urlFor(A))

    expect(h.history()?.entries).toEqual([at(A), at(B), at(C), at(A)])
  })
})

describe('previewPageNavigator — one gesture buys one entry (QG-8 T1)', () => {
  it('pushes the first in-page step after a gesture and puts the second in its place', () => {
    const h = makeHarness({ spendGesture: true })

    h.fire.inPage(`${urlFor(A)}#faq`)
    h.fire.inPage(`${urlFor(A)}#team`)

    expect(h.history()?.entries).toEqual([at(A), at(A, 'team')])
    expect(h.emitPageChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: 'team', backTarget: at(A), generation: 2 })
    )
  })

  it.each([
    ['a same-tab move', { kind: 'open', target: at(B), realPath: B }, [at(A), at(B, 'faq')]],
    ['a Back step', { kind: 'back', target: at(A), realPath: A }, [at(A, 'faq'), at(B)]]
  ] as const)('%s that lands spends it: a hash step right after takes its entry', (_label, step, entries) => {
    const basis = step.kind === 'back' ? onB() : undefined
    const h = makeHarness({ initialHistory: basis, stored: basis, spendGesture: true })
    void h.navigator.move({ ...step, basis })

    h.fire.didNavigate(urlFor(step.realPath))
    h.fire.inPage(`${urlFor(step.realPath)}#faq`)

    expect(h.history()?.entries).toEqual(entries)
  })

  it('spends nothing on a move that never lands, nor on a step it ignored', () => {
    const h = makeHarness({ spendGesture: true })
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })

    h.fire.inPage(`${urlFor(A)}#left`)
    h.fire.stopLoading()
    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.history()?.entries).toEqual([at(A), at(A, 'faq')])
  })
})

describe('nativeHistoryOf', () => {
  it("reads Electron's navigationHistory, and gives null for contents without one", () => {
    const native = nativeOf([urlFor(A)])

    expect(nativeHistoryOf({ navigationHistory: native })).toBe(native)
    expect(nativeHistoryOf({})).toBeNull()
  })
})
