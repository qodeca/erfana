// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The renderer's IPC freshness source (#478 S12): one bridge listener per
 * window however many trackers listen, events validated before any tracker
 * sees them, a throwing listener contained, and the bridge's request objects.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { createIpcFreshnessSource, createPausableIpcSource, type FreshnessBridge } from './ipcFreshnessSource'

const WATCH_ID = '00000000-0000-4000-8000-000000000001'

function fakeBridge() {
  let emit: (event: unknown) => void = () => {}
  const stop = vi.fn()
  const bridge = {
    subscribe: vi.fn(async () => ({ status: 'queued' as const })),
    unsubscribe: vi.fn(async () => ({ success: true })),
    probe: vi.fn(async () => ({ status: 'missing' as const })),
    readText: vi.fn(async () => ({ status: 'missing' as const })),
    pauseWatch: vi.fn(async () => ({ success: true })),
    resumeWatch: vi.fn(async () => ({ success: true, missed: true })),
    writeText: vi.fn(async () => ({ status: 'changed-on-disk' as const, stamp: null })),
    onEvent: vi.fn((listener: (event: unknown) => void) => {
      emit = listener
      return stop
    })
  }
  return { bridge: bridge as unknown as FreshnessBridge & typeof bridge, emit: (event: unknown) => emit(event), stop }
}

describe('createIpcFreshnessSource', () => {
  it('holds one bridge listener for any number of trackers, and drops it with the last', () => {
    const { bridge, emit, stop } = fakeBridge()
    const source = createIpcFreshnessSource(bridge)
    const first = vi.fn()
    const second = vi.fn()

    const offFirst = source.onEvent(first)
    const offSecond = source.onEvent(second)
    emit({ watchId: WATCH_ID, kind: 'changed' })

    expect(bridge.onEvent).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith({ watchId: WATCH_ID, kind: 'changed' })
    expect(second).toHaveBeenCalledWith({ watchId: WATCH_ID, kind: 'changed' })

    offFirst()
    expect(stop).not.toHaveBeenCalled()
    offSecond()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('drops a malformed event before any tracker sees it', () => {
    const { bridge, emit } = fakeBridge()
    const source = createIpcFreshnessSource(bridge)
    const listener = vi.fn()
    source.onEvent(listener)

    emit({ watchId: 'not-a-uuid', kind: 'changed' })
    emit({ watchId: WATCH_ID, kind: 'exploded' })
    emit(null)

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps delivering to the others when one listener throws', () => {
    const { bridge, emit } = fakeBridge()
    const source = createIpcFreshnessSource(bridge)
    const after = vi.fn()
    source.onEvent(() => {
      throw new Error('tracker failed')
    })
    source.onEvent(after)

    emit({ watchId: WATCH_ID, kind: 'deleted' })

    expect(after).toHaveBeenCalledTimes(1)
  })

  it('sends one request object per call', async () => {
    const { bridge } = fakeBridge()
    const source = createIpcFreshnessSource(bridge)

    await source.unsubscribe(WATCH_ID)
    await source.probe('/p/a.md')
    await source.probe('/p/a.md', 'hash')
    await source.readText('/p/a.md')

    expect(bridge.unsubscribe).toHaveBeenCalledWith({ watchId: WATCH_ID })
    expect(bridge.probe).toHaveBeenNthCalledWith(1, { filePath: '/p/a.md' })
    expect(bridge.probe).toHaveBeenNthCalledWith(2, { filePath: '/p/a.md', knownHash: 'hash' })
    expect(bridge.readText).toHaveBeenCalledWith({ filePath: '/p/a.md' })
  })
})

describe('createPausableIpcSource', () => {
  it('pauses and resumes by watch id, and answers whether a change was missed', async () => {
    const { bridge } = fakeBridge()
    const pausable = createPausableIpcSource(createIpcFreshnessSource(bridge), bridge)

    await pausable.pause(WATCH_ID)
    await expect(pausable.resumeWatch(WATCH_ID)).resolves.toEqual({ missed: true })

    expect(bridge.pauseWatch).toHaveBeenCalledWith({ watchId: WATCH_ID })
    expect(bridge.resumeWatch).toHaveBeenCalledWith({ watchId: WATCH_ID })
  })

  it('passes the checked write through', async () => {
    const { bridge } = fakeBridge()
    const pausable = createPausableIpcSource(createIpcFreshnessSource(bridge), bridge)
    const request = { filePath: '/p/a.md', content: 'x' }

    await expect(pausable.writeText(request)).resolves.toEqual({ status: 'changed-on-disk', stamp: null })
    expect(bridge.writeText).toHaveBeenCalledWith(request)
  })
})
