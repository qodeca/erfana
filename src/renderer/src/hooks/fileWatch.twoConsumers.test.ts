// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Two consumers of one file across a delete and a restore (#252).
 *
 * The main process counts `start`s per file and drops the whole entry - every
 * count - when it reports the file deleted, or ends the watch with an error
 * flagged `ended`. If a consumer then sent a `stop`
 * for the hold it had before the delete, it would take the count another
 * consumer had just rebuilt, and that tab would go deaf. Here the editor
 * (`useFileWatcher`) and a read-only viewer (`useFileChangeSubscription`)
 * watch the same file against a fake main-side count, and both must end up
 * holding one count each, in either order.
 *
 * @module fileWatch.twoConsumers.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { installFileWatchHarness, renderSubscription } from './__test__/fileWatchHarness'
import { useFileWatcher } from './useFileWatcher'

const h = installFileWatchHarness()
const SHARED_PATH = '/proj/notes.md'

/** The main process's subscriber count for SHARED_PATH. */
let mainCount = 0

beforeEach(() => {
  mainCount = 0
  h.fileWatch.start.mockImplementation(async () => {
    mainCount += 1
    return { success: true }
  })
  h.fileWatch.stop.mockImplementation(async () => {
    mainCount = Math.max(0, mainCount - 1)
    return { success: true }
  })
})

/** Main drops the watch, every count with it, then tells the windows. */
function mainReportsDeleted(): void {
  mainCount = 0
  h.emitDeleted(SHARED_PATH)
}

function renderBoth() {
  // Stable callback, as a real panel passes: a new one per render would
  // restart the editor's watch on every state change
  const onContentUpdate = vi.fn()
  const editor = renderHook(() =>
    useFileWatcher({ filePath: SHARED_PATH, hasLocalChanges: false, onContentUpdate })
  )
  const viewer = renderSubscription(SHARED_PATH)
  return { editor, viewer }
}

describe('two consumers of one file, across a delete and a restore', () => {
  it.each(['editor', 'viewer'] as const)(
    'both hold a count again when the %s comes back first',
    async (first) => {
      const { editor, viewer } = renderBoth()
      await waitFor(() => expect(mainCount).toBe(2))

      // Genuinely gone: the viewer's re-check agrees, so it shows the banner
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      mainReportsDeleted()
      await waitFor(() => expect(viewer.result.current.isFileDeleted).toBe(true))
      expect(editor.result.current.isFileDeleted).toBe(true)

      // The editor's save restores the file; the viewer's Reload finds it back
      h.getStats.mockResolvedValue({ size: 1 })
      const restoreEditor = async (): Promise<void> => {
        act(() => editor.result.current.clearDeletedState())
        await waitFor(() => expect(editor.result.current.isFileDeleted).toBe(false))
      }
      const reloadViewer = async (): Promise<void> => {
        await act(async () => {
          await viewer.result.current.recover()
        })
      }
      if (first === 'editor') {
        await restoreEditor()
        await waitFor(() => expect(mainCount).toBe(1))
        await reloadViewer()
      } else {
        await reloadViewer()
        await restoreEditor()
      }

      await waitFor(() => expect(mainCount).toBe(2))
      expect(h.fileWatch.stop).not.toHaveBeenCalled()

      // Closing one tab leaves the other one watched
      viewer.unmount()
      await waitFor(() => expect(mainCount).toBe(1))
      editor.unmount()
      await waitFor(() => expect(mainCount).toBe(0))
    }
  )

  it('neither sends a stop for a watch the main process ended with an error', async () => {
    const { editor, viewer } = renderBoth()
    await waitFor(() => expect(mainCount).toBe(2))

    // notifyWatchDead: main drops the entry, every count with it, and says so
    mainCount = 0
    h.emitError(SHARED_PATH, 'File watch ended: could not re-arm after the file was replaced', true)
    expect(viewer.result.current.unavailableReason).toBe('watcher-error')

    // The viewer's Reload starts a fresh watch; the editor's close must not take it
    await act(async () => {
      await viewer.result.current.recover()
    })
    await waitFor(() => expect(mainCount).toBe(1))
    editor.unmount()
    await act(async () => {})

    expect(mainCount).toBe(1)
    expect(h.fileWatch.stop).not.toHaveBeenCalled()
    viewer.unmount()
    await waitFor(() => expect(mainCount).toBe(0))
  })

  it('still releases a live watch after a plain watcher error', async () => {
    const { viewer } = renderBoth()
    await waitFor(() => expect(mainCount).toBe(2))

    // A chokidar error the watch survives: main keeps the entry and its counts
    h.emitError(SHARED_PATH, 'EMFILE')
    await act(async () => {
      await viewer.result.current.recover()
    })

    expect(h.fileWatch.stop).toHaveBeenCalledTimes(1)
    expect(mainCount).toBe(2)
  })
})
