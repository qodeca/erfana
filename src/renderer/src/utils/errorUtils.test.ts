// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { classifyFsError, formatFileOperationError, formatSaveError, loggableError } from './errorUtils'

const ipc = (inner: string): Error =>
  new Error(`Error invoking remote method 'file:writeFile': Error: ${inner}`)

describe('classifyFsError (the one errno mapper)', () => {
  it('maps the common codes and phrases', () => {
    expect(classifyFsError("ENOENT: no such file or directory, open '/p/a.md'")).toBe('not-found')
    expect(classifyFsError('File not found')).toBe('not-found')
    expect(classifyFsError("EACCES: permission denied, open '/p/a.md'")).toBe('permission')
    expect(classifyFsError("EPERM: operation not permitted, open '/p/a.md'")).toBe('permission')
    expect(classifyFsError('ENOSPC: no space left on device, write')).toBe('no-space')
    expect(classifyFsError('Something else')).toBeNull()
  })
})

describe('formatFileOperationError (unchanged wording, now through classifyFsError)', () => {
  it('keeps its existing messages', () => {
    expect(formatFileOperationError(ipc('ENOENT: x'), 'move', 'a.md')).toBe('"a.md" not found')
    expect(formatFileOperationError(ipc('EACCES: x'), 'move', 'a.md')).toBe(
      'Permission denied: cannot move "a.md"'
    )
    expect(formatFileOperationError(ipc('Target already exists'), 'move', 'a.md')).toBe(
      'An item named "a.md" already exists'
    )
    expect(formatFileOperationError(ipc('Weird'), 'move')).toBe('Weird')
  })
})

describe('formatSaveError', () => {
  it('explains a missing folder (the save-after-folder-rename case) and says nothing was lost', () => {
    expect(formatSaveError(ipc("ENOENT: no such file or directory, open '/p/docs/open.md'"), 'open.md')).toBe(
      '"open.md" could not be saved: its folder no longer exists on disk. Your changes are still in the editor.'
    )
  })

  it('names a permission problem and a full disk', () => {
    expect(formatSaveError(ipc("EACCES: permission denied, open '/p/a.md'"), 'a.md')).toBe(
      '"a.md" could not be saved: permission denied. Your changes are still in the editor.'
    )
    expect(formatSaveError(ipc("EPERM: operation not permitted, open '/p/a.md'"), 'a.md')).toContain(
      'permission denied'
    )
    expect(formatSaveError(ipc('ENOSPC: no space left on device, write'), 'a.md')).toContain(
      'the disk is full'
    )
  })

  it('passes any other reason through without the IPC prefix', () => {
    expect(formatSaveError(ipc('Cannot restore the file: the project folder no longer exists'), 'a.md')).toBe(
      '"a.md" could not be saved: Cannot restore the file: the project folder no longer exists. Your changes are still in the editor.'
    )
    expect(formatSaveError('not an error', 'a.md')).toBe(
      '"a.md" could not be saved: An unknown error occurred. Your changes are still in the editor.'
    )
  })
})

describe('loggableError (no absolute path in the log file)', () => {
  it('drops the path from a failed save that came over IPC', () => {
    const error = new Error(
      "Error invoking remote method 'file:writeFile': Error: EPERM: operation not permitted, open 'C:\\Users\\alice\\proj\\notes.md'"
    )

    const logged = loggableError(error)

    expect(logged?.message).toBe(
      "Error invoking remote method 'file:writeFile': Error: EPERM: operation not permitted, open [redacted-path]"
    )
    expect(logged?.stack ?? '').not.toContain('alice')
  })

  it('returns the original error, stack included, when there is no path', () => {
    const error = new Error('disk full')

    expect(loggableError(error)).toBe(error)
  })

  it('returns undefined for a value that is not an Error', () => {
    expect(loggableError('EPERM')).toBeUndefined()
  })
})
