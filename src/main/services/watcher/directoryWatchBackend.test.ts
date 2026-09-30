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
const OTHER_PLATFORMS = ['darwin', 'linux'] as const
const ALL_PLATFORMS = ['win32', ...OTHER_PLATFORMS] as const

describe('selectDirectoryWatchBackend (#211, D6)', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('picks the native recursive watcher on Windows', () => {
    expect(selectDirectoryWatchBackend('win32', {})).toBe('native-recursive')
  })

  it.each(OTHER_PLATFORMS)('keeps chokidar on %s', (platform) => {
    expect(selectDirectoryWatchBackend(platform, {})).toBe('chokidar')
  })

  it.each(ALL_PLATFORMS)('forces chokidar on %s when the override is exactly "chokidar"', (platform) => {
    expect(selectDirectoryWatchBackend(platform, { [ENV_VAR]: 'chokidar' })).toBe('chokidar')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each(['Chokidar', ' chokidar', 'chokidar ', 'native-recursive', 'fs.watch', '1'])(
    'ignores the unknown value %j and logs it without the value',
    (value) => {
      expect(selectDirectoryWatchBackend('win32', { [ENV_VAR]: value })).toBe('native-recursive')
      expect(selectDirectoryWatchBackend('darwin', { [ENV_VAR]: value })).toBe('chokidar')

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
    const hostDefault = process.platform === 'win32' ? 'native-recursive' : 'chokidar'
    expect(selectDirectoryWatchBackend()).toBe(hostDefault)

    vi.stubEnv(ENV_VAR, 'chokidar')
    expect(selectDirectoryWatchBackend()).toBe('chokidar')
  })
})
