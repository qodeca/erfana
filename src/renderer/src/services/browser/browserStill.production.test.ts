// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The production `browserStill`: its wiring to the gateway, the stores and
 * the bounds sender's visibility answers. A file of its own because the
 * module-level mocks would change the factory tests (docs/windows/contributing.md
 * § Test-file split policy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ still: vi.fn() }))
const bounds = vi.hoisted(() => ({
  listeners: new Set<(tabId: string, visible: boolean) => void>(),
  onVisibilityApplied: vi.fn()
}))
vi.mock('../browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('./browserViewBounds', () => ({ browserViewBounds: bounds }))
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { browserStill, STILL_RETURN_TIMEOUT_MS } from './browserStill'
import { useBrowserStillStore } from '../../stores/useBrowserStillStore'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { browserState } from '../../components/Panels/BrowserPanel/__test__/browserState'

const TAB = 'browser-tab-1'
const PANEL = 'browser-panel-1'

function attach(patch: Parameters<typeof browserState>[0] = {}): void {
  useBrowserTabStore.getState().attach(PANEL, TAB)
  useBrowserTabStore.getState().applyState(browserState(patch))
}

describe('browserStill (production wiring)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
    gateway.still.mockResolvedValue({ still: new Uint8Array(4), width: 1, height: 1 })
    bounds.onVisibilityApplied.mockImplementation((listener: (tabId: string, visible: boolean) => void) => {
      bounds.listeners.add(listener)
      return () => bounds.listeners.delete(listener)
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    bounds.listeners.clear()
    useBrowserStillStore.setState({ byTab: new Map() })
    useBrowserTabStore.setState({ byTab: new Map(), tabByPanel: new Map(), stillCovers: new Set() })
  })

  it('refuses a tab with no panel or no live page', async () => {
    await expect(browserStill.hold(TAB, 'more')).resolves.toBe(false)
    attach({ erfanaPage: 'crashed' })
    await expect(browserStill.hold(TAB, 'more')).resolves.toBe(false)
    expect(gateway.still).not.toHaveBeenCalled()
  })

  it('captures through main, shows the picture, covers the panel, and drops it once main shows the page', async () => {
    attach()
    const held = browserStill.hold(TAB, 'more')
    await vi.runAllTimersAsync()
    await expect(held).resolves.toBe(true)
    expect(gateway.still).toHaveBeenCalledWith(TAB)
    expect(useBrowserStillStore.getState().byTab.get(TAB)?.source).toBe('page')
    expect(useBrowserTabStore.getState().coversPage(PANEL)).toBe(true)

    browserStill.release(TAB, 'more')
    expect(useBrowserTabStore.getState().coversPage(PANEL)).toBe(false)
    expect(useBrowserStillStore.getState().byTab.has(TAB)).toBe(true)
    for (const listener of [...bounds.listeners]) listener('browser-tab-2', true)
    for (const listener of [...bounds.listeners]) listener(TAB, false)
    expect(useBrowserStillStore.getState().byTab.has(TAB)).toBe(true)
    for (const listener of [...bounds.listeners]) listener(TAB, true)
    expect(useBrowserStillStore.getState().byTab.has(TAB)).toBe(false)
    expect(bounds.listeners.size).toBe(0)
  })

  it('drops the picture after the timeout when main never answers, and a new hold cancels the wait', async () => {
    attach()
    const first = browserStill.hold(TAB, 'more')
    await vi.runAllTimersAsync()
    await first
    browserStill.release(TAB, 'more')
    const again = browserStill.hold(TAB, 'more')
    await vi.runAllTimersAsync()
    await again
    browserStill.release(TAB, 'more')
    expect(bounds.listeners.size).toBe(1)
    vi.advanceTimersByTime(STILL_RETURN_TIMEOUT_MS)
    expect(useBrowserStillStore.getState().byTab.has(TAB)).toBe(false)
    expect(bounds.listeners.size).toBe(0)
  })
})
