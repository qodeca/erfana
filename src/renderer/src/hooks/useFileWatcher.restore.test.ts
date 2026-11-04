// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `useFileWatcher` – a tab in the deleted state recovers when its file comes
 * back (issue #450).
 *
 * A git branch switch or a merge deletes an open file and puts it back
 * seconds later. The delete ends the main-process watch, so nothing reported
 * the return and the tab said "deleted on disk" until the user saved. The hook
 * now looks for the file while the tab is deleted: an unedited tab reloads it,
 * and a tab the user typed in gets the "file changed on disk" choice instead of
 * losing the text.
 *
 * Split from `useFileWatcher.test.ts` (docs/windows/contributing.md
 * "Test-file split policy"): this suite runs on fake timers and its bridge
 * carries `getStats`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../shared/deletedFileProbe'
import { useFileWatcher, type UseFileWatcherOptions } from './useFileWatcher'

const PATH = '/project/notes.md'

type WatchCallback = (data: { filePath: string }) => void

let deletedListeners: WatchCallback[] = []

const mockReadFile = vi.fn<(request: { filePath: string }) => Promise<string>>()
const mockGetStats = vi.fn<(request: { filePath: string }) => Promise<{ size: number }>>()
const mockFileWatch = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  onFileChanged: vi.fn(() => () => {}),
  onFileDeleted: vi.fn((cb: WatchCallback) => {
    deletedListeners.push(cb)
    return () => {
      deletedListeners = deletedListeners.filter((l) => l !== cb)
    }
  }),
  onFileError: vi.fn(() => () => {})
}

Object.defineProperty(window, 'api', {
  value: { file: { readFile: mockReadFile, getStats: mockGetStats }, fileWatch: mockFileWatch },
  writable: true,
  configurable: true
})

const gone = (): Promise<never> => Promise.reject(new Error('ENOENT: no such file or directory'))

/** The hook over an editor buffer the test types into. */
function watcher(initial: Partial<UseFileWatcherOptions> = {}) {
  const editor = { text: '# Notes\n' }
  const onContentUpdate = vi.fn()
  const props: UseFileWatcherOptions = {
    filePath: PATH,
    hasLocalChanges: false,
    onContentUpdate,
    bufferNow: () => editor.text,
    ...initial
  }
  const hook = renderHook((p: UseFileWatcherOptions) => useFileWatcher(p), { initialProps: props })
  return { hook, editor, onContentUpdate, props }
}

/** Main reports the delete; the tab shows the deleted state. */
function deleteOnDisk(): void {
  act(() => {
    for (const listener of [...deletedListeners]) listener({ filePath: PATH })
  })
}

/** One probe interval passes and everything it started settles. */
async function nextProbe(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DELETED_FILE_PROBE_INTERVAL_MS)
  })
}

