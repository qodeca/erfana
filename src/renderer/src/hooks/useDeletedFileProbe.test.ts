// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * {@link useDeletedFileProbe} – the clock behind "a deleted tab recovers when
 * its file comes back" (issue #450). The editor and image-tab behaviour on top
 * of it is in `useFileWatcher.restore.test.ts` and
 * `useFileChangeSubscription.recovery.test.ts`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../shared/deletedFileProbe'
import { logger } from '../utils/logger'
import { useDeletedFileProbe } from './useDeletedFileProbe'

const PATH = '/project/notes.md'

const mockGetStats = vi.fn<(request: { filePath: string }) => Promise<{ size: number }>>()

Object.defineProperty(window, 'api', {
  value: { file: { getStats: mockGetStats } },
  writable: true,
  configurable: true
})

interface ProbeProps {
  filePath: string | null
  isDeleted: boolean
  onFileBack: () => Promise<void> | void
}

function renderProbe(initial: Partial<ProbeProps> = {}) {
  const props: ProbeProps = { filePath: PATH, isDeleted: true, onFileBack: vi.fn(), ...initial }
  const hook = renderHook((p: ProbeProps) => useDeletedFileProbe(p.filePath, p.isDeleted, p.onFileBack), {
    initialProps: props
  })
  return { hook, props }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useDeletedFileProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetStats.mockReset().mockRejectedValue(new Error('ENOENT'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('asks nothing for a tab that is not deleted, or has no file', async () => {
    renderProbe({ isDeleted: false })
    renderProbe({ filePath: null })
    renderProbe({ filePath: '' })

    await advance(DELETED_FILE_PROBE_INTERVAL_MS * 3)

    expect(mockGetStats).not.toHaveBeenCalled()
  })

  it('asks once per interval, never earlier', async () => {
    renderProbe()

    await advance(DELETED_FILE_PROBE_INTERVAL_MS - 1)
    expect(mockGetStats).not.toHaveBeenCalled()
    await advance(1)
    expect(mockGetStats).toHaveBeenCalledTimes(1)
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(mockGetStats).toHaveBeenCalledTimes(2)
    expect(mockGetStats).toHaveBeenCalledWith({ filePath: PATH })
  })

  it('calls onFileBack only when the file is on disk', async () => {
    const onFileBack = vi.fn()
    renderProbe({ onFileBack })

    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(onFileBack).not.toHaveBeenCalled()

    mockGetStats.mockResolvedValue({ size: 1 })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(onFileBack).toHaveBeenCalledTimes(1)
  })

  it('never overlaps: a slow ask holds the next one back', async () => {
    let answer: () => void = () => {}
    mockGetStats.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          answer = () => reject(new Error('ENOENT'))
        })
    )
    renderProbe()

    await advance(DELETED_FILE_PROBE_INTERVAL_MS * 5)
    expect(mockGetStats).toHaveBeenCalledTimes(1)

    answer()
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(mockGetStats).toHaveBeenCalledTimes(2)
  })

  it('stops when the tab is no longer deleted', async () => {
    const { hook, props } = renderProbe()
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)

    hook.rerender({ ...props, isDeleted: false })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS * 3)

    expect(mockGetStats).toHaveBeenCalledTimes(1)
  })

  it('stops when the tab closes, and drops an answer that arrives after it', async () => {
    let answer: () => void = () => {}
    mockGetStats.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ size: 1 })
        })
    )
    const onFileBack = vi.fn()
    const { hook } = renderProbe({ onFileBack })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)

    hook.unmount()
    answer()
    await advance(DELETED_FILE_PROBE_INTERVAL_MS * 3)

    expect(onFileBack).not.toHaveBeenCalled()
    expect(mockGetStats).toHaveBeenCalledTimes(1)
  })

  it('logs an onFileBack that throws and tries again on the next interval', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    mockGetStats.mockResolvedValue({ size: 1 })
    const onFileBack = vi.fn().mockRejectedValueOnce(new Error('read failed'))
    renderProbe({ onFileBack })

    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(error).toHaveBeenCalledWith(
      'Could not take back a file that returned',
      expect.any(Error),
      { filePath: PATH }
    )

    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(onFileBack).toHaveBeenCalledTimes(2)
  })

  it('asks for a Windows path exactly as the tab holds it, backslashes and drive letter included', async () => {
    // Main passes native separators across IPC; a rewritten path would stat a
    // file that does not exist and the tab would never recover on Windows
    const windowsPath = 'C:\\Users\\dev\\project\\docs\\notes.md'
    const onFileBack = vi.fn()
    renderProbe({ filePath: windowsPath, onFileBack })

    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    expect(mockGetStats).toHaveBeenCalledWith({ filePath: windowsPath })
    expect(onFileBack).not.toHaveBeenCalled()

    mockGetStats.mockImplementation(async ({ filePath }) => {
      if (filePath !== windowsPath) throw new Error('ENOENT')
      return { size: 1 }
    })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)

    expect(onFileBack).toHaveBeenCalledTimes(1)
    expect(mockGetStats.mock.calls.every(([request]) => request.filePath === windowsPath)).toBe(true)
  })

  it('calls the latest onFileBack without restarting the clock', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { hook, props } = renderProbe({ onFileBack: first })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS / 2)

    hook.rerender({ ...props, onFileBack: second })
    mockGetStats.mockResolvedValue({ size: 1 })
    await advance(DELETED_FILE_PROBE_INTERVAL_MS / 2)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
