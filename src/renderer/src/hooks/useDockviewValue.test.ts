// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Tests for useDockviewValue and its two shared sources (active, visible).
 *
 * @see useDockviewValue.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  DOCKVIEW_PANEL_ACTIVE,
  DOCKVIEW_PANEL_VISIBLE,
  useDockviewValue,
  type DockviewActiveSource,
  type DockviewVisibleSource
} from './useDockviewValue'

/** A panel api stub with a hand-driven active flag. */
function makeActiveApi(initial: boolean) {
  const listeners = new Set<(event: { isActive: boolean }) => void>()
  const dispose = vi.fn()
  const api = {
    isActive: initial,
    onDidActiveChange: vi.fn((listener: (event: { isActive: boolean }) => void) => {
      listeners.add(listener)
      return {
        dispose: () => {
          listeners.delete(listener)
          dispose()
        }
      }
    })
  }
  return {
    api: api as DockviewActiveSource,
    emit: (isActive: boolean) => {
      api.isActive = isActive
      for (const listener of [...listeners]) listener({ isActive })
    },
    /** Changes the flag WITHOUT an event, like an activation before subscribe. */
    setSilently: (isActive: boolean) => {
      api.isActive = isActive
    },
    dispose,
    listenerCount: () => listeners.size
  }
}

describe('useDockviewValue', () => {
  it('reads the current value on the first render', () => {
    const { api } = makeActiveApi(true)
    const { result } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE))
    expect(result.current).toBe(true)
  })

  it('follows the change event', () => {
    const { api, emit } = makeActiveApi(false)
    const { result } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE))

    act(() => emit(true))
    expect(result.current).toBe(true)

    act(() => emit(false))
    expect(result.current).toBe(false)
  })

  it('uses the event payload, as the hand-rolled effects did', () => {
    const listeners: Array<(event: { isActive: boolean }) => void> = []
    const api: DockviewActiveSource = {
      isActive: false,
      onDidActiveChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      }
    }
    const { result } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE))

    act(() => listeners.forEach((listener) => listener({ isActive: true })))

    expect(result.current).toBe(true)
  })

  it('catches a change made between render and subscribe, which fires no event', () => {
    const { api, setSilently } = makeActiveApi(false)
    const { result } = renderHook(() => {
      const value = useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE)
      // Runs during render, before React subscribes the store
      setSilently(true)
      return value
    })

    expect(result.current).toBe(true)
  })

  it('subscribes once across re-renders and disposes on unmount', () => {
    const { api, dispose, listenerCount } = makeActiveApi(false)
    const { rerender, unmount } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE))
    rerender()
    rerender()

    expect(api.onDidActiveChange).toHaveBeenCalledTimes(1)
    expect(listenerCount()).toBe(1)

    unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(listenerCount()).toBe(0)
  })

  it('moves to a new api: re-reads it and re-subscribes', () => {
    const first = makeActiveApi(false)
    const second = makeActiveApi(true)
    const { result, rerender } = renderHook(({ api }) => useDockviewValue(api, DOCKVIEW_PANEL_ACTIVE), {
      initialProps: { api: first.api }
    })

    rerender({ api: second.api })

    expect(result.current).toBe(true)
    expect(first.listenerCount()).toBe(0)
    expect(second.listenerCount()).toBe(1)
  })

  describe('DOCKVIEW_PANEL_VISIBLE', () => {
    it('treats a missing api, or one that cannot report it, as visible', () => {
      expect(renderHook(() => useDockviewValue(undefined, DOCKVIEW_PANEL_VISIBLE)).result.current).toBe(true)
      expect(renderHook(() => useDockviewValue({} as DockviewVisibleSource, DOCKVIEW_PANEL_VISIBLE)).result.current).toBe(true)
    })

    it('keeps the first read when the api has no visibility event', () => {
      const api = { isVisible: false } as DockviewVisibleSource
      const { result } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_VISIBLE))
      expect(result.current).toBe(false)
    })

    it('follows the visibility event', () => {
      let emit: (event: { isVisible: boolean }) => void = () => {}
      const api: DockviewVisibleSource = {
        isVisible: true,
        onDidVisibilityChange: (listener) => {
          emit = listener
          return { dispose: () => {} }
        }
      }
      const { result } = renderHook(() => useDockviewValue(api, DOCKVIEW_PANEL_VISIBLE))

      act(() => emit({ isVisible: false }))

      expect(result.current).toBe(false)
    })
  })

  it('treats a missing api as not active', () => {
    const { result } = renderHook(() => useDockviewValue(undefined, DOCKVIEW_PANEL_ACTIVE))
    expect(result.current).toBe(false)
  })
})
