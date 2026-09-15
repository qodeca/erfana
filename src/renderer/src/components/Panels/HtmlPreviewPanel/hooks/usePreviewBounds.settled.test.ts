// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds – the settled push (issue #124, part 1 §1.5, WI-11).
 *
 * When a window-edge resize ends, main asks for the panel's settled bounds
 * (`resizeHold {held: false}`) and ends its hold on the push that carries
 * `settled: true`. The push is forced – sent even when the rect is unchanged,
 * because a settled layout that moved nothing must still be answered – and the
 * flag rides on that one push only.
 *
 * Split from `usePreviewBounds.test.ts`, which sits near the 500-line cap.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewBounds, type UsePreviewBoundsOptions } from './usePreviewBounds'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../utils/logger', () => ({ logger: log }))

const PANEL_ID = 'preview-panel-1'
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }
const BOUNDS = { x: 477, y: 41, width: 400, height: 827 }

type Rect = typeof LAID_OUT

let rafQueue = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
let setBounds: ReturnType<typeof vi.fn>

function frame(): void {
  const due = [...rafQueue.values()]
  rafQueue = new Map()
  for (const cb of due) cb(0)
}

function makePlaceholder(initial: Rect): { el: HTMLElement; layout: (rect: Rect) => void } {
  const el = document.createElement('div')
  let rect = initial
  el.getBoundingClientRect = (): DOMRect =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  return { el, layout: (next) => { rect = next } }
}

function mountHook(el: HTMLElement, initialProps: Partial<UsePreviewBoundsOptions> = {}) {
  const placeholderRef = { current: el }
  return renderHook(
    (props: Partial<UsePreviewBoundsOptions>) =>
      usePreviewBounds({ placeholderRef, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false, ...props }),
    { initialProps }
  )
}

beforeEach(() => {
  rafQueue = new Map()
  nextFrameId = 1
  for (const fn of Object.values(log)) fn.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextFrameId++
    rafQueue.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id)
  })
  setBounds = vi.fn()
  Object.defineProperty(window, 'api', { configurable: true, value: { preview: { setBounds } } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePreviewViewportStore.setState({ rects: new Map() })
})

describe('usePreviewBounds – the settled push (#124 §1.5)', () => {
  it('sends an unchanged rect with settled: true', () => {
    const { el } = makePlaceholder(LAID_OUT)
    const { result } = mountHook(el)
    frame()
    expect(setBounds).toHaveBeenCalledTimes(1)

    expect(result.current.pushBounds({ settled: true })).toBe(true)

    expect(setBounds).toHaveBeenCalledTimes(2)
    expect(setBounds).toHaveBeenLastCalledWith(PANEL_ID, BOUNDS, 1, { settled: true })
  })

  it('puts settled on that push only: the plain forced push and the loop stay three-argument', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    const { result } = mountHook(el)
    result.current.pushBounds({ settled: true })

    result.current.pushBounds()
    expect(setBounds.mock.calls.at(-1)).toHaveLength(3)

    layout({ ...LAID_OUT, left: 500 })
    frame()
    expect(setBounds.mock.calls.at(-1)).toEqual([PANEL_ID, { ...BOUNDS, x: 500 }, 3])
  })

  it('carries ack and settled together when the push also has to prove the inset', () => {
    const { el } = makePlaceholder(LAID_OUT)
    // Nothing proven yet (hidden), so every push asks for proof.
    const ackController = { provenInset: () => -1, recordPush: vi.fn() }
    const { result } = mountHook(el, { ackController })

    result.current.pushBounds({ settled: true })

    expect(setBounds).toHaveBeenLastCalledWith(PANEL_ID, BOUNDS, 1, { ack: true, settled: true })
    expect(ackController.recordPush).toHaveBeenLastCalledWith(1, 0, true)
  })

  it('sends nothing, and says so, when there is no rect to settle', () => {
    const { el } = makePlaceholder({ ...LAID_OUT, width: 0 })
    const { result } = mountHook(el)
    setBounds.mockClear()

    expect(result.current.pushBounds({ settled: true })).toBe(false)
    expect(setBounds).not.toHaveBeenCalled()
  })

  it('sends nothing for a disabled panel', () => {
    const { el } = makePlaceholder(LAID_OUT)
    const { result } = mountHook(el, { enabled: false })
    expect(result.current.pushBounds({ settled: true })).toBe(false)
    expect(setBounds).not.toHaveBeenCalled()
  })
})
