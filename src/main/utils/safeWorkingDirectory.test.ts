// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * moveToSafeWorkingDirectory (#250): a packaged app leaves the launching folder.
 */
import { describe, it, expect, vi } from 'vitest'
import { moveToSafeWorkingDirectory, type SafeCwdEnv } from './safeWorkingDirectory'

const USER_DATA = '/Users/me/Library/Application Support/Erfana'

function env(overrides: Partial<SafeCwdEnv> = {}): SafeCwdEnv {
  return {
    isPackaged: true,
    platform: 'darwin',
    execPath: '/Applications/Erfana.app/Contents/MacOS/Erfana',
    userDataPath: () => USER_DATA,
    chdir: vi.fn(),
    mkdir: vi.fn(),
    warn: vi.fn(),
    ...overrides
  }
}

describe('moveToSafeWorkingDirectory', () => {
  it('does nothing in development, where the repository must stay the cwd', () => {
    const e = env({ isPackaged: false })
    expect(moveToSafeWorkingDirectory(e)).toBeNull()
    expect(e.chdir).not.toHaveBeenCalled()
  })

  it('creates and moves to the user-data folder on macOS and Linux (it may not exist on a first launch)', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const e = env({ platform })
      expect(moveToSafeWorkingDirectory(e)).toBe(USER_DATA)
      expect(e.mkdir).toHaveBeenCalledWith(USER_DATA)
      expect(e.chdir).toHaveBeenCalledWith(USER_DATA)
    }
  })

  it('moves to the install folder on Windows, whatever the host platform', () => {
    const e = env({ platform: 'win32', execPath: 'C:\\Program Files\\Erfana\\Erfana.exe' })
    expect(moveToSafeWorkingDirectory(e)).toBe('C:\\Program Files\\Erfana')
    expect(e.chdir).toHaveBeenCalledWith('C:\\Program Files\\Erfana')
    expect(e.mkdir).not.toHaveBeenCalled()
  })

  it('creates a missing folder with the real file system by default', async () => {
    const { mkdtempSync, existsSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const base = mkdtempSync(join(tmpdir(), 'erf-cwd-'))
    const target = join(base, 'Erfana', 'nested')
    try {
      const e = env({ platform: 'linux', userDataPath: () => target, mkdir: undefined })
      expect(moveToSafeWorkingDirectory(e)).toBe(target)
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('never throws: a failing chdir leaves the cwd as it was and logs a redacted warning', () => {
    const failing = env({
      chdir: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    })
    expect(moveToSafeWorkingDirectory(failing)).toBeNull()
    expect(failing.warn).toHaveBeenCalledWith(expect.any(String), { path: '[redacted]/Erfana', code: 'ENOENT' })
    expect(JSON.stringify(vi.mocked(failing.warn!).mock.calls)).not.toContain('/Users/me')
  })

  it('never throws when the user-data lookup or the logger fails', () => {
    const failingPath = env({
      userDataPath: () => {
        throw new Error('not ready')
      },
      warn: () => {
        throw new Error('logger down')
      }
    })
    expect(moveToSafeWorkingDirectory(failingPath)).toBeNull()
    expect(failingPath.chdir).not.toHaveBeenCalled()
  })
})
