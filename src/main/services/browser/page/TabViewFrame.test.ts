// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A tab's page view in its window (025-FR-007, 025-FR-012, ADR 0011
 * decision 6): stale pushes dropped, hidden tabs detached, the clipping
 * parent placed on the page area, presets re-placed at once.
 */
import { describe, expect, it, vi } from 'vitest'
import { TabViewFrame, type ClipView, type FrameHost } from './TabViewFrame'

const AREA = { x: 320, y: 80, width: 860, height: 620 }

function setup(withClip: boolean) {
  let destroyed = false
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const host: FrameHost = {
    isDestroyed: () => destroyed,
    getContentBounds: () => ({ width: 1200, height: 800 }),
    contentView,
    webContents: { getZoomFactor: () => 1 }
  }
  const view = { setBounds: vi.fn() }
  const clip = withClip ? { setBounds: vi.fn(), addChildView: vi.fn<ClipView['addChildView']>() } : null
  const onShown = vi.fn()
  const onPageMoved = vi.fn()
  const frame = new TabViewFrame({ host, view, clip, onShown, onPageMoved })
  return { frame, host, view, clip, contentView, onShown, onPageMoved, destroy: () => (destroyed = true) }
}

describe('TabViewFrame', () => {
  it('puts the page view in its clipping parent once, and the parent in the window when shown', () => {
    const { frame, view, clip, contentView, onShown } = setup(true)
    expect(clip!.addChildView).toHaveBeenCalledWith(view)
    expect(frame.push({ bounds: AREA, clip: AREA }, 1, true)).toBe(true)
    expect(contentView.addChildView).toHaveBeenCalledWith(clip)
    expect(clip!.setBounds).toHaveBeenCalledWith(AREA)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 860, height: 620 })
    expect(onShown).toHaveBeenCalledWith(true)
    expect(frame.isAttached()).toBe(true)
    expect(frame.placement()?.view).toEqual(AREA)
  })

  it('without a clipping parent puts the page view straight into the window', () => {
    const { frame, view, contentView } = setup(false)
    frame.push({ bounds: AREA, clip: AREA }, 1, true)
    expect(contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith(AREA)
  })

  it('drops a push older than the last applied one, and answers null once the window is gone', () => {
    const { frame, view, destroy } = setup(false)
    frame.push({ bounds: AREA, clip: AREA }, 5, true)
    expect(frame.push({ bounds: AREA, clip: AREA }, 5, true)).toBeNull()
    expect(frame.push({ bounds: AREA, clip: AREA }, 4, true)).toBeNull()
    expect(view.setBounds).toHaveBeenCalledTimes(1)
    destroy()
    expect(frame.push({ bounds: AREA, clip: AREA }, 6, true)).toBeNull()
  })

  it('025-AC-007 detaches a hidden tab without destroying it, and reports the move only while shown', () => {
    const { frame, clip, contentView, onShown, onPageMoved } = setup(true)
    frame.push({ bounds: AREA, clip: AREA }, 1, true)
    frame.push({ bounds: { ...AREA, y: 120 }, clip: { ...AREA, y: 120 } }, 2, true)
    expect(onPageMoved).toHaveBeenCalledTimes(1)
    expect(frame.push({ bounds: AREA, clip: AREA }, 3, false)).toBe(false)
    expect(contentView.removeChildView).toHaveBeenCalledWith(clip)
    expect(onShown).toHaveBeenLastCalledWith(false)
    expect(frame.placement()).toBeNull()
    frame.push({ bounds: AREA, clip: AREA }, 4, true)
    expect(onPageMoved).toHaveBeenCalledTimes(1)
    frame.detach()
    frame.detach()
    expect(contentView.removeChildView).toHaveBeenCalledTimes(2)
  })

  it('025-AC-012 re-places the view at once when the preset changes, and ignores the same preset', () => {
    const { frame, view } = setup(true)
    frame.setPreset('phone')
    expect(view.setBounds).not.toHaveBeenCalled()
    frame.push({ bounds: AREA, clip: AREA }, 1, true)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 235, y: 0, width: 390, height: 620 })
    frame.setPreset('tablet')
    expect(frame.widthPreset).toBe('tablet')
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 46, y: 0, width: 768, height: 620 })
    const calls = view.setBounds.mock.calls.length
    frame.setPreset('tablet')
    expect(view.setBounds).toHaveBeenCalledTimes(calls)
  })
})
