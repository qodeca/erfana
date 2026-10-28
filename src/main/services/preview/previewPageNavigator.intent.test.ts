// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page navigator (issue #124, WI-17b; part 3 §3.5): an intent ends with its
 * pending load – never on a fail event or on `did-start-navigation` (S15) – and
 * the in-page steps of the page on screen it records with no move on its way:
 * pushed after real input, in place of the current entry without it (QG-7 S1),
 * and never one to another document (QG-7 S2). Split from
 * `previewPageNavigator.test.ts` by topic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PreviewPageChangedPayloadSchema } from '../../../shared/ipc/preview-navigation-schema'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  A,
  B,
  C,
  PANEL_ID,
  TOKEN,
  at,
  makeHarness,
  onB,
  urlFor
} from './__test-helpers__/previewPageNavigatorHarness'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('previewPageNavigator — an intent ends with its pending load (part 2 §2.3)', () => {
  it.each([
    ['sec 1', '#sec%201'],
    ['zażółć', '#za%C5%BC%C3%B3%C5%82%C4%87']
  ])(
    "a commit in Chromium's form of the target (%s) lands the move, and the next one is not refused",
    (anchor, committed) => {
      const h = makeHarness()
      void h.navigator.move({ kind: 'open', target: at(B, anchor), realPath: B })

      h.fire.didNavigate(`${urlFor(B)}${committed}`)

      expect(h.history()?.entries).toEqual([at(A), at(B, anchor)])
      expect(h.emitPageChanged).toHaveBeenCalledTimes(1)
      expect(h.navigator.isNavigationPending()).toBe(false)
    }
  )

  it.each([['sec 1'], ['zażółć']])(
    'a did-stop-loading with no commit ends the move (%s): nothing changes, and the next one is not refused',
    (anchor) => {
      const h = makeHarness()
      void h.navigator.move({ kind: 'open', target: at(B, anchor), realPath: B })

      h.fire.stopLoading()

      expect(h.emitPageChanged).not.toHaveBeenCalled()
      expect(h.history()?.entries).toEqual([at(A)])
      expect(h.navigator.isNavigationPending()).toBe(false)
    }
  )

  it('keeps the move through fail events and did-start-navigation, which end nothing (S15, S16)', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })

    h.fire.startNavigation(urlFor(B))
    h.fire.failLoad(urlFor(B))
    h.fire.failLoad(urlFor(A))

    expect(h.navigator.isNavigationPending()).toBe(true)
    h.fire.didNavigate(urlFor(B))
    expect(h.emitPageChanged).toHaveBeenCalledTimes(1)
  })

  it('a later move supersedes an earlier one: only the later one lands', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })
    void h.navigator.move({ kind: 'open', target: at(C), realPath: C })

    h.fire.didNavigate(urlFor(C))

    expect(h.emitPageChanged).toHaveBeenCalledTimes(1)
    expect(h.history()?.entries).toEqual([at(A), at(C)])
  })

  it('a commit of another document drops the move and names nothing', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })

    h.fire.didNavigate(urlFor(A))

    expect(h.emitPageChanged).not.toHaveBeenCalled()
    expect(h.navigator.isNavigationPending()).toBe(false)
  })

  it('a reload is no move: its commit names nothing and moves no history', () => {
    const h = makeHarness()

    void h.page.startPageLoad(A, 'reload', () => undefined)
    h.fire.didNavigate(urlFor(A))

    expect(h.emitPageChanged).not.toHaveBeenCalled()
    expect(h.store.set).toHaveBeenCalledTimes(1)
  })

  it('a move whose load cannot start throws, and leaves nothing pending', () => {
    const h = makeHarness()
    h.loadUrl.mockImplementationOnce(() => {
      throw new Error('Object has been destroyed')
    })

    expect(() => h.navigator.move({ kind: 'open', target: at(B), realPath: B })).toThrow(
      'Object has been destroyed'
    )
    expect(h.onMoveStarted).not.toHaveBeenCalled()
    expect(h.navigator.isNavigationPending()).toBe(false)
  })

  it('writes and tells nothing once the view is going away', () => {
    const h = makeHarness()
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })
    h.setDefunct(true)

    h.fire.didNavigate(urlFor(B))
    h.fire.inPage(`${urlFor(B)}#late`)

    expect(h.emitPageChanged).not.toHaveBeenCalled()
    expect(h.history()?.entries).toEqual([at(A)])
  })
})

