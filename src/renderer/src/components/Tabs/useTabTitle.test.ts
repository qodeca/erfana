// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useTabTitle} (QG-11a H5).
 *
 * @module useTabTitle.test
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useTabTitle, type TabTitleSource } from './useTabTitle'

/** Builds a panel api whose title the test can change by hand. */
function makeApi(initial?: string) {
  const listeners = new Set<(event: { title: string }) => void>()
  const dispose = vi.fn()

  const api = {
    title: initial,
    onDidTitleChange: (listener: (event: { title: string }) => void) => {
      listeners.add(listener)
      return {
        dispose: () => {
          listeners.delete(listener)
          dispose()
        }
      }
    }
  }

  return {
    api: api as TabTitleSource,
    emit: (title: string) => {
      api.title = title
      for (const listener of [...listeners]) listener({ title })
    },
    dispose,
    listenerCount: () => listeners.size
  }
}

describe('useTabTitle', () => {
  it('falls back to the file name until the panel sets a title', () => {
    const { api } = makeApi()

    const { result } = renderHook(() => useTabTitle(api, 'icon.png'))

    expect(result.current.label).toBe('icon.png')
    expect(result.current.isDeleted).toBe(false)
  })

  it('reads a title the panel set before the tab mounted', () => {
    // A background tab can mount long after its panel started reporting.
    const { api } = makeApi('icon.png (deleted)')

    const { result } = renderHook(() => useTabTitle(api, 'icon.png'))

    expect(result.current.label).toBe('icon.png')
    expect(result.current.isDeleted).toBe(true)
  })

  it('follows later title changes in both directions', () => {
    const { api, emit } = makeApi('icon.png')
    const { result } = renderHook(() => useTabTitle(api, 'icon.png'))

    act(() => emit('icon.png (deleted)'))
    expect(result.current.isDeleted).toBe(true)

    act(() => emit('icon.png'))
    expect(result.current.isDeleted).toBe(false)
    expect(result.current.label).toBe('icon.png')
  })

  it('strips the modified bullet, which the tab renders itself', () => {
    const { api } = makeApi('● doc.md')

    const { result } = renderHook(() => useTabTitle(api, 'doc.md'))

    expect(result.current.label).toBe('doc.md')
  })

  it('unsubscribes on unmount', () => {
    const { api, dispose, listenerCount } = makeApi('icon.png')
    const { unmount } = renderHook(() => useTabTitle(api, 'icon.png'))
    expect(listenerCount()).toBe(1)

    unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(listenerCount()).toBe(0)
  })

  it('survives an api with no title support at all', () => {
    // Defensive: a stub api in a test, or a dockview build without the event.
    const { result } = renderHook(() => useTabTitle({}, 'icon.png'))

    expect(result.current.label).toBe('icon.png')
    expect(result.current.isDeleted).toBe(false)
  })
})
