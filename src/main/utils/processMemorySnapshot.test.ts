// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the process memory snapshot on the watcher health line (#208).
 *
 * The snapshot is what `main.log` has to go on when the main process runs out
 * of heap, so it must report MB values that are easy to read and must never
 * throw – a failing source degrades to `memoryError` and the other source is
 * still reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import v8 from 'v8'

const getAppMetrics = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ app: { getAppMetrics } }))

import { collectMemorySnapshot } from './processMemorySnapshot'

const MB = 1024 * 1024

beforeEach(() => {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 512.4 * MB,
    heapUsed: 300.6 * MB,
    heapTotal: 400 * MB,
    external: 12.2 * MB,
    arrayBuffers: 1 * MB
  })
  vi.spyOn(v8, 'getHeapStatistics').mockReturnValue({
    heap_size_limit: 4096 * MB
  } as ReturnType<typeof v8.getHeapStatistics>)
  getAppMetrics.mockReturnValue([
    { type: 'Browser', pid: 100, memory: { workingSetSize: 204_800, peakWorkingSetSize: 307_700 } },
    { type: 'Tab', pid: 200, memory: { workingSetSize: 1_536, peakWorkingSetSize: 2_047 } }
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  getAppMetrics.mockReset()
})

describe('collectMemorySnapshot', () => {
  it('AC5: reports main-process memory in rounded MB, including the heap limit', () => {
    expect(collectMemorySnapshot().mainMemoryMb).toEqual({
      rss: 512,
      heapUsed: 301,
      heapTotal: 400,
      external: 12,
      heapLimit: 4096
    })
  })

  it('maps every Electron process to type, pid and working sets in MB', () => {
    const snapshot = collectMemorySnapshot()

    expect(snapshot.processMemoryMb).toEqual([
      { type: 'Browser', pid: 100, workingSet: 200, peakWorkingSet: 300 },
      { type: 'Tab', pid: 200, workingSet: 2, peakWorkingSet: 2 }
    ])
    expect(snapshot.memoryError).toBeUndefined()
  })

  it('keeps main memory and reports memoryError when getAppMetrics throws', () => {
    getAppMetrics.mockImplementation(() => {
      throw new Error('app not ready')
    })

    let snapshot: ReturnType<typeof collectMemorySnapshot> | undefined
    expect(() => {
      snapshot = collectMemorySnapshot()
    }).not.toThrow()

    expect(snapshot?.processMemoryMb).toBeUndefined()
    expect(snapshot?.memoryError).toBe('app not ready')
    expect(snapshot?.mainMemoryMb).toEqual(expect.objectContaining({ heapLimit: 4096 }))
  })

  it('keeps process metrics when process.memoryUsage throws', () => {
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
      throw new Error('uv_resident_set_memory failed')
    })

    const snapshot = collectMemorySnapshot()

    expect(snapshot.mainMemoryMb).toBeUndefined()
    expect(snapshot.processMemoryMb).toHaveLength(2)
    expect(snapshot.memoryError).toBe('uv_resident_set_memory failed')
  })

  it('reports both failures without throwing, including non-Error values', () => {
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
      throw 'memoryUsage failed'
    })
    getAppMetrics.mockImplementation(() => {
      throw { reason: 'not an Error' }
    })

    const snapshot = collectMemorySnapshot()

    expect(snapshot).toEqual({ memoryError: 'memoryUsage failed; unknown error' })
  })
})
