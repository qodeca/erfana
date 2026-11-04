// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * {@link takeBackReturnedFile} – the editor's decision when a deleted tab's
 * file is back (issue #450), one branch per test. The hook wiring and the
 * clock are covered in `useFileWatcher.restore.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import { takeBackReturnedFile, type ReturnedFileDeps } from './takeBackReturnedFile'

const PATH = '/project/notes.md'

function deps(overrides: Partial<ReturnedFileDeps> = {}) {
  const base = {
    filePath: PATH,
    isSaving: vi.fn(() => false),
    isDeleted: vi.fn(() => true),
    hasLocalChanges: vi.fn(() => false),
    bufferNow: vi.fn((): string | undefined => '# Mine\n'),
    readFile: vi.fn(() => Promise.resolve('# Disk\n')),
    reload: vi.fn(() => Promise.resolve()),
    clearDeletedState: vi.fn(),
    showConflict: vi.fn()
  }
  return { ...base, ...overrides }
}

describe('takeBackReturnedFile', () => {
  it('reloads an unedited tab with the text now on disk', async () => {
    const d = deps()

    await expect(takeBackReturnedFile(d)).resolves.toBe('reloaded')

    expect(d.readFile).toHaveBeenCalledWith(PATH)
    expect(d.reload).toHaveBeenCalledWith('# Disk\n')
    expect(d.showConflict).not.toHaveBeenCalled()
  })

  it('keeps an edited tab\'s text and offers the conflict choice', async () => {
    const d = deps({ hasLocalChanges: vi.fn(() => true) })

    await expect(takeBackReturnedFile(d)).resolves.toBe('conflict')

    expect(d.reload).not.toHaveBeenCalled()
    expect(d.clearDeletedState).toHaveBeenCalledTimes(1)
    expect(d.showConflict).toHaveBeenCalledTimes(1)
  })

  it('offers no choice when the file came back holding the buffer\'s text, CRLF or not', async () => {
    const d = deps({
      hasLocalChanges: vi.fn(() => true),
      bufferNow: vi.fn(() => '# Same\nline\n'),
      readFile: vi.fn(() => Promise.resolve('# Same\r\nline\r\n'))
    })

    await expect(takeBackReturnedFile(d)).resolves.toBe('same-text')

    expect(d.clearDeletedState).toHaveBeenCalledTimes(1)
    expect(d.showConflict).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
  })

  it('offers the choice when no editor is mounted to compare with', async () => {
    const d = deps({ hasLocalChanges: vi.fn(() => true), bufferNow: vi.fn(() => undefined) })

    await expect(takeBackReturnedFile(d)).resolves.toBe('conflict')
  })

  it('leaves the tab to a save in flight, without reading', async () => {
    const d = deps({ isSaving: vi.fn(() => true) })

    await expect(takeBackReturnedFile(d)).resolves.toBe('skipped')

    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('does nothing for a tab no longer deleted', async () => {
    const d = deps({ isDeleted: vi.fn(() => false) })

    await expect(takeBackReturnedFile(d)).resolves.toBe('skipped')

    expect(d.readFile).not.toHaveBeenCalled()
  })

  it('drops the read when a save or reload settled the tab meanwhile', async () => {
    const isDeleted = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    const d = deps({ isDeleted })

    await expect(takeBackReturnedFile(d)).resolves.toBe('skipped')

    expect(d.reload).not.toHaveBeenCalled()
    expect(d.clearDeletedState).not.toHaveBeenCalled()
  })

  it('stays deleted when the file is gone again by the time it is read', async () => {
    const d = deps({ readFile: vi.fn(() => Promise.reject(new Error('ENOENT'))) })

    await expect(takeBackReturnedFile(d)).resolves.toBe('still-gone')

    expect(d.reload).not.toHaveBeenCalled()
    expect(d.clearDeletedState).not.toHaveBeenCalled()
    expect(d.showConflict).not.toHaveBeenCalled()
  })
})
