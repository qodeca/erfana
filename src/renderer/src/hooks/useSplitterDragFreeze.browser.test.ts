// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the splitter drag freeze over a built-in browser tab (spec 025,
 * ADR 0011 decision 2, commit 16): the freeze that hides a live preview hides
 * a shown browser page the same way, through the guard.
 *
 * Real stores, the real guard singleton and the real browser view bounds
 * owner; the bridge is a fake recording `browser-tab:bounds` pushes. Main's
 * confirmation is fed through `browserViewBounds.reportApplied`, the seam main's
 * `ack` answer will drive.
 *
 * @see useSplitterDragFreeze.test.ts - the preview cases, unchanged
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { BoundsRequest } from '../../../shared/ipc/browser-tab-schema'
import { useSplitterDragFreeze, usePreviewDragFreezeTarget } from './useSplitterDragFreeze'
import { browserViewBounds } from '../services/browser/browserViewBounds'
import { getOverlayGuard, resetOverlayGuard } from '../services/preview/OverlayGuardService'
import { DRAG_FREEZE_LOG_MESSAGE, DRAG_FREEZE_LOG_REASON } from '../services/preview/previewDragFreeze'
import { useOverlayOccluderStore } from '../stores/useOverlayOccluderStore'
import { usePreviewCollapsedStore } from '../stores/usePreviewCollapsedStore'
import { usePreviewStore } from '../stores/usePreviewStore'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: log }))

const TAB = 'browser-tab-1'
const PANEL = 'browser-panel-1'
const PLACEMENT = {
  bounds: { x: 0, y: 30, width: 800, height: 500 },
  clip: { x: 0, y: 30, width: 800, height: 500 }
}

let queued = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
const frame = (): void => {
  const due = [...queued.values()]
  queued = new Map()
  for (const callback of due) callback(0)
}

const setBounds = vi.fn()
const lastVisible = (): boolean | undefined => (setBounds.mock.lastCall?.[0] as BoundsRequest | undefined)?.visible

let sash: HTMLElement
const pointer = (type: string, x: number, buttons: number): MouseEvent =>
  new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, buttons })
const dragStart = (): void => {
  sash.dispatchEvent(pointer('pointerdown', 100, 1))
  sash.dispatchEvent(pointer('pointermove', 120, 1))
}
const dragEnd = (): void => {
  sash.dispatchEvent(pointer('pointerup', 120, 0))
}
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
  setBounds.mockClear()
  for (const fn of Object.values(log)) fn.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preview: { setVisibility: vi.fn(), onVisibilityApplied: () => () => {} },
      browserTab: { setBounds }
    }
  })
  sash = document.createElement('div')
  sash.className = 'dv-sash'
  document.body.append(sash)

  resetOverlayGuard()
  usePreviewStore.getState().reset()
  useOverlayOccluderStore.getState().reset()
  usePreviewCollapsedStore.setState({ collapsed: new Set() })
  // One browser tab, placed and active: the guard shows it.
  browserViewBounds.register(TAB, PANEL)
  browserViewBounds.place(TAB, PLACEMENT)
  getOverlayGuard().sync(PANEL)
})

afterEach(() => {
  resetOverlayGuard()
  browserViewBounds.unregister(TAB)
  sash.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useSplitterDragFreeze – browser tab views', () => {
  it('hides the shown browser page through the guard', async () => {
    renderHook(() => useSplitterDragFreeze())
    expect(lastVisible()).toBe(true)
    expect(getOverlayGuard().visiblePanelId()).toBe(PANEL)

    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
    await flushMicrotasks()
    expect(lastVisible()).toBe(false)
  })

  it('holds moves until main confirms the hide, then pushes bounds before the page returns', async () => {
    const push = vi.fn(() => {
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      return true
    })
    renderHook(() => {
      useSplitterDragFreeze()
      usePreviewDragFreezeTarget(PANEL, push)
    })

    dragStart()
    await flushMicrotasks()
    const held = pointer('pointermove', 140, 1)
    const reachedDockview = vi.fn()
    document.addEventListener('pointermove', reachedDockview)
    sash.dispatchEvent(held)
    expect(reachedDockview).not.toHaveBeenCalled()

    browserViewBounds.reportApplied(TAB, false)
    sash.dispatchEvent(pointer('pointermove', 160, 1))
    expect(reachedDockview).toHaveBeenCalledTimes(1)
    document.removeEventListener('pointermove', reachedDockview)

    dragEnd()
    frame()
    frame()
    expect(push).toHaveBeenCalledTimes(1)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    await flushMicrotasks()
    expect(lastVisible()).toBe(true)
  })

  it('without main’s confirmation, never moves the layout and logs the unconfirmed hide', async () => {
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    await flushMicrotasks()
    dragEnd()

    expect(log.warn).toHaveBeenCalledWith(DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.hideUnconfirmed,
      panelId: PANEL
    })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('abandons the hold when the tab goes away mid-drag', async () => {
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    await flushMicrotasks()

    browserViewBounds.unregister(TAB)
    expect(log.info).toHaveBeenCalledWith(DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.holdAbandoned,
      panelId: PANEL
    })
  })

  it('does nothing when the browser tab is not on screen', () => {
    getOverlayGuard().sync('editor-1')
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('does nothing for a collapsed browser panel, which is already hidden', () => {
    usePreviewCollapsedStore.getState().setCollapsed(PANEL)
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('ignores a confirmation for a tab it does not know', async () => {
    renderHook(() => useSplitterDragFreeze())
    dragStart()
    await flushMicrotasks()
    browserViewBounds.reportApplied('browser-tab-9', false)
    dragEnd()
    expect(log.warn).toHaveBeenCalledWith(DRAG_FREEZE_LOG_MESSAGE, {
      reason: DRAG_FREEZE_LOG_REASON.hideUnconfirmed,
      panelId: PANEL
    })
  })
})
