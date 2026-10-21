// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * moveToSafeWorkingDirectory (#250): a packaged app leaves the launching folder.
 */
import { describe, it, expect, vi } from 'vitest'
import { dirname } from 'path'
import { moveToSafeWorkingDirectory, type SafeCwdEnv } from './safeWorkingDirectory'

function env(overrides: Partial<SafeCwdEnv> = {}): SafeCwdEnv {
  return {
    isPackaged: true,
    platform: 'darwin',
    execPath: '/Applications/Erfana.app/Contents/MacOS/Erfana',
    userDataPath: () => '/Users/me/Library/Application Support/Erfana',
    chdir: vi.fn(),
    ...overrides
  }
}

describe('moveToSafeWorkingDirectory', () => {
  it('does nothing in development, where the repository must stay the cwd', () => {
    const e = env({ isPackaged: false })
    expect(moveToSafeWorkingDirectory(e)).toBeNull()
    expect(e.chdir).not.toHaveBeenCalled()
  })

  it('moves to the user-data folder on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const e = env({ platform })
      expect(moveToSafeWorkingDirectory(e)).toBe('/Users/me/Library/Application Support/Erfana')
      expect(e.chdir).toHaveBeenCalledWith('/Users/me/Library/Application Support/Erfana')
    }
  })

  it('moves to the install folder on Windows', () => {
    const execPath = 'C:\\Program Files\\Erfana\\Erfana.exe'
    const e = env({ platform: 'win32', execPath })
    expect(moveToSafeWorkingDirectory(e)).toBe(dirname(execPath))
    expect(e.chdir).toHaveBeenCalledWith(dirname(execPath))
  })

  it('never throws: a failing chdir or user-data lookup leaves the cwd as it was', () => {
    const failingChdir = env({
      chdir: () => {
        throw new Error('ENOENT')
      }
    })
    expect(moveToSafeWorkingDirectory(failingChdir)).toBeNull()

    const failingPath = env({
      userDataPath: () => {
        throw new Error('not ready')
      }
    })
    expect(moveToSafeWorkingDirectory(failingPath)).toBeNull()
    expect(failingPath.chdir).not.toHaveBeenCalled()
  })
})
