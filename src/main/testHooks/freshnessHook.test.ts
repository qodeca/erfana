// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The file-freshness test hook (#478 S0) over a fake watch layer: each
 * operation does what the e2e gap tests rely on, and nothing more – a call
 * that is not armed passes through unchanged.
 */
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import {
  createFreshnessTestHook,
  type DrivablePowerMonitor,
  type WatchEntryView,
  type WatcherInternals,
  type WatchSubscriptionView,
  type WritableFiles
} from './freshnessHook'

const STARTED = { status: 'started', stamp: { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' }, liveRefresh: 'full' } as const
const INPUT = {
  owner: { kind: 'window', webContentsId: 1 },
  watchId: '00000000-0000-4000-8000-000000000001',
  filePath: '/p/a.md',
  profile: 'editor'
} as const

function entry(): WatchEntryView & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => {})
  return { watcher: { close }, close }
}

function setup() {
  const subscribe = vi.fn(async () => STARTED)
  const deliver = vi.fn()
  const entries = new Map<string, WatchEntryView>()
  const stats = { totalWatched: 0, subscriptions: 0, paused: 0 }
  const subs: WatchSubscriptionView[] = []
  let cap = 100
  const wakeOrder: string[] = []
  const watcher: WatcherInternals = {
    subscribe,
    getStats: () => ({ ...stats, totalWatched: entries.size }),
    setBucketCap: (_bucket, totalCap) => {
      const previous = cap
      cap = totalCap
      return previous
    },
    entries,
    subscriptions: { all: () => subs },
    deliver,
    rearmAll: vi.fn(async () => {
      wakeOrder.push('rearm')
    }),
    runHealthRound: vi.fn(async () => {
      wakeOrder.push('health')
    }),
    checkInProcessOwners: vi.fn(() => {
      wakeOrder.push('owners')
    })
  }
  const writeFile = vi.fn(async (_path: string, _content: string, _options?: unknown) => ({}))
  const files: WritableFiles = { write: writeFile }
  const powerMonitor: DrivablePowerMonitor = new EventEmitter()
  const hook = createFreshnessTestHook({ watcher, files, powerMonitor })
  return { hook, watcher, subscribe, deliver, files, writeFile, powerMonitor, stats, subs, entries, wakeOrder, cap: () => cap }
}

