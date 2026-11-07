// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const views = vi.hoisted(() => ({ place: vi.fn() }))
const clip = vi.hoisted(() => ({ visible: true }))
const freeze = vi.hoisted(() => ({ pushers: new Map<string, () => boolean>() }))

vi.mock('../../../services/browser/browserViewBounds', () => ({ browserViewBounds: views }))
vi.mock('../HtmlPreviewPanel/previewClip', () => ({
  visibleArea: (_el: HTMLElement, rect: unknown) => (clip.visible ? rect : null)
}))
vi.mock('../../../hooks/useSplitterDragFreeze', () => ({
  usePreviewDragFreezeTarget: (panelId: string, push: () => boolean) =>
    freeze.pushers.set(panelId, push)
}))

import { useBrowserBounds } from './useBrowserBounds'
import { usePreviewViewportStore } from '../../../stores/usePreviewViewportStore'
import { usePreviewCollapsedStore } from '../../../stores/usePreviewCollapsedStore'

const PANEL = 'browser-panel-1'
let frames: FrameRequestCallback[] = []

function placeholder(rect: { left: number; top: number; width: number; height: number }): {
  current: HTMLDivElement
} {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: 0,
    bottom: 0,
    toJSON: () => ({})
  })
  return { current: el }
}

function tick(): void {
  const due = frames
  frames = []
  for (const frame of due) frame(0)
}

beforeEach(() => {
  frames = []
  clip.visible = true
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  views.place.mockClear()
  usePreviewViewportStore.setState({ rects: new Map() })
  usePreviewCollapsedStore.setState({ collapsed: new Set() })
})

describe('useBrowserBounds', () => {
  it('places the page on the placeholder once visible, then only on a change', () => {
    const ref = placeholder({ left: 10, top: 20, width: 300, height: 200 })
    const { rerender } = renderHook(
      (props: { visible: boolean }) =>
        useBrowserBounds({
          panelId: PANEL,
          tabId: 'browser-tab-1',
          placeholderRef: ref,
          isVisible: props.visible
        }),
      { initialProps: { visible: false } }
    )
    expect(views.place).not.toHaveBeenCalled()
    rerender({ visible: true })
    const rect = { x: 10, y: 20, width: 300, height: 200 }
    expect(views.place).toHaveBeenCalledExactlyOnceWith('browser-tab-1', {
      bounds: rect,
      clip: rect
    })
    expect(usePreviewViewportStore.getState().rects.get(PANEL)).toEqual({
      left: 10,
      top: 20,
      width: 300,
      height: 200
    })
    tick()
    expect(views.place).toHaveBeenCalledTimes(1)
    ref.current.getBoundingClientRect = () => ({
      left: 10,
      top: 40,
      width: 300,
      height: 180,
      x: 10,
      y: 40,
      right: 0,
      bottom: 0,
      toJSON: () => ({})
    })
    tick()
    expect(views.place).toHaveBeenLastCalledWith(
      'browser-tab-1',
      expect.objectContaining({ bounds: { x: 10, y: 40, width: 300, height: 180 } })
    )
    rerender({ visible: false })
    expect(usePreviewViewportStore.getState().rects.has(PANEL)).toBe(false)
  })

  it('sends nothing without a tab or with an empty box', () => {
    renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: null,
        placeholderRef: placeholder({ left: 0, top: 0, width: 9, height: 9 }),
        isVisible: true
      })
    )
    renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: 'browser-tab-1',
        placeholderRef: placeholder({ left: 0, top: 0, width: 0, height: 9 }),
        isVisible: true
      })
    )
    renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: 'browser-tab-1',
        placeholderRef: { current: null },
        isVisible: true
      })
    )
    expect(views.place).not.toHaveBeenCalled()
  })

  it('collapses a placed page that its ancestors clip away, and pushes before clearing on the way back', () => {
    const ref = placeholder({ left: 0, top: 0, width: 100, height: 100 })
    renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: 'browser-tab-1',
        placeholderRef: ref,
        isVisible: true
      })
    )
    clip.visible = false
    tick()
    expect(usePreviewCollapsedStore.getState().isCollapsed(PANEL)).toBe(true)
    expect(usePreviewViewportStore.getState().rects.has(PANEL)).toBe(false)
    clip.visible = true
    views.place.mockImplementation(() =>
      expect(usePreviewCollapsedStore.getState().isCollapsed(PANEL)).toBe(true)
    )
    tick()
    expect(views.place).toHaveBeenCalledTimes(2)
    expect(usePreviewCollapsedStore.getState().isCollapsed(PANEL)).toBe(false)
    views.place.mockReset()
  })

  it('never collapses a page that was never placed', () => {
    clip.visible = false
    renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: 'browser-tab-1',
        placeholderRef: placeholder({ left: 0, top: 0, width: 9, height: 9 }),
        isVisible: true
      })
    )
    expect(usePreviewCollapsedStore.getState().isCollapsed(PANEL)).toBe(false)
  })

  it('offers a forced push to the splitter freeze and clears its flags on unmount', () => {
    const ref = placeholder({ left: 0, top: 0, width: 50, height: 50 })
    const { unmount } = renderHook(() =>
      useBrowserBounds({
        panelId: PANEL,
        tabId: 'browser-tab-1',
        placeholderRef: ref,
        isVisible: true
      })
    )
    expect(freeze.pushers.get(PANEL)?.()).toBe(true)
    expect(views.place).toHaveBeenCalledTimes(2)
    usePreviewCollapsedStore.getState().setCollapsed(PANEL)
    unmount()
    expect(usePreviewCollapsedStore.getState().isCollapsed(PANEL)).toBe(false)
    expect(usePreviewViewportStore.getState().rects.has(PANEL)).toBe(false)
  })
})
