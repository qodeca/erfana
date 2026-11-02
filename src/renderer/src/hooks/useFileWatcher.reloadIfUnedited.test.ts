// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `useFileWatcher`'s `reloadIfUnedited` – the editor panel's re-read after a
 * comment save (spec 024 024-FR-026; src/renderer/CLAUDE.md "Autosave must
 * never lose keystrokes").
 *
 * The comment save answers once main's write finished, and the panel re-reads
 * the file so the preview shows the new block. The dirty check used to run
 * only when the save answered; the read then took a while and its text
 * replaced the buffer without a second look, so whatever was typed during the
 * read was gone. The check now runs again after the read: a changed buffer,
 * or local changes, keep the edits.
 *
 * Split from `useFileWatcher.test.ts` (docs/windows/contributing.md
 * "Test-file split policy"): the bridge mocks live at module scope.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileWatcher, type UseFileWatcherOptions } from './useFileWatcher'

const PATH = '/project/notes.md'

const mockReadFile = vi.fn<(request: { filePath: string }) => Promise<string>>()

Object.defineProperty(window, 'api', {
  value: {
    file: { readFile: mockReadFile },
    fileWatch: {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      onFileChanged: vi.fn(() => () => {}),
      onFileDeleted: vi.fn(() => () => {}),
      onFileError: vi.fn(() => () => {})
    }
  },
  writable: true,
  configurable: true
})

/** A read that answers when the test says so. */
function pendingRead(): { resolve: (text: string) => void; reject: (error: Error) => void } {
  let resolve: (text: string) => void = () => {}
  let reject: (error: Error) => void = () => {}
  mockReadFile.mockImplementationOnce(
    () =>
      new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
      })
  )
  return { resolve: text => resolve(text), reject: error => reject(error) }
}

/** The hook over an editor buffer the test types into. */
function watcher(initial: Partial<UseFileWatcherOptions> = {}) {
  const editor = { text: '# Plan\n' }
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

describe('useFileWatcher – reloadIfUnedited (024-AC-034)', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
  })

  it('024-AC-034 a keystroke during the pending read survives: the read is not taken', async () => {
    const { hook, editor, onContentUpdate } = watcher()
    const read = pendingRead()
    let reloading: Promise<void> = Promise.resolve()
    act(() => {
      reloading = hook.result.current.reloadIfUnedited()
    })
    // Typed while main's bytes are on their way: Monaco's model has the keystroke at once.
    editor.text = '# Plan\nX'
    await act(async () => {
      read.resolve('<!-- erfana:comment -->\n# Plan\n')
      await reloading
    })
    expect(mockReadFile).toHaveBeenCalledWith({ filePath: PATH })
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('024-AC-034 local changes reported during the read keep the buffer even when the text compares equal', async () => {
    const { hook, onContentUpdate, props } = watcher()
    const read = pendingRead()
    let reloading: Promise<void> = Promise.resolve()
    act(() => {
      reloading = hook.result.current.reloadIfUnedited()
    })
    hook.rerender({ ...props, hasLocalChanges: true })
    await act(async () => {
      read.resolve('<!-- erfana:comment -->\n# Plan\n')
      await reloading
    })
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('024-AC-034 an unedited tab takes the written file', async () => {
    const { hook, onContentUpdate } = watcher()
    mockReadFile.mockResolvedValueOnce('<!-- erfana:comment -->\n# Plan\n')
    await act(async () => {
      await hook.result.current.reloadIfUnedited()
    })
    expect(onContentUpdate).toHaveBeenCalledWith('<!-- erfana:comment -->\n# Plan\n')
  })

  it('024-AC-034 with no editor mounted (the preview-only view), an unedited tab takes the written file', async () => {
    const { hook, onContentUpdate } = watcher({ bufferNow: () => undefined })
    mockReadFile.mockResolvedValueOnce('new text')
    await act(async () => {
      await hook.result.current.reloadIfUnedited()
    })
    expect(onContentUpdate).toHaveBeenCalledWith('new text')
  })

  it('024-AC-034 a tab already holding local changes does not even read', async () => {
    const { hook, onContentUpdate } = watcher({ hasLocalChanges: true })
    await act(async () => {
      await hook.result.current.reloadIfUnedited()
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(onContentUpdate).not.toHaveBeenCalled()
  })

  it('024-AC-034 a failed read changes nothing and never throws', async () => {
    const { hook, onContentUpdate } = watcher()
    const read = pendingRead()
    let reloading: Promise<void> = Promise.resolve()
    act(() => {
      reloading = hook.result.current.reloadIfUnedited()
    })
    await act(async () => {
      read.reject(new Error('EBUSY'))
      await reloading
    })
    expect(onContentUpdate).not.toHaveBeenCalled()
  })
})