describe('previewPageNavigator — in-page steps with no move on its way', () => {
  it('pushes a #section jump of the page on screen, same-document', () => {
    const h = makeHarness()

    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.history()?.entries).toEqual([at(A), at(A, 'faq')])
    expect(h.emitPageChanged).toHaveBeenCalledWith({
      filePath: A,
      anchor: 'faq',
      sameDocument: true,
      failed: false,
      canGoBack: true,
      canGoForward: false,
      backTarget: at(A),
      forwardTarget: null,
      generation: 1
    })
  })

  it('pushes nothing for the entry on screen, nor while a move is on its way', () => {
    const h = makeHarness()

    h.fire.inPage(urlFor(A))
    void h.navigator.move({ kind: 'open', target: at(B), realPath: B })
    h.fire.inPage(`${urlFor(A)}#left`)

    expect(h.emitPageChanged).not.toHaveBeenCalled()
    expect(h.history()?.entries).toEqual([at(A)])
  })

  it("cuts a fragment past the contract's 1024 characters, and reads an empty one as the top", () => {
    const h = makeHarness()

    h.fire.inPage(`${urlFor(A)}#${'x'.repeat(2000)}`)
    h.fire.inPage(`${urlFor(A)}#`)

    expect(h.history()?.entries).toEqual([at(A), at(A, 'x'.repeat(1024)), at(A)])
    // What goes out is what the contract lets through (QG-6 A3).
    expect(h.emitPageChanged).toHaveBeenCalledTimes(2)
    for (const [change] of h.emitPageChanged.mock.calls) {
      const payload = { panelId: PANEL_ID, ...change }
      expect(PreviewPageChangedPayloadSchema.safeParse(payload).success).toBe(true)
    }
  })

  it.each([
    ['another page', `erfana-preview://${TOKEN}/sub/new%20page.html#sec%201`],
    ['a hidden separator', `erfana-preview://${TOKEN}/a%2Fb.html`],
    ['another token', 'erfana-preview://ffffffffffffffffffffffffffffffff/a.html'],
    ['the root itself', `erfana-preview://${TOKEN}/`],
    ['something that is no URL', 'not a url']
  ])('records no step to %s, and logs it by panel digest alone – no URL (QG-7 S2)', (_label, url) => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const h = makeHarness()

    h.fire.inPage(url)

    expect(h.emitPageChanged).not.toHaveBeenCalled()
    expect(h.history()?.entries).toEqual([at(A)])
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(expect.any(String), {
      panelId: stablePathDigest(PANEL_ID)
    })
    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain(url)
    expect(logged).not.toContain(PANEL_ID)
  })

  it('falls back to its first history when the panel store lost it', () => {
    const h = makeHarness()
    h.store.get.mockReturnValue(null)

    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ anchor: 'faq', backTarget: at(A), generation: 1 })
    )
  })
})

describe('previewPageNavigator — an in-page step is pushed only after real input (QG-7 S1)', () => {
  it('puts a step no gesture came before in place of the current entry, and still names it', () => {
    const h = makeHarness({ gesture: false })

    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.history()?.entries).toEqual([at(A, 'faq')])
    expect(h.emitPageChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: A,
        anchor: 'faq',
        sameDocument: true,
        canGoBack: false,
        generation: 1
      })
    )
  })

  it('keeps the list its length through 60 scripted hash steps, so Back still reaches the page before', () => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis, gesture: false })

    for (let step = 0; step < 60; step += 1) {
      h.fire.inPage(`${urlFor(B)}#spy-${step}`)
    }

    const flooded = h.history()!
    expect(flooded.entries).toEqual([at(A), at(B, 'spy-59')])
    expect(h.emitPageChanged).toHaveBeenCalledTimes(60)
    void h.navigator.move({ kind: 'back', target: at(A), realPath: A, basis: flooded })
    h.fire.didNavigate(urlFor(A))
    expect(h.emitPageChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ filePath: A, canGoBack: false, forwardTarget: at(B, 'spy-59') })
    )
  })

  it('pushes one of 60 hash steps after one gesture, so Back still reaches the page before', () => {
    const basis = onB()
    const h = makeHarness({ initialHistory: basis, stored: basis, spendGesture: true })

    for (let step = 0; step < 60; step += 1) {
      h.fire.inPage(`${urlFor(B)}#spy-${step}`)
    }

    const flooded = h.history()!
    expect(flooded.entries).toEqual([at(A), at(B), at(B, 'spy-59')])
    void h.navigator.move({ kind: 'back', target: at(B), realPath: B, basis: flooded })
    h.fire.inPage(urlFor(B))
    expect(h.emitPageChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ filePath: B, anchor: null, canGoBack: true, backTarget: at(A) })
    )
  })

  it('pushes again once a gesture has reached the view', () => {
    const h = makeHarness({ gesture: false })
    h.fire.inPage(`${urlFor(A)}#spy`)

    h.setGesture(true)
    h.fire.inPage(`${urlFor(A)}#faq`)

    expect(h.history()?.entries).toEqual([at(A, 'spy'), at(A, 'faq')])
  })
})
