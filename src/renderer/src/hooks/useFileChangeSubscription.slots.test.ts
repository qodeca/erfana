// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image adapter's watch balance and visibility (#70, #478 plan S15, S1):
 * every subscribe is matched by one unsubscribe across path changes and
 * remounts, and a hidden tab marks a change without reading it until shown.
 *
 * @module useFileChangeSubscription.slots.test
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WATCHED_PATH, installImageWatchHarness, openImageTab } from './__test__/fileWatchHarness'
import { useFileChangeSubscription } from './useFileChangeSubscription'

const SETTLED_MS = 3_000
const OTHER_PATH = '/proj/other.png'

const h = installImageWatchHarness()

describe('useFileChangeSubscription – watch balance', () => {
  it('releases the old watch when the tab moves to another file', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    h.disk.write(OTHER_PATH, 'png-other', { silent: true })
    const options = { ready: true, visible: true, currentVersion: undefined, onBytes: vi.fn() }
    const hook = renderHook(({ path }: { path: string }) => useFileChangeSubscription(path, options), {
      initialProps: { path: WATCHED_PATH }
    })
    await h.flush()

    hook.rerender({ path: OTHER_PATH })
    await h.flush()
    expect(h.source.subscribeCalls.map(c => c.filePath)).toEqual([WATCHED_PATH, OTHER_PATH])
    expect([...h.source.subscriptions.values()].map(s => s.filePath)).toEqual([OTHER_PATH])

    hook.unmount()
    await h.flush()
    expect(h.source.subscriptions.size).toBe(0)
  })

  it('leaves no subscription behind after many mounts and unmounts', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    for (let i = 0; i < 5; i++) {
      const tab = await openImageTab(h)
      tab.hook.unmount()
      await h.flush()
    }
    expect(h.source.subscriptions.size).toBe(0)
    expect(h.source.listenerCount).toBe(0)
  })
})

describe('useFileChangeSubscription – a hidden tab (S1)', () => {
  it('marks a change while hidden and reads it when shown', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h, WATCHED_PATH, { visible: false })
    h.readImage.mockClear()

    h.disk.write(WATCHED_PATH, 'png-2')
    await h.run(SETTLED_MS)
    expect(h.readImage).not.toHaveBeenCalled()
    expect(tab.onBytes).not.toHaveBeenCalled()

    tab.setVisible(true)
    await h.run(SETTLED_MS)
    expect(tab.onBytes).toHaveBeenCalledTimes(1)
    expect(tab.shown()).toBe(h.disk.stamp(WATCHED_PATH)?.hash)
  })
})
