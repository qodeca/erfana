// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const still = vi.hoisted(() => ({ hold: vi.fn(), release: vi.fn() }))
vi.mock('../../../services/browser/browserStill', () => ({ browserStill: still }))

import { useStillSurface } from './useStillSurface'

/** A hold that resolves when the test says so. */
function deferredHold(): () => void {
  let done: () => void = () => undefined
  still.hold.mockReturnValueOnce(new Promise<void>(resolve => (done = resolve)))
  return () => done()
}

describe('useStillSurface', () => {
  beforeEach(() => {
    still.hold.mockReset()
    still.release.mockReset()
  })

  it('shows at once with no tab, and holds nothing', () => {
    const { result } = renderHook(() => useStillSurface(null, 'more'))
    const show = vi.fn()
    result.current.open(show)
    expect(show).toHaveBeenCalledOnce()
    expect(still.hold).not.toHaveBeenCalled()
    result.current.close()
    expect(still.release).not.toHaveBeenCalled()
  })

  it('shows once the picture is up, and releases on close', async () => {
    const done = deferredHold()
    const { result } = renderHook(() => useStillSurface('tab-1', 'more'))
    const show = vi.fn()
    result.current.open(show)
    expect(still.hold).toHaveBeenCalledWith('tab-1', 'more')
    expect(show).not.toHaveBeenCalled()
    await act(async () => done())
    expect(show).toHaveBeenCalledOnce()
    result.current.close()
    expect(still.release).toHaveBeenCalledWith('tab-1', 'more')
  })

  it('drops a show whose open was closed before the picture arrived', async () => {
    const done = deferredHold()
    const { result } = renderHook(() => useStillSurface('tab-1', 'suggest'))
    const show = vi.fn()
    result.current.open(show)
    result.current.close()
    await act(async () => done())
    expect(show).not.toHaveBeenCalled()
  })

  it('keeps the same surface across renders and releases on a tab change and unmount', () => {
    const { result, rerender, unmount } = renderHook(({ tab }) => useStillSurface(tab, 'target'), { initialProps: { tab: 'tab-1' } })
    const first = result.current
    rerender({ tab: 'tab-1' })
    expect(result.current).toBe(first)
    rerender({ tab: 'tab-2' })
    expect(still.release).toHaveBeenCalledWith('tab-1', 'target')
    unmount()
    expect(still.release).toHaveBeenCalledWith('tab-2', 'target')
  })
})
