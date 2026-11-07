// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page view's mouse router (spec 025, 025-FR-047 to 025-FR-049; ADR 0011
 * decision 16): which presses reach the page, the release of a dropped press,
 * pick blocking and the pointer's presence for the click guard. The reducer's
 * own decisions are covered by `routingState.test.ts`; the first-click rule
 * end to end is in `BrowserTabInput.test.ts`.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { INITIAL_ROUTING_STATE, type RoutingEffect, type RoutingEvent, type RoutingState } from '../../../../shared/browser/routingState'
import { BrowserMouseRouter, DEFAULT_DOUBLE_CLICK_MS } from './browserMouseRouter'
import { fakeEvent } from './__test-helpers__/fakeInputContents'

const BROWSE: RoutingState = { ...INITIAL_ROUTING_STATE, focus: 'page', pageLoaded: true }

let state: RoutingState
let effects: RoutingEffect[]
let dispatch: Mock<(event: RoutingEvent) => readonly RoutingEffect[]>
let focusPage: Mock<() => void>
let router: BrowserMouseRouter

function send(type: string, button?: 'left' | 'middle' | 'right'): boolean {
  const event = fakeEvent()
  router.handle(event, button === undefined ? { type } : { type, button })
  return event.prevented
}

beforeEach(() => {
  state = BROWSE
  effects = []
  dispatch = vi.fn((_event: RoutingEvent) => effects)
  focusPage = vi.fn()
  router = new BrowserMouseRouter({ state: () => state, dispatch, now: () => 1234, doubleClickMs: 400, focusPage })
})

describe('BrowserMouseRouter', () => {
  it('delivers a press and its release while browsing, telling the reducer the time and interval', () => {
    expect(send('mouseDown', 'left')).toBe(false)
    expect(send('mouseUp', 'left')).toBe(false)
    expect(dispatch).toHaveBeenCalledWith({ type: 'pageClick', now: 1234, doubleClickMs: 400 })
    expect(focusPage).not.toHaveBeenCalled()
  })

  it('025-AC-061 drops a press the click guard drops, and its release, and gives the page focus', () => {
    effects = [{ type: 'dropClick' }]
    expect(send('mouseDown', 'left')).toBe(true)
    expect(send('mouseUp', 'left')).toBe(true)
    expect(focusPage).toHaveBeenCalledTimes(1)
    // The next release belongs to no dropped press.
    expect(send('mouseUp', 'left')).toBe(false)
  })

  it.each([
    ['pick mode', { ...BROWSE, pick: true }],
    ['an open menu', { ...BROWSE, pick: true, surface: 'menu' as const }],
    ['an open dialog', { ...BROWSE, pick: true, surface: 'dialog' as const }]
  ])('blocks presses, releases and the context menu in %s', (_name, blocked) => {
    state = blocked
    expect(send('mouseDown', 'left')).toBe(true)
    expect(send('mouseUp', 'left')).toBe(true)
    expect(send('mouseDown', 'right')).toBe(true)
    expect(send('contextMenu')).toBe(true)
    expect(send('mouseUp', 'right')).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(focusPage).toHaveBeenCalledTimes(1)
  })

  it('leaves other buttons and the context menu to the page while browsing', () => {
    expect(send('mouseDown', 'middle')).toBe(false)
    expect(send('mouseUp', 'middle')).toBe(false)
    expect(send('contextMenu')).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('treats a press with no button as the primary one', () => {
    effects = [{ type: 'dropClick' }]
    expect(send('mouseDown')).toBe(true)
    expect(send('mouseUp')).toBe(true)
  })

  it('tracks whether the pointer is over the page', () => {
    expect(router.isPointerOverPage()).toBe(false)
    send('mouseEnter')
    expect(router.isPointerOverPage()).toBe(true)
    send('mouseLeave')
    expect(router.isPointerOverPage()).toBe(false)
    send('mouseMove')
    expect(router.isPointerOverPage()).toBe(true)
    send('mouseLeave')
    send('mouseDown', 'left')
    expect(router.isPointerOverPage()).toBe(true)
    expect(send('mouseWheel')).toBe(false)
  })

  it('forgets dropped presses on reset', () => {
    state = { ...BROWSE, pick: true }
    send('mouseDown', 'left')
    router.reset()
    state = BROWSE
    expect(send('mouseUp', 'left')).toBe(false)
  })

  it('uses a double-click interval no shorter than the common system defaults', () => {
    expect(DEFAULT_DOUBLE_CLICK_MS).toBeGreaterThanOrEqual(500)
  })
})
