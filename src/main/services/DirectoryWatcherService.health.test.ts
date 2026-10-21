// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DirectoryWatcherService health line (issue #208).
 *
 * The 120 s `DirectoryWatcher health` line is the trace a main-process heap
 * exhaustion leaves in `main.log`, so it logs at `info` (the default file
 * level) with the process memory snapshot, and at `warn` when the watcher is
 * stressed.
 *
 * Split from `DirectoryWatcherService.test.ts`, which fakes only the timeout
 * pair on purpose so the health interval stays on real timers there; here the
 * interval is the subject, so only the interval pair is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

const memorySnapshot = vi.hoisted(() => ({
  mainMemoryMb: { rss: 900, heapUsed: 700, heapTotal: 800, external: 20, heapLimit: 4096 },
  processMemoryMb: [
    { type: 'Browser', pid: 100, workingSet: 900, peakWorkingSet: 1200 },
    { type: 'Tab', pid: 200, workingSet: 400, peakWorkingSet: 600 }
  ]
}))

vi.mock('chokidar', () => {
  const watch = vi.fn(() => ({ on: vi.fn(), close: vi.fn(async () => {}) }))
  return { default: { watch }, watch }
})

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async () => undefined) }
}))

vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('../utils/processMemorySnapshot', () => ({
  collectMemorySnapshot: vi.fn(() => memorySnapshot)
}))

import { DirectoryWatcherService } from './DirectoryWatcherService'

const HEALTH_INTERVAL_MS = 120_000
const HEALTH_MESSAGE = 'DirectoryWatcher health'
const webContents = { id: 1 } as unknown as WebContents

function healthCalls(level: 'info' | 'warn' | 'debug'): unknown[][] {
  return mockLogger[level].mock.calls.filter(([message]) => message === HEALTH_MESSAGE)
}

describe('DirectoryWatcherService health line', () => {
  let svc: DirectoryWatcherService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    svc = new DirectoryWatcherService()
    await svc.watchDirectory('/proj', webContents)
  })

  afterEach(async () => {
    await svc.dispose()
    vi.useRealTimers()
  })

  it('AC5: logs at info with the memory snapshot every 120 s', () => {
    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    expect(healthCalls('info')).toEqual([
      [
        HEALTH_MESSAGE,
        expect.objectContaining({
          activeWatchers: 1,
          resourceCount: expect.any(Number),
          mainMemoryMb: memorySnapshot.mainMemoryMb,
          processMemoryMb: memorySnapshot.processMemoryMb
        })
      ]
    ])
    expect(healthCalls('debug')).toHaveLength(0)
    expect(healthCalls('warn')).toHaveLength(0)
  })

  it('logs at warn, still with the memory fields, when the watcher is stressed', () => {
    ;(svc as unknown as { metrics: { recordBufferOverflow: (count: number) => void } }).metrics.recordBufferOverflow(5)

    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    expect(healthCalls('warn')).toEqual([
      [
        HEALTH_MESSAGE,
        expect.objectContaining({
          bufferOverflows: 1,
          mainMemoryMb: memorySnapshot.mainMemoryMb,
          processMemoryMb: memorySnapshot.processMemoryMb
        })
      ]
    ])
    expect(healthCalls('info')).toHaveLength(0)
  })

  it('#211: carries the path-filter and native-backend counters', () => {
    const metrics = (svc as unknown as {
      metrics: {
        recordEventFiltered: () => void
        recordNativeOverflow: () => void
        recordMatcherBudgetExceeded: (count: number) => void
      }
    }).metrics
    metrics.recordEventFiltered()
    metrics.recordEventFiltered()
    metrics.recordNativeOverflow()
    metrics.recordMatcherBudgetExceeded(3)

    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    // A native overflow alone is not stress: a split-folder overflow is a cheap re-list
    expect(healthCalls('info')).toEqual([
      [
        HEALTH_MESSAGE,
        expect.objectContaining({
          eventsFiltered: 2,
          nativeOverflows: 1,
          nativeResyncs: 0,
          matcherBudgetExceeded: 3
        })
      ]
    ])
    expect(healthCalls('warn')).toHaveLength(0)
  })

  it('#211: logs at warn once the native backend asked for a resync', () => {
    ;(svc as unknown as { metrics: { recordNativeResync: () => void } }).metrics.recordNativeResync()

    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    expect(healthCalls('warn')).toEqual([
      [HEALTH_MESSAGE, expect.objectContaining({ nativeResyncs: 1, bufferOverflows: 0 })]
    ])
    expect(healthCalls('info')).toHaveLength(0)
  })

  it('#211: logs the next line at info when no new resync came since', () => {
    const metrics = (svc as unknown as { metrics: { recordNativeResync: () => void } }).metrics
    metrics.recordNativeResync()

    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)
    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    expect(healthCalls('warn')).toHaveLength(1)
    expect(healthCalls('info')).toEqual([[HEALTH_MESSAGE, expect.objectContaining({ nativeResyncs: 1 })]])

    metrics.recordNativeResync()
    vi.advanceTimersByTime(HEALTH_INTERVAL_MS)

    expect(healthCalls('warn')).toEqual([
      [HEALTH_MESSAGE, expect.objectContaining({ nativeResyncs: 1 })],
      [HEALTH_MESSAGE, expect.objectContaining({ nativeResyncs: 2 })]
    ])
  })

  it('logs nothing before the first interval and nothing after stopAll()', async () => {
    vi.advanceTimersByTime(HEALTH_INTERVAL_MS - 1)
    expect(healthCalls('info')).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(healthCalls('info')).toHaveLength(1)

    await svc.stopAll()
    vi.advanceTimersByTime(HEALTH_INTERVAL_MS * 3)
    expect(healthCalls('info')).toHaveLength(1)
  })
})
