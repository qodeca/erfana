// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `useFileWatcher` – a Markdown tab that can no longer follow its file says
 * so and offers Reload (#464).
 *
 * The watch could fail to start (a terminal-link path the main process
 * refused) or the watcher could fail later, and the tab only logged it: the
 * preview went stale with no sign. The hook now reports `isWatchUnavailable`,
 * and `restartWatch` starts the watch again and re-reads the file.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileWatcher, type UseFileWatcherOptions } from './useFileWatcher'

const PATH = '/project/notes.md'

type ErrorCallback = (data: { filePath: string; error: string; ended?: boolean }) => void

let errorListeners: ErrorCallback[] = []

const mockReadFile = vi.fn<(request: { filePath: string }) => Promise<string>>()
const mockFileWatch = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  onFileChanged: vi.fn(() => () => {}),
  onFileDeleted: vi.fn(() => () => {}),
  onFileError: vi.fn((cb: ErrorCallback) => {
    errorListeners.push(cb)
    return () => {
      errorListeners = errorListeners.filter((l) => l !== cb)
    }
  })
}

Object.defineProperty(window, 'api', {
  value: { file: { readFile: mockReadFile, getStats: vi.fn() }, fileWatch: mockFileWatch },
  writable: true,
  configurable: true
})

function watcher(initial: Partial<UseFileWatcherOptions> = {}) {
  const onContentUpdate = vi.fn()
  const props: UseFileWatcherOptions = { filePath: PATH, hasLocalChanges: false, onContentUpdate, ...initial }
  const hook = renderHook((p: UseFileWatcherOptions) => useFileWatcher(p), { initialProps: props })
  return { hook, onContentUpdate, props }
}

describe('useFileWatcher – auto-refresh stopped (#464)', () => {
  beforeEach(() => {
    errorListeners = []
    mockReadFile.mockReset().mockResolvedValue('# On disk\n')
    mockFileWatch.start.mockReset().mockResolvedValue({ success: true })
    mockFileWatch.stop.mockReset().mockResolvedValue({ success: true })
  })

  it('is not flagged while the watch runs', async () => {
    const { hook } = watcher()
    await waitFor(() => expect(mockFileWatch.start).toHaveBeenCalledTimes(1))
    expect(hook.result.current.isWatchUnavailable).toBe(false)
  })

  it('flags a watch that never started', async () => {
    mockFileWatch.start.mockResolvedValue({ success: false, error: 'Cannot watch files outside the project directory' })
    const { hook } = watcher()
    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(true))
  })

  it('flags a watcher error for this file, and ignores one for another file', async () => {
    const { hook } = watcher()
    await waitFor(() => expect(errorListeners).toHaveLength(1))

    act(() => errorListeners[0]({ filePath: '/project/other.md', error: 'EPERM' }))
    expect(hook.result.current.isWatchUnavailable).toBe(false)

    act(() => errorListeners[0]({ filePath: PATH, error: 'EPERM', ended: true }))
    expect(hook.result.current.isWatchUnavailable).toBe(true)
  })

  it('restartWatch starts the watch again, clears the flag and re-reads an unedited file', async () => {
    mockFileWatch.start.mockResolvedValueOnce({ success: false, error: 'boom' })
    const { hook, onContentUpdate } = watcher()
    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(true))

    act(() => hook.result.current.restartWatch())

    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(false))
    expect(mockFileWatch.start).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(onContentUpdate).toHaveBeenCalledWith('# On disk\n'))
  })

  it('restartWatch releases a half-dead hold first, so the main watch is rebuilt', async () => {
    const { hook } = watcher()
    await waitFor(() => expect(errorListeners).toHaveLength(1))
    act(() => errorListeners[0]({ filePath: PATH, error: 'watcher died' })) // not ended: the hold remains

    act(() => hook.result.current.restartWatch())

    await waitFor(() => expect(mockFileWatch.start).toHaveBeenCalledTimes(2))
    expect(mockFileWatch.stop).toHaveBeenCalledTimes(1)
    expect(mockFileWatch.stop.mock.invocationCallOrder[0]).toBeLessThan(mockFileWatch.start.mock.invocationCallOrder[1])
  })

  it('restartWatch keeps unsaved edits: it does not re-read over them', async () => {
    mockFileWatch.start.mockResolvedValueOnce({ success: false, error: 'boom' })
    const { hook, onContentUpdate } = watcher({ hasLocalChanges: true })
    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(true))

    act(() => hook.result.current.restartWatch())

    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(false))
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('stays flagged when the restart fails too', async () => {
    mockFileWatch.start.mockResolvedValue({ success: false, error: 'still refused' })
    const { hook } = watcher()
    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(true))

    act(() => hook.result.current.restartWatch())

    await waitFor(() => expect(mockFileWatch.start).toHaveBeenCalledTimes(2))
    expect(hook.result.current.isWatchUnavailable).toBe(true)
  })

  it('a file switch clears the flag of the previous file', async () => {
    mockFileWatch.start.mockResolvedValueOnce({ success: false, error: 'boom' })
    const { hook, props } = watcher()
    await waitFor(() => expect(hook.result.current.isWatchUnavailable).toBe(true))

    hook.rerender({ ...props, filePath: '/project/next.md' })

    expect(hook.result.current.isWatchUnavailable).toBe(false)
  })
})