describe('useFileWatcher – a deleted file that comes back (#450)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    deletedListeners = []
    mockReadFile.mockReset()
    mockGetStats.mockReset().mockImplementation(gone)
    mockFileWatch.start.mockReset().mockResolvedValue({ success: true })
    mockFileWatch.stop.mockReset().mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not look for a file that was never deleted', async () => {
    watcher()

    await nextProbe()
    await nextProbe()

    expect(mockGetStats).not.toHaveBeenCalled()
  })

  it('keeps showing the deleted state, and keeps looking, while the file stays gone', async () => {
    const { hook, onContentUpdate } = watcher()
    deleteOnDisk()

    await nextProbe()
    await nextProbe()
    await nextProbe()

    expect(mockGetStats).toHaveBeenCalledTimes(3)
    expect(mockGetStats).toHaveBeenCalledWith({ filePath: PATH })
    expect(hook.result.current.isFileDeleted).toBe(true)
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('reloads an unedited tab with the content now on disk and watches the file again', async () => {
    const { hook, onContentUpdate } = watcher()
    await act(async () => {})
    deleteOnDisk()
    await nextProbe()

    mockGetStats.mockResolvedValue({ size: 12 })
    mockReadFile.mockResolvedValue('# Notes\n\nFrom the other branch.\n')
    await nextProbe()

    expect(hook.result.current.isFileDeleted).toBe(false)
    expect(hook.result.current.externalChangeDetected).toBe(false)
    expect(onContentUpdate).toHaveBeenCalledWith('# Notes\n\nFrom the other branch.\n')
    // The delete ended the main-process watch; the return starts a new one
    // and sends no `stop` that could take another tab's count (#252)
    expect(mockFileWatch.start).toHaveBeenCalledTimes(2)
    expect(mockFileWatch.stop).not.toHaveBeenCalled()

    // Recovered: the probe stops
    await nextProbe()
    expect(mockGetStats).toHaveBeenCalledTimes(2)
  })

  it('offers the conflict choice, never the disk text, when the user typed while it was deleted', async () => {
    const { hook, editor, onContentUpdate, props } = watcher()
    deleteOnDisk()
    editor.text = '# Notes\n\nTyped while deleted.\n'
    hook.rerender({ ...props, hasLocalChanges: true })

    mockGetStats.mockResolvedValue({ size: 12 })
    mockReadFile.mockResolvedValue('# Notes\n\nFrom the other branch.\n')
    await nextProbe()

    expect(hook.result.current.isFileDeleted).toBe(false)
    expect(hook.result.current.externalChangeDetected).toBe(true)
    expect(onContentUpdate).not.toHaveBeenCalled()
    expect(editor.text).toBe('# Notes\n\nTyped while deleted.\n')
  })

  it('clears the deleted state without a conflict when the file came back with the text in the buffer', async () => {
    const { hook, editor, onContentUpdate, props } = watcher()
    deleteOnDisk()
    editor.text = '# Notes\n\nSame text.\n'
    hook.rerender({ ...props, hasLocalChanges: true })

    mockGetStats.mockResolvedValue({ size: 12 })
    mockReadFile.mockResolvedValue('# Notes\r\n\r\nSame text.\r\n')
    await nextProbe()

    expect(hook.result.current.isFileDeleted).toBe(false)
    expect(hook.result.current.externalChangeDetected).toBe(false)
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('leaves the tab to a save in flight: the save is what put the file back', async () => {
    const { hook, onContentUpdate } = watcher()
    deleteOnDisk()
    act(() => {
      hook.result.current.markSaving()
    })

    mockGetStats.mockResolvedValue({ size: 12 })
    mockReadFile.mockResolvedValue('# Notes\n')
    await nextProbe()

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(onContentUpdate).not.toHaveBeenCalled()
    expect(hook.result.current.isFileDeleted).toBe(true)
  })

  it('stays deleted and looks again when the file is gone once more by the time it is read', async () => {
    const { hook, onContentUpdate } = watcher()
    deleteOnDisk()

    mockGetStats.mockResolvedValueOnce({ size: 12 })
    mockReadFile.mockImplementationOnce(gone)
    await nextProbe()

    expect(hook.result.current.isFileDeleted).toBe(true)
    expect(onContentUpdate).not.toHaveBeenCalled()

    mockGetStats.mockResolvedValue({ size: 12 })
    mockReadFile.mockResolvedValue('# Notes\n\nBack for good.\n')
    await nextProbe()

    expect(hook.result.current.isFileDeleted).toBe(false)
    expect(onContentUpdate).toHaveBeenCalledWith('# Notes\n\nBack for good.\n')
  })

  it('stops looking when the tab closes', async () => {
    const { hook } = watcher()
    deleteOnDisk()

    hook.unmount()
    await nextProbe()

    expect(mockGetStats).not.toHaveBeenCalled()
  })

  it('stops looking for the old file when the tab shows another one', async () => {
    const { hook, props } = watcher()
    deleteOnDisk()

    hook.rerender({ ...props, filePath: '/project/other.md' })
    await nextProbe()

    expect(mockGetStats).not.toHaveBeenCalledWith({ filePath: PATH })
  })
})
