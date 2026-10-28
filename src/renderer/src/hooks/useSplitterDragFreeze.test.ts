// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useSplitterDragFreeze (issue #124, part 1 §1.5): the production
 * wiring of the drag-freeze controller.
 *
 * Real stores and the real overlay-guard singleton, so "hide through the
 * guard" is asserted where it happens – on the `setVisibility` the guard sends –
 * and "no visible preview" is whatever the guard itself decides. The bridge is
 * a fake whose `visibilityApplied` feed the tests drive.
 *
 * @see useSplitterDragFreeze.ts
 * @see ../services/preview/previewDragFreeze.test.ts - the controller's own edges
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useSplitterDragFreeze, usePreviewDragFreezeTarget } from './useSplitterDragFreeze'
import { getOverlayGuard, resetOverlayGuard } from '../services/preview/OverlayGuardService'
import { DRAG_FREEZE_LOG_MESSAGE, DRAG_FREEZE_LOG_REASON } from '../services/preview/previewDragFreeze'
import { useOverlayOccluderStore } from '../stores/useOverlayOccluderStore'
import { usePreviewCollapsedStore } from '../stores/usePreviewCollapsedStore'
import { usePreviewStore } from '../stores/usePreviewStore'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: log }))

const PANEL = 'preview-1'

let queued = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
const frame = (): void => {
  const due = [...queued.values()]
  queued = new Map()
  for (const callback of due) callback(0)
}

const appliedListeners = new Set<(p: { panelId: string; visible: boolean }) => void>()
const applied = (panelId: string, visible: boolean): void => {
  for (const listener of [...appliedListeners]) listener({ panelId, visible })
}
const setVisibility = vi.fn()

let sash: HTMLElement
const pointer = (type: string, x: number, buttons: number): MouseEvent =>
  new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, buttons })
/** Presses a sash and moves past the threshold. */
const dragStart = (): void => {
  sash.dispatchEvent(pointer('pointerdown', 100, 1))
  sash.dispatchEvent(pointer('pointermove', 120, 1))
}
const dragEnd = (): void => {
  sash.dispatchEvent(pointer('pointerup', 120, 0))
}
/** Lets the occluder store publish and the guard recompute. */
const flushMicrotasks = (): Promise<void> => Promise.resolve()

beforeEach(() => {
  queued = new Map()
  nextFrameId = 1
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = nextFrameId++
    queued.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queued.delete(id)
  })
  appliedListeners.clear()
  setVisibility.mockClear()
  for (const fn of Object.values(log)) fn.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preview: {
        setVisibility,
        onVisibilityApplied: (listener: (p: { panelId: string; visible: boolean }) => void) => {
          appliedListeners.add(listener)
          return () => appliedListeners.delete(listener)
        }
      }
    }
  })
  sash = document.createElement('div')
  sash.className = 'dv-sash'
  document.body.append(sash)

  resetOverlayGuard()
  usePreviewStore.getState().reset()
  useOverlayOccluderStore.getState().reset()
  usePreviewCollapsedStore.setState({ collapsed: new Set() })
  // One live preview, the active tab: the guard shows it.
  usePreviewStore.getState().setLoadState(PANEL, 'ready')
  getOverlayGuard().sync(PANEL)
})

afterEach(() => {
  resetOverlayGuard()
  sash.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useSplitterDragFreeze', () => {
  it('hides the visible preview through the guard and latches its picture', async () => {
    renderHook(() => useSplitterDragFreeze())
    expect(getOverlayGuard().visiblePanelId()).toBe(PANEL)

    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
    expect(usePreviewStore.getState().getPanel(PANEL)?.dragHideLatched).toBe(true)

    await flushMicrotasks()
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL, false, 'occluded')
    expect(getOverlayGuard().visiblePanelId()).toBeNull()
  })

  it('pushes the panel’s bounds before the guard shows it again', async () => {
    const push = vi.fn(() => {
      // The occluder is still up when the rect goes out.
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      return true
    })
    renderHook(() => {
      useSplitterDragFreeze()
      usePreviewDragFreezeTarget(PANEL, push)
    })

    dragStart()
    await flushMicrotasks()
    applied(PANEL, false)
    dragEnd()
    frame()
    frame()

    expect(push).toHaveBeenCalledTimes(1)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    await flushMicrotasks()
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL, true, 'active-tab')
  })

  it('does nothing when the preview is not on screen (another tab is active)', () => {
    getOverlayGuard().sync('editor-1')
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    expect(usePreviewStore.getState().getPanel(PANEL)?.dragHideLatched).toBe(false)
  })

  it('does nothing for a collapsed panel, which is already hidden', () => {
    usePreviewCollapsedStore.getState().setCollapsed(PANEL)
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('treats a collapsed panel as not visible even before the guard catches up', () => {
    // Pins the explicit read: whatever order the stores notify in, a collapsed
    // panel never makes the sash wait for a hide that will not come.
    vi.spyOn(getOverlayGuard(), 'visiblePanelId').mockReturnValue(PANEL)
    usePreviewCollapsedStore.setState({ collapsed: new Set([PANEL]) })
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('does nothing for a panel whose page crashed', () => {
    // `failed` is still "live" to the guard, but there is no page to cover.
    usePreviewStore.getState().setLoadState(PANEL, 'failed')
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('abandons the hold when the view is suspended mid-drag, and logs it', () => {
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    usePreviewStore.getState().setLoadState(PANEL, 'suspended')
    expect(log.info).toHaveBeenCalledWith(DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.holdAbandoned,
      panelId: PANEL
    })
  })

  it('logs a drag that ended before main confirmed the hide, as a warning', () => {
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    dragEnd()
    expect(log.warn).toHaveBeenCalledWith(DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.hideUnconfirmed,
      panelId: PANEL
    })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('releases the occluder when it unmounts mid-drag', () => {
    const { unmount } = renderHook(() => useSplitterDragFreeze())
    dragStart()
    unmount()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    expect(appliedListeners.size).toBe(1) // the guard's own; the freeze's is gone
  })

  it('forgets a panel’s bounds push when that panel unmounts', async () => {
    const push = vi.fn(() => true)
    const target = renderHook(() => usePreviewDragFreezeTarget(PANEL, push))
    renderHook(() => useSplitterDragFreeze())
    target.unmount()

    dragStart()
    await flushMicrotasks()
    applied(PANEL, false)
    dragEnd()
    frame()
    frame()

    expect(push).not.toHaveBeenCalled()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('keeps a remounted panel’s push when the old mount unmounts after it', async () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const old = renderHook(() => usePreviewDragFreezeTarget(PANEL, first))
    renderHook(() => usePreviewDragFreezeTarget(PANEL, second))
    old.unmount()
    renderHook(() => useSplitterDragFreeze())

    dragStart()
    await flushMicrotasks()
    applied(PANEL, false)
    dragEnd()
    frame()
    frame()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
