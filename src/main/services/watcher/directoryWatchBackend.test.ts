// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectDirectoryWatchBackend } from './directoryWatchBackend'
import { logger } from '../LoggingService'

// tests/setup/setupTests.main.ts stubs this module to always return `chokidar`;
// this suite needs the real selector.
vi.unmock('./directoryWatchBackend')

vi.mock('../LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const ENV_VAR = 'ERFANA_DIRECTORY_WATCHER'
const NATIVE_PLATFORMS = ['win32', 'darwin'] as const
const ALL_PLATFORMS = [...NATIVE_PLATFORMS, 'linux'] as const

describe('selectDirectoryWatchBackend (#211, D6)', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(NATIVE_PLATFORMS)('picks the native recursive watcher on %s', (platform) => {
    expect(selectDirectoryWatchBackend(platform, {})).toBe('native-recursive')
  })

  it('keeps chokidar on linux', () => {
    expect(selectDirectoryWatchBackend('linux', {})).toBe('chokidar')
  })

  it.each(ALL_PLATFORMS)('forces chokidar on %s when the override is exactly "chokidar"', (platform) => {
    expect(selectDirectoryWatchBackend(platform, { [ENV_VAR]: 'chokidar' })).toBe('chokidar')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each(['Chokidar', ' chokidar', 'chokidar ', 'native-recursive', 'fs.watch', '1'])(
    'ignores the unknown value %j and logs it without the value',
    (value) => {
      expect(selectDirectoryWatchBackend('win32', { [ENV_VAR]: value })).toBe('native-recursive')
      expect(selectDirectoryWatchBackend('linux', { [ENV_VAR]: value })).toBe('chokidar')

      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledWith('Directory watcher override ignored: unknown value', {
        variable: ENV_VAR,
        accepted: ['chokidar']
      })
    }
  )

  it('treats an empty value as unset, without a warning', () => {
    expect(selectDirectoryWatchBackend('win32', { [ENV_VAR]: '' })).toBe('native-recursive')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('ignores other variables', () => {
    expect(selectDirectoryWatchBackend('win32', { ERFANA_WATCHER: 'chokidar' })).toBe('native-recursive')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reads the host platform and process.env by default', () => {
    vi.stubEnv(ENV_VAR, undefined)
    const hostDefault =
      process.platform === 'win32' || process.platform === 'darwin' ? 'native-recursive' : 'chokidar'
    expect(selectDirectoryWatchBackend()).toBe(hostDefault)

    vi.stubEnv(ENV_VAR, 'chokidar')
    expect(selectDirectoryWatchBackend()).toBe('chokidar')
  })
})
