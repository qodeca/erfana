// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image adapter on the shared freshness tracker (#478, plan S15): the
 * subscription's life, new bytes for an outside change, no bytes when the
 * version on screen is still current, and the transient indicator.
 *
 * @module useFileChangeSubscription.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INDICATOR_DURATION_MS } from '../constants/fileWatch'
import { WATCHED_PATH, installImageWatchHarness, openImageTab } from './__test__/fileWatchHarness'

/** Past the tracker's throttle and read retries. */
const SETTLED_MS = 3_000

const h = installImageWatchHarness()

afterEach(() => {
  vi.useRealTimers()
})

describe('useFileChangeSubscription – lifecycle', () => {
  it('subscribes once with the image profile, and releases the watch on unmount', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    expect(h.source.subscribeCalls).toHaveLength(1)
    expect(h.source.subscribeCalls[0]).toMatchObject({ filePath: WATCHED_PATH, profile: 'image' })

    tab.hook.unmount()
    await h.flush()
    expect(h.source.unsubscribeCalls).toEqual([h.source.subscribeCalls[0].watchId])
  })

  it('follows nothing for an empty path or before the first image is on screen', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    await openImageTab(h, '')
    await openImageTab(h, WATCHED_PATH, { ready: false })
    expect(h.source.subscribeCalls).toHaveLength(0)
  })
})

describe('useFileChangeSubscription – refresh', () => {
  it('hands the viewer the new bytes of an outside change, once', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    h.disk.write(WATCHED_PATH, 'png-2')
    await h.run(SETTLED_MS)

    expect(tab.onBytes).toHaveBeenCalledTimes(1)
    expect(tab.shown()).toBe(h.disk.stamp(WATCHED_PATH)?.hash)
    expect(tab.onBytes.mock.calls[0][0].stamp).toEqual(h.disk.stamp(WATCHED_PATH))
  })

  it('reads with the version on screen, and shows nothing new for the same bytes', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    h.disk.touch(WATCHED_PATH)
    act(() => h.check())
    await h.run(SETTLED_MS)

    expect(tab.onBytes).not.toHaveBeenCalled()
    for (const [request] of h.readImage.mock.calls) {
      expect(request).toEqual({ filePath: WATCHED_PATH, knownVersion: tab.shown() })
    }
  })

  it('raises the indicator for INDICATOR_DURATION_MS when the viewer marks a refresh', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const tab = await openImageTab(h)

    act(() => tab.hook.result.current.markReloaded())
    expect(tab.hook.result.current.isReloading).toBe(true)

    act(() => {
      vi.advanceTimersByTime(INDICATOR_DURATION_MS)
    })
    expect(tab.hook.result.current.isReloading).toBe(false)
  })
})
