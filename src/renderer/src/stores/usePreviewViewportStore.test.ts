// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the native-view rect store (issue #74 follow-up; spec 025,
 * commit 16): `readNativeViewRects` returns the rects of every kind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readNativeViewRects, usePreviewViewportStore } from './usePreviewViewportStore'

const PREVIEW_RECT = { left: 0, top: 30, width: 400, height: 300 }
const BROWSER_RECT = { left: 400, top: 30, width: 400, height: 300 }

afterEach(() => {
  usePreviewViewportStore.setState({ rects: new Map() })
})

describe('readNativeViewRects', () => {
  it('returns one stable empty array when no view is placed', () => {
    expect(readNativeViewRects()).toEqual([])
    expect(readNativeViewRects()).toBe(readNativeViewRects())
  })

  it('returns the rects of preview and browser panels alike', () => {
    const { setRect } = usePreviewViewportStore.getState()
    setRect('preview-1', PREVIEW_RECT)
    setRect('browser-panel-1', BROWSER_RECT)
    expect(readNativeViewRects()).toEqual([PREVIEW_RECT, BROWSER_RECT])
  })

  it('drops a cleared panel’s rect', () => {
    const { setRect, clearRect } = usePreviewViewportStore.getState()
    setRect('preview-1', PREVIEW_RECT)
    setRect('browser-panel-1', BROWSER_RECT)
    clearRect('browser-panel-1')
    expect(readNativeViewRects()).toEqual([PREVIEW_RECT])
  })

  it('does not notify for an identical rect or an unknown clear', () => {
    const { setRect, clearRect } = usePreviewViewportStore.getState()
    setRect('browser-panel-1', BROWSER_RECT)
    const listener = vi.fn()
    const unsubscribe = usePreviewViewportStore.subscribe(listener)
    setRect('browser-panel-1', { ...BROWSER_RECT })
    clearRect('browser-panel-2')
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