describe('createFreshnessTestHook', () => {
  it('counts watched files, subscriptions and paused subscriptions from the service stats', () => {
    const { hook, entries, stats } = setup()
    expect(hook.watchStats()).toMatchObject({ totalWatched: 0, subscriptions: 0, paused: 0 })
    entries.set('/p/a.md', entry())
    entries.set('/p/b.md', entry())
    stats.subscriptions = 4
    stats.paused = 1
    expect(hook.watchStats()).toMatchObject({ totalWatched: 2, subscriptions: 4, paused: 1 })
  })

  it('counts the files and attached subscriptions of windows apart from in-process owners', () => {
    const { hook, subs } = setup()
    const window = { kind: 'window' } as const
    subs.push(
      { owner: window, entryKey: 'a' },
      { owner: window, entryKey: 'a' },
      { owner: window, entryKey: 'b' },
      { owner: window, entryKey: null },
      { owner: { kind: 'process' }, entryKey: 'a' },
      { owner: { kind: 'process' }, entryKey: 'c' }
    )
    expect(hook.watchStats()).toMatchObject({ tabWatches: 2, tabSubscriptions: 3 })
  })

  it('sets the tabs bucket cap and returns the previous one; refuses a bad limit', () => {
    const { hook, cap } = setup()
    expect(hook.setWatchLimit(2)).toBe(100)
    expect(cap()).toBe(2)
    expect(() => hook.setWatchLimit(-1)).toThrow(/Invalid watch limit/)
    expect(() => hook.setWatchLimit(1.5)).toThrow(/Invalid watch limit/)
    expect(cap()).toBe(2)
  })

  it('refuses exactly the next subscribe with the code, then passes through', async () => {
    const { hook, watcher, subscribe } = setup()
    await expect(watcher.subscribe(INPUT)).resolves.toEqual(STARTED)
    expect(subscribe).toHaveBeenCalledTimes(1)

    hook.failNextSubscribe('WATCH_FAILED')
    expect(hook.pendingSubscribeFailure()).toBe('WATCH_FAILED')
    await expect(watcher.subscribe(INPUT)).resolves.toEqual({ status: 'refused', code: 'WATCH_FAILED' })
    expect(hook.pendingSubscribeFailure()).toBeNull()
    expect(subscribe).toHaveBeenCalledTimes(1)

    await watcher.subscribe(INPUT)
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('lets an in-process owner subscribe past an armed failure, which the next window subscribe takes', async () => {
    const { hook, watcher, subscribe } = setup()
    hook.failNextSubscribe('WATCH_FAILED')
    const process = { ...INPUT, owner: { kind: 'process', ownerId: 'comments', onEvent: () => undefined } } as const
    await expect(watcher.subscribe(process)).resolves.toEqual(STARTED)
    expect(hook.pendingSubscribeFailure()).toBe('WATCH_FAILED')
    await expect(watcher.subscribe(INPUT)).resolves.toEqual({ status: 'refused', code: 'WATCH_FAILED' })
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown refusal code', () => {
    const { hook } = setup()
    expect(() => hook.failNextSubscribe('NOT_A_CODE')).toThrow(/Unknown subscribe refusal code/)
    expect(hook.pendingSubscribeFailure()).toBeNull()
  })

  it('drops watch events only while muted', () => {
    const { hook, watcher, deliver } = setup()
    watcher.deliver([], { kind: 'changed' })
    hook.muteWatchEvents(true)
    watcher.deliver([], { kind: 'changed' })
    hook.muteWatchEvents(false)
    watcher.deliver([], { kind: 'deleted' })
    expect(deliver.mock.calls.map(call => (call[1] as { kind: string }).kind)).toEqual(['changed', 'deleted'])
  })

  it('closes every native watcher and keeps the entries listed', async () => {
    const { hook, watcher } = setup()
    const a = entry()
    const b = entry()
    b.close.mockRejectedValueOnce(new Error('already closed'))
    const entries = watcher.entries as Map<string, WatchEntryView>
    entries.set('/p/a.md', a)
    entries.set('/p/b.md', b)
    await expect(hook.killWatchesSilently()).resolves.toBe(2)
    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(hook.watchStats().totalWatched).toBe(2)
  })

  it('emits resume on the power monitor, which re-arms, runs a health round, then checks owners', async () => {
    const { hook, powerMonitor, wakeOrder } = setup()
    const onResume = vi.fn()
    powerMonitor.on('resume', onResume)
    hook.simulateResume()
    expect(onResume).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(wakeOrder).toEqual(['rearm', 'health', 'owners']))
  })

  it('holds the next write until released, and only that one', async () => {
    const { hook, files, writeFile } = setup()
    hook.holdNextWrite()
    expect(hook.writeHeld()).toBe(false)
    const held = files.write('/p/a.md', 'one')
    await vi.waitFor(() => expect(hook.writeHeld()).toBe(true))
    expect(writeFile).not.toHaveBeenCalled()

    await files.write('/p/a.md', 'two') // not armed: straight through
    expect(writeFile).toHaveBeenCalledWith('/p/a.md', 'two', undefined)

    hook.releaseWrite()
    await held
    expect(hook.writeHeld()).toBe(false)
    expect(writeFile).toHaveBeenLastCalledWith('/p/a.md', 'one', undefined)
  })

  it('disarms a hold that no write reached', async () => {
    const { hook, files, writeFile } = setup()
    hook.holdNextWrite()
    hook.releaseWrite()
    await files.write('/p/a.md', 'one')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(hook.writeHeld()).toBe(false)
  })
})
