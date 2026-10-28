// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-window registry of resize holds (issue #124, QG-6 A4): one hold per
 * window, over that window's views only; made by a `will-resize`, never by a
 * bare `resized`; and dropped – timers and all – with its window or on
 * dispose. One window's hold is covered by `previewResizeHold.test.ts`, and
 * the service's delegation by `PreviewViewService.resizeHold.test.ts`. Fake
 * timers only.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { createResizeHoldRegistry, type PreviewResizeHoldView } from './previewResizeHold'

const SETTLE = PREVIEW_LIMITS.RESIZE_HOLD_SETTLE_TIMEOUT_MS
const IDLE = PREVIEW_LIMITS.RESIZE_HOLD_MAX_IDLE_MS

/** A view's visibility owner, as the hold drives it. */
interface FakeTarget {
  hold: Mock<() => void>
  release: Mock<() => void>
  isWanted: Mock<() => boolean>
}

const makeTarget = (): FakeTarget => ({
  hold: vi.fn(),
  release: vi.fn(),
  isWanted: vi.fn(() => true)
})

/** A registry over two windows: `preview-a` shown in window 1, `preview-b` in window 2. */
function setup() {
  const a = makeTarget()
  const b = makeTarget()
  const byWindow = new Map<number, readonly PreviewResizeHoldView[]>([
    [1, [{ panelId: 'preview-a', target: a }]],
    [2, [{ panelId: 'preview-b', target: b }]]
  ])
  const views = vi.fn((windowId: number) => byWindow.get(windowId) ?? [])
  const resizeHold = vi.fn<(panelId: string, held: boolean) => void>()
  const registry = createResizeHoldRegistry({ views, emit: { resizeHold }, now: () => 0 })
  return { a, b, views, resizeHold, registry }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createResizeHoldRegistry – one hold per window', () => {
  it('holds the shown views of the window being resized, and asks no other window', () => {
    const { a, b, views, resizeHold, registry } = setup()

    registry.set(1, true)

    expect(views).toHaveBeenCalledWith(1)
    expect(views).not.toHaveBeenCalledWith(2)
    expect(a.hold).toHaveBeenCalledTimes(1)
    expect(b.hold).not.toHaveBeenCalled()
    expect(resizeHold.mock.calls).toEqual([['preview-a', true]])
  })

  it('a resized with no will-resize before it makes no hold', () => {
    const { a, views, resizeHold, registry } = setup()

    registry.set(1, false)
    registry.boundsApplied(1, 'preview-a', true)

    expect(views).not.toHaveBeenCalled()
    expect(resizeHold).not.toHaveBeenCalled()
    expect(a.release).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a settled push ends the hold of its own window only', () => {
    const { a, b, registry } = setup()
    registry.set(1, true)
    registry.set(2, true)
    registry.set(1, false)
    registry.set(2, false)

    registry.boundsApplied(2, 'preview-a', true)
    expect(a.release).not.toHaveBeenCalled()

    registry.boundsApplied(1, 'preview-a', true)
    expect(a.release).toHaveBeenCalledTimes(1)
    expect(b.release).not.toHaveBeenCalled()
  })

  it('a plain push is not a settle: it shows the view only at the second timeout', () => {
    const { a, registry } = setup()
    registry.set(1, true)
    registry.set(1, false)

    registry.boundsApplied(1, 'preview-a', false)
    vi.advanceTimersByTime(SETTLE)
    expect(a.release).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SETTLE)
    expect(a.release).toHaveBeenCalledTimes(1)
  })
})

describe('createResizeHoldRegistry – a hold goes with its window', () => {
  it('closeWindow drops that window’s hold, timers and all, and leaves the other window’s', () => {
    const { resizeHold, registry } = setup()
    registry.set(1, true)
    registry.set(2, true)
    expect(vi.getTimerCount()).toBe(2)

    registry.closeWindow(1)

    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(IDLE)
    expect(resizeHold.mock.calls).toEqual([
      ['preview-a', true],
      ['preview-b', true],
      ['preview-b', false]
    ])
  })

  it('after closeWindow, a will-resize for that window id starts a fresh hold', () => {
    const { a, registry } = setup()
    registry.set(1, true)
    registry.closeWindow(1)

    registry.set(1, true)

    expect(a.hold).toHaveBeenCalledTimes(2)
  })

  it('dispose drops every window’s hold, emitting nothing', () => {
    const { resizeHold, registry } = setup()
    registry.set(1, true)
    registry.set(2, true)

    registry.dispose()
    vi.advanceTimersByTime(IDLE * 2)

    expect(vi.getTimerCount()).toBe(0)
    expect(resizeHold.mock.calls).toEqual([
      ['preview-a', true],
      ['preview-b', true]
    ])
  })
})
