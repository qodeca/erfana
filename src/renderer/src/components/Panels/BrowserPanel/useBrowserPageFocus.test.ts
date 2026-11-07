// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const calls = vi.hoisted(() => [] as string[])
const gateway = vi.hoisted(() => ({
  focusOrigin: vi.fn(
    async (tabId: string, from: string) => void calls.push(`origin:${tabId}:${from}`)
  ),
  focusPage: vi.fn(async (tabId: string) => void calls.push(`page:${tabId}`))
}))
const applied = vi.hoisted(() => ({
  listener: null as null | ((tabId: string, visible: boolean) => void)
}))
const guard = vi.hoisted(() => ({ visible: null as string | null }))

vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../services/browser/browserViewBounds', () => ({
  browserViewBounds: {
    onVisibilityApplied: (listener: (tabId: string, visible: boolean) => void) => {
      applied.listener = listener
      return () => (applied.listener = null)
    }
  }
}))
vi.mock('../../../services/preview/OverlayGuardService', () => ({
  getOverlayGuard: () => ({ visiblePanelId: () => guard.visible })
}))
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn() } }))

import { useBrowserPageFocus } from './useBrowserPageFocus'
import { logger } from '../../../utils/logger'

const PANEL = 'browser-panel-1'
const TAB = 'browser-tab-1'

afterEach(() => {
  calls.length = 0
  guard.visible = null
  vi.clearAllMocks()
})

describe('useBrowserPageFocus', () => {
  it('names the toolbar as the origin before focusing a shown page', async () => {
    guard.visible = PANEL
    const { result } = renderHook(() =>
      useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: null })
    )
    await act(async () => result.current())
    expect(calls).toEqual([`origin:${TAB}:toolbar`, `page:${TAB}`])
  })

  it('waits for main to report the page shown, when asked to', async () => {
    const { result } = renderHook(() =>
      useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: 'empty' })
    )
    act(() => result.current(true))
    expect(calls).toEqual([])
    await act(async () => applied.listener?.('browser-tab-2', true))
    await act(async () => applied.listener?.(TAB, false))
    expect(calls).toEqual([])
    await act(async () => applied.listener?.(TAB, true))
    expect(calls).toEqual([`origin:${TAB}:toolbar`, `page:${TAB}`])
    await act(async () => applied.listener?.(TAB, true))
    expect(calls).toHaveLength(2)
  })

  it('drops a waiting request when an Erfana page takes the area, and a plain one at once', async () => {
    const { result, rerender } = renderHook(
      (props: { page: string | null }) =>
        useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: props.page }),
      { initialProps: { page: 'empty' as string | null } }
    )
    act(() => result.current(true))
    rerender({ page: 'loadError' })
    await act(async () => applied.listener?.(TAB, true))
    expect(calls).toEqual([])
    act(() => result.current())
    await act(async () => applied.listener?.(TAB, true))
    expect(calls).toEqual([])
  })

  it('does nothing without a tab, and logs a refused focus', async () => {
    const none = renderHook(() =>
      useBrowserPageFocus({ panelId: PANEL, tabId: null, erfanaPage: null })
    )
    act(() => none.result.current(true))
    guard.visible = PANEL
    gateway.focusOrigin.mockRejectedValueOnce(new Error('gone'))
    const { result } = renderHook(() =>
      useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: null })
    )
    await act(async () => result.current())
    expect(logger.warn).toHaveBeenCalled()
  })

  it('calls onFocused once main focused the page, also for a waiting request', async () => {
    guard.visible = PANEL
    const onFocused = vi.fn()
    const { result, rerender } = renderHook(
      (props: { page: string | null }) =>
        useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: props.page, onFocused }),
      { initialProps: { page: null as string | null } }
    )
    await act(async () => result.current())
    expect(onFocused).toHaveBeenCalledTimes(1)
    rerender({ page: 'empty' })
    act(() => result.current(true))
    expect(onFocused).toHaveBeenCalledTimes(1)
    await act(async () => applied.listener?.(TAB, true))
    expect(onFocused).toHaveBeenCalledTimes(2)
  })

  it('does not call onFocused when main refused the focus', async () => {
    guard.visible = PANEL
    const onFocused = vi.fn()
    gateway.focusPage.mockRejectedValueOnce(new Error('gone'))
    const { result } = renderHook(() =>
      useBrowserPageFocus({ panelId: PANEL, tabId: TAB, erfanaPage: null, onFocused })
    )
    await act(async () => result.current())
    expect(logger.warn).toHaveBeenCalled()
    expect(onFocused).not.toHaveBeenCalled()
  })
})
