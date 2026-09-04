// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useOccluder (Issue #74, item 62).
 *
 * @see useOccluder.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOccluder } from './useOccluder'
import { useOverlayOccluderStore } from '../stores/useOverlayOccluderStore'

/** Awaits one microtask turn so the store's coalesced flush runs. */
const flushMicrotasks = (): Promise<void> => Promise.resolve()

describe('useOccluder', () => {
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
  })

  it('registers when active is true', () => {
    renderHook(() => useOccluder('menu', true))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
  })

  it('does not register when active is false', () => {
    renderHook(() => useOccluder('menu', false))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('releases on unmount', () => {
    const { unmount } = renderHook(() => useOccluder('overlay', true))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    unmount()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('registers/releases as active toggles', () => {
    const { rerender } = renderHook(({ active }) => useOccluder('toast', active), {
      initialProps: { active: false }
    })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)

    rerender({ active: true })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    rerender({ active: false })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('does not stack counts across a stable active=true render', async () => {
    const { rerender, unmount } = renderHook(() => useOccluder('dialog', true))
    rerender()
    await flushMicrotasks()
    // A re-render with unchanged deps must not double-register.
    expect(useOverlayOccluderStore.getState().counts).toEqual({ dialog: 1 })

    unmount()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })
})
