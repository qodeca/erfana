// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page features' part of a tab's state (025-FR-056, 025-FR-059,
 * 025-FR-008): which Erfana page shows, the failed address committed, where
 * focus goes, and the zoom level.
 */
import { describe, expect, it } from 'vitest'
import type { TabStateEvent } from '../../../../shared/ipc/browser-tab-schema'
import { TabStateEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import { clampZoomPercent, decorateTabState, loadErrorFor, NO_PAGE_FACTS } from './tabPageState'

const resolve = (host: string): string => host

function baseState(over: Partial<TabStateEvent> = {}): TabStateEvent {
  return {
    tabId: 'browser-tab-1',
    committedUrl: 'http://app.test/',
    pendingUrl: null,
    origin: null,
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomPercent: 100,
    widthPreset: 'full',
    security: 'notSecureHttp',
    inUse: { camera: false, microphone: false, screen: false },
    erfanaPage: null,
    devToolsOpen: false,
    ...over
  }
}

describe('loadErrorFor', () => {
  it('025-AC-076 sends focus to Reload when the user started the load, to the heading otherwise', () => {
    expect(loadErrorFor(-102, true)).toEqual({ code: -102, focus: 'reload' })
    expect(loadErrorFor(-102, false)).toEqual({ code: -102, focus: 'heading' })
  })

  it('shows no page for a cancelled load or a code that is not a net error', () => {
    expect(loadErrorFor(-3, true)).toBeNull()
    expect(loadErrorFor(0, true)).toBeNull()
    expect(loadErrorFor(-1001, true)).toBeNull()
    expect(loadErrorFor(-1.5, true)).toBeNull()
  })
})

describe('decorateTabState', () => {
  it('025-AC-076 commits the failed address on the load-error page, with its origin and security', () => {
    const state = decorateTabState(
      baseState({ committedUrl: 'https://app.test/', security: 'secure', erfanaPage: 'empty' }),
      { ...NO_PAGE_FACTS, failedUrl: 'http://localhost:4100/', loadError: { code: -102, focus: 'reload' } },
      resolve
    )
    expect(state).toMatchObject({
      committedUrl: 'http://localhost:4100/',
      pendingUrl: null,
      erfanaPage: 'loadError',
      loadError: { code: -102, focus: 'reload' },
      security: 'local'
    })
    expect(state.origin).not.toBeNull()
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
  })

  it("keeps the certificate's own warning sign on a load-error page", () => {
    const state = decorateTabState(
      baseState({ security: 'proceeded' }),
      { ...NO_PAGE_FACTS, failedUrl: 'https://app.test/', loadError: { code: -7, focus: 'heading' } },
      resolve
    )
    expect(state.security).toBe('proceeded')
  })

  it('025-AC-072 shows the crashed page over a load error, and the certificate page over both', () => {
    const facts = { ...NO_PAGE_FACTS, crashed: true, failedUrl: 'http://x.test/', loadError: { code: -102, focus: 'reload' as const } }
    expect(decorateTabState(baseState(), facts, resolve).erfanaPage).toBe('crashed')
    expect(decorateTabState(baseState(), facts, resolve).loadError).toBeUndefined()
    expect(decorateTabState(baseState({ erfanaPage: 'certificate' }), facts, resolve).erfanaPage).toBe('certificate')
  })

  it('leaves the state alone without facts, apart from the zoom level', () => {
    const state = decorateTabState(baseState({ erfanaPage: 'empty' }), { ...NO_PAGE_FACTS, zoomPercent: 125 }, resolve)
    expect(state).toEqual(baseState({ erfanaPage: 'empty', zoomPercent: 125 }))
  })

  it('caps a long failed address at the bar limit', () => {
    const long = `http://app.test/${'a'.repeat(9000)}`
    const state = decorateTabState(baseState(), { ...NO_PAGE_FACTS, failedUrl: long, loadError: { code: -2, focus: 'heading' } }, resolve)
    expect(state.committedUrl?.length).toBe(8192)
  })
})

describe('clampZoomPercent', () => {
  it('keeps the level in whole percent inside 25–500', () => {
    expect(clampZoomPercent(124.6)).toBe(125)
    expect(clampZoomPercent(10)).toBe(25)
    expect(clampZoomPercent(900)).toBe(500)
    expect(clampZoomPercent(Number.NaN)).toBe(100)
  })
})

describe('the load-error page address (attacker pass F7, issue #448)', () => {
  it('names the failed address without user info', () => {
    const state = decorateTabState(
      baseState(),
      { ...NO_PAGE_FACTS, failedUrl: 'http://accounts.example.com:pw@evil.test:4100/', loadError: { code: -102, focus: 'reload' } },
      resolve
    )
    expect(state.committedUrl).toBe('http://evil.test:4100/')
  })
})
