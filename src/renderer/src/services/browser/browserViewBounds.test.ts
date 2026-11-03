// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the browser view bounds owner (spec 025, commit 16): the one
 * `browser-tab:bounds` sender, merging the bounds hook's placement with the
 * guard's visibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoundsRequest } from '../../../../shared/ipc/browser-tab-schema'
import { browserViewBounds, createBrowserViewBounds, type BrowserViewPlacement } from './browserViewBounds'

const TAB = 'browser-tab-1'
const PANEL = 'browser-panel-1'
const AT: BrowserViewPlacement = {
  bounds: { x: 10, y: 40, width: 600, height: 400 },
  clip: { x: 10, y: 40, width: 600, height: 400 }
}
const MOVED: BrowserViewPlacement = {
  bounds: { x: 200, y: 40, width: 410, height: 400 },
  clip: { x: 200, y: 40, width: 410, height: 400 }
}

function make(): { views: ReturnType<typeof createBrowserViewBounds>; sent: BoundsRequest[] } {
  const sent: BoundsRequest[] = []
  const views = createBrowserViewBounds((request) => sent.push(request))
  views.register(TAB, PANEL)
  return { views, sent }
}

describe('browserViewBounds – fails closed', () => {
  it('never shows a page on a placement alone', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.place(TAB, MOVED, true)
    expect(sent).toEqual([])
  })

  it('shows the latest placement when the guard asks, with an ack', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.place(TAB, MOVED)
    views.setVisibility(TAB, true)
    expect(sent).toEqual([{ tabId: TAB, ...MOVED, seq: 0, ack: true, visible: true }])
  })

  it('sends nothing for an unplaced view, and shows it on its first placement', () => {
    const { views, sent } = make()
    views.setVisibility(TAB, true)
    expect(sent).toEqual([])

    views.place(TAB, AT)
    expect(sent).toEqual([{ tabId: TAB, ...AT, seq: 0, ack: false, visible: true }])
  })

  it('ignores a tab that is not registered', () => {
    const { views, sent } = make()
    views.place('browser-tab-9', AT)
    views.setVisibility('browser-tab-9', true)
    expect(sent).toEqual([])
  })
})

describe('browserViewBounds – placement while shown', () => {
  it('sends every placement, unchanged ones too, passing the ack through', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.setVisibility(TAB, true)
    views.place(TAB, AT)
    views.place(TAB, MOVED, true)
    expect(sent.map((r) => [r.bounds.x, r.ack, r.visible])).toEqual([
      [10, true, true],
      [10, false, true],
      [200, true, true]
    ])
  })

  it('hides with the latest placement and stops sending placements while hidden', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.setVisibility(TAB, true)
    views.place(TAB, MOVED)
    views.setVisibility(TAB, false)
    views.place(TAB, AT)
    expect(sent).toHaveLength(3)
    expect(sent[2]).toEqual({ tabId: TAB, ...MOVED, seq: 2, ack: true, visible: false })
  })

  it('sends every visibility the guard asks for, a repeat too (the guard dedupes; a repeat is its correction)', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.setVisibility(TAB, true)
    views.setVisibility(TAB, true)
    views.setVisibility(TAB, false)
    expect(sent.map((r) => r.visible)).toEqual([true, true, false])
  })

  it('numbers every push from one counter, across tabs and writers', () => {
    const { views, sent } = make()
    views.register('browser-tab-2', 'browser-panel-2')
    views.place(TAB, AT)
    views.place('browser-tab-2', AT)
    views.setVisibility(TAB, true)
    views.setVisibility('browser-tab-2', true)
    views.place(TAB, MOVED)
    expect(sent.map((r) => r.seq)).toEqual([0, 1, 2])
  })
})

describe('browserViewBounds – registry', () => {
  it('lists views, finds a panel’s tab and notifies on change', () => {
    const { views } = make()
    const listener = vi.fn()
    const unsubscribe = views.subscribe(listener)

    views.register('browser-tab-2', 'browser-panel-2')
    expect(views.views()).toEqual([
      { tabId: TAB, panelId: PANEL },
      { tabId: 'browser-tab-2', panelId: 'browser-panel-2' }
    ])
    expect(views.tabOf('browser-panel-2')).toBe('browser-tab-2')
    expect(views.tabOf('editor-1')).toBeNull()

    views.unregister(TAB)
    expect(views.views()).toEqual([{ tabId: 'browser-tab-2', panelId: 'browser-panel-2' }])
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    views.unregister('browser-tab-2')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify for a repeat register or an unknown unregister', () => {
    const { views } = make()
    const listener = vi.fn()
    views.subscribe(listener)
    views.register(TAB, PANEL)
    views.unregister('browser-tab-9')
    expect(listener).not.toHaveBeenCalled()
  })

  it('starts a re-hosted tab hidden and unplaced', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.setVisibility(TAB, true)
    views.register(TAB, 'browser-panel-2')

    views.place(TAB, MOVED)
    expect(sent).toHaveLength(1)
    expect(views.tabOf('browser-panel-2')).toBe(TAB)
  })

  it('sends nothing for a tab after it is unregistered', () => {
    const { views, sent } = make()
    views.place(TAB, AT)
    views.unregister(TAB)
    views.setVisibility(TAB, true)
    expect(sent).toEqual([])
  })
})

describe('browserViewBounds – applied reports', () => {
  it('passes main’s report on for registered tabs only, until unsubscribed', () => {
    const { views } = make()
    const listener = vi.fn()
    const unsubscribe = views.onVisibilityApplied(listener)

    views.reportApplied(TAB, false)
    views.reportApplied('browser-tab-9', false)
    expect(listener).toHaveBeenCalledExactlyOnceWith(TAB, false)

    unsubscribe()
    views.reportApplied(TAB, true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('browserViewBounds – production instance', () => {
  afterEach(() => {
    browserViewBounds.unregister(TAB)
  })

  it('sends through window.api.browserTab.setBounds', () => {
    const setBounds = vi.fn()
    Object.defineProperty(window, 'api', { configurable: true, value: { browserTab: { setBounds } } })
    browserViewBounds.register(TAB, PANEL)
    browserViewBounds.place(TAB, AT)
    browserViewBounds.setVisibility(TAB, true)
    expect(setBounds).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tabId: TAB, visible: true }))
  })
})
