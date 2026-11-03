// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import type { TabStateEvent } from '../../../shared/ipc/browser-tab-schema'
import {
  LOCAL_ADDRESS_LIMIT,
  UNHOSTED_STATE_LIMIT,
  pngDataUrl,
  useBrowserTabStore
} from './useBrowserTabStore'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function stateEvent(tabId: string, patch: Partial<TabStateEvent> = {}): TabStateEvent {
  return {
    tabId,
    committedUrl: null,
    pendingUrl: null,
    origin: null,
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomPercent: 100,
    widthPreset: 'full',
    security: 'secure',
    inUse: { camera: false, microphone: false, screen: false },
    erfanaPage: 'empty',
    devToolsOpen: false,
    ...patch
  }
}

const store = useBrowserTabStore.getState

afterEach(() => {
  useBrowserTabStore.setState({
    byTab: new Map(),
    tabByPanel: new Map(),
    unhosted: new Map(),
    closing: new Set(),
    localAddresses: []
  })
})

describe('pngDataUrl', () => {
  it('encodes PNG bytes as a data URL', () => {
    expect(pngDataUrl(PNG)).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`)
  })

  it.each([
    [new Uint8Array([1, 2, 3])],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b, 9])],
    [new Uint8Array()]
  ])('refuses bytes that are not a PNG (%#)', bytes => {
    expect(pngDataUrl(bytes)).toBeNull()
  })

  it('encodes a large icon in chunks', () => {
    const big = new Uint8Array(70_000)
    big.set(PNG.subarray(0, 8))
    expect(pngDataUrl(big)?.length).toBeGreaterThan(90_000)
  })
})

describe('useBrowserTabStore', () => {
  it('hosts a tab and applies its states, keeping the icon until it changes', () => {
    store().attach('browser-panel-1', 'browser-tab-1')
    expect(store().tabOf('browser-panel-1')).toBe('browser-tab-1')
    store().applyState({ ...stateEvent('browser-tab-1'), icon: PNG })
    const withIcon = store().byTab.get('browser-tab-1')
    expect(withIcon?.iconUrl).toMatch(/^data:image\/png;base64,/)
    store().applyState(stateEvent('browser-tab-1', { title: 'A' }))
    expect(store().byTab.get('browser-tab-1')?.iconUrl).toBe(withIcon?.iconUrl)
    expect(store().byTab.get('browser-tab-1')?.state?.title).toBe('A')
    store().applyState({ ...stateEvent('browser-tab-1'), icon: null })
    expect(store().byTab.get('browser-tab-1')?.iconUrl).toBeNull()
  })

  it('attaching the same tab twice changes nothing', () => {
    store().attach('browser-panel-1', 'browser-tab-1')
    const before = store().byTab
    store().attach('browser-panel-1', 'browser-tab-1')
    expect(store().byTab).toBe(before)
  })

  it('keeps an early state for a tab no panel hosts yet and applies it on attach', () => {
    store().applyState({ ...stateEvent('browser-tab-9', { title: 'Early' }), icon: PNG })
    expect(store().byTab.has('browser-tab-9')).toBe(false)
    store().attach('browser-panel-9', 'browser-tab-9')
    const entry = store().byTab.get('browser-tab-9')
    expect(entry?.state?.title).toBe('Early')
    expect(entry?.iconUrl).not.toBeNull()
    expect(store().unhosted.size).toBe(0)
  })

  it('caps the early states it keeps, dropping the oldest', () => {
    for (let n = 0; n <= UNHOSTED_STATE_LIMIT; n++)
      store().applyState(stateEvent(`browser-tab-${n}`))
    expect(store().unhosted.size).toBe(UNHOSTED_STATE_LIMIT)
    expect(store().unhosted.has('browser-tab-0')).toBe(false)
  })

  it('tracks page focus per tab, ignoring unknown tabs and no-op changes', () => {
    store().attach('browser-panel-1', 'browser-tab-1')
    store().setPageFocused('browser-tab-1', true)
    expect(store().byTab.get('browser-tab-1')?.pageFocused).toBe(true)
    const before = store().byTab
    store().setPageFocused('browser-tab-1', true)
    store().setPageFocused('browser-tab-2', true)
    expect(store().byTab).toBe(before)
  })

  describe('coversPage', () => {
    it('fails closed for an unknown panel and before the first state', () => {
      expect(store().coversPage('browser-panel-x')).toBe(true)
      store().attach('browser-panel-1', 'browser-tab-1')
      expect(store().coversPage('browser-panel-1')).toBe(true)
    })

    it('covers an Erfana page and uncovers a live page', () => {
      store().attach('browser-panel-1', 'browser-tab-1')
      store().applyState(stateEvent('browser-tab-1', { erfanaPage: 'loadError' }))
      expect(store().coversPage('browser-panel-1')).toBe(true)
      store().applyState(stateEvent('browser-tab-1', { erfanaPage: null }))
      expect(store().coversPage('browser-panel-1')).toBe(false)
    })

    it('covers a closing panel, and removal forgets it', () => {
      store().attach('browser-panel-1', 'browser-tab-1')
      store().applyState(stateEvent('browser-tab-1', { erfanaPage: null }))
      store().markClosing('browser-panel-1')
      store().markClosing('browser-panel-1')
      expect(store().coversPage('browser-panel-1')).toBe(true)
      store().removePanel('browser-panel-1')
      expect(store().tabOf('browser-panel-1')).toBeNull()
      expect(store().byTab.size).toBe(0)
      expect(store().closing.size).toBe(0)
    })
  })

  it('removing an unknown panel changes nothing', () => {
    const before = useBrowserTabStore.getState()
    store().removePanel('browser-panel-404')
    expect(useBrowserTabStore.getState()).toBe(before)
  })

  it('keeps local addresses newest first, deduplicated and capped', () => {
    store().addLocalAddress(' http://localhost:5173/ ')
    store().addLocalAddress('http://localhost:5173/')
    store().addLocalAddress('')
    store().addLocalAddress('http://127.0.0.1:3000/')
    store().addLocalAddress('http://localhost:5173/')
    expect(store().localAddresses).toEqual(['http://localhost:5173/', 'http://127.0.0.1:3000/'])
    for (let n = 0; n < LOCAL_ADDRESS_LIMIT + 5; n++)
      store().addLocalAddress(`http://localhost:${4000 + n}/`)
    expect(store().localAddresses).toHaveLength(LOCAL_ADDRESS_LIMIT)
  })
})
