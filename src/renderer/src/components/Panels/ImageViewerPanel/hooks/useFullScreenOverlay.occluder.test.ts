// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the full-screen-overlay → occluder wiring (Issue #74, item 67).
 *
 * Entering full screen raises an `'overlay'` occluder so the live preview view
 * hides behind its still frame; leaving full screen releases it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFullScreenOverlay } from './useFullScreenOverlay'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'

beforeEach(() => {
  useOverlayOccluderStore.getState().reset()
  const root = document.createElement('div')
  root.id = 'portal-root'
  document.body.appendChild(root)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFullScreenOverlay occluder (item 67)', () => {
  it('raises an overlay occluder while full-screen and releases it on close', () => {
    const { result } = renderHook(() => useFullScreenOverlay())

    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)

    act(() => {
      result.current.open()
    })
    expect(result.current.isFullScreen).toBe(true)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    act(() => {
      result.current.close()
    })
    expect(result.current.isFullScreen).toBe(false)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })
})
