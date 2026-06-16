// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * spawnNewInstance.test.ts
 *
 * Tests for platform-specific new instance spawning utilities
 *
 * Coverage:
 * - Development mode: npm run dev with shell and cwd
 * - Production macOS: open -n -a with app bundle discovery
 * - Production Windows: direct exe spawn
 * - Production other platforms (dev fallback): direct exe spawn
 * - getSpawnConfig returns correct config for each platform
 * - spawnNewInstance spawns process with correct configuration
 * - Error handling: spawn failures and exceptions
 * - findMacOSAppBundle extracts .app path from exe path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    on: vi.fn(),
    pid: 12345
  }))
}))

// Mock Electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getAppPath: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}))

// Import after mocking
import { spawn } from 'child_process'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { logger } from '../services/LoggingService'
import { spawnNewInstance, getSpawnConfig } from './spawnNewInstance'

// Get references to mocked functions
const mockSpawn = vi.mocked(spawn)
const mockGetPath = vi.mocked(app.getPath)
const mockGetAppPath = vi.mocked(app.getAppPath)
const mockIs = vi.mocked(is)
const mockLoggerInfo = vi.mocked(logger.info)
const mockLoggerError = vi.mocked(logger.error)
const mockLoggerDebug = vi.mocked(logger.debug)
const mockLoggerWarn = vi.mocked(logger.warn)

describe('getSpawnConfig', () => {
  let originalPlatform: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    originalPlatform = process.platform
    originalEnv = { ...process.env }
    mockIs.dev = false
  })

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
    // Restore environment variables
    process.env = originalEnv
  })

  describe('development mode', () => {
    beforeEach(() => {
      mockIs.dev = true
      mockGetAppPath.mockReturnValue('/path/to/erfana')
    })

    it('returns npm run dev configuration', () => {
      const config = getSpawnConfig()

      expect(config).toEqual({
        command: 'npm',
        args: ['run', 'dev'],
        options: {
          shell: true,
          cwd: '/path/to/erfana',
          detached: true,
          stdio: 'ignore'
        }
      })
    })

    it('uses shell: true for npm', () => {
      const config = getSpawnConfig()

      expect(config.options.shell).toBe(true)
    })

    it('uses cwd from app.getAppPath()', () => {
      mockGetAppPath.mockReturnValue('/custom/project/path')

      const config = getSpawnConfig()

      expect(config.options.cwd).toBe('/custom/project/path')
      expect(mockGetAppPath).toHaveBeenCalled()
    })

    it('uses detached: true and stdio: ignore', () => {
      const config = getSpawnConfig()

      expect(config.options.detached).toBe(true)
      expect(config.options.stdio).toBe('ignore')
    })

    it('logs debug message with cwd', () => {
      getSpawnConfig()

      expect(mockLoggerDebug).toHaveBeenCalledWith('Spawn config: development mode', {
        cwd: '/path/to/erfana'
      })
    })
  })

  describe('production mode - macOS', () => {
    beforeEach(() => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
    })

    it('uses open command with app bundle path', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.command).toBe('open')
      expect(config.args).toEqual([
        '-n',
        '-a',
        '/Applications/Erfana.app',
        '--args',
        '--new-window'
      ])
    })

    it('includes -n flag for new instance', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.args).toContain('-n')
    })

    it('includes -a flag with app bundle path', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.args).toContain('-a')
      expect(config.args).toContain('/Applications/Erfana.app')
    })

    it('includes --args --new-window', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.args).toContain('--args')
      expect(config.args).toContain('--new-window')
    })

    it('uses detached: true and stdio: ignore', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.options.detached).toBe(true)
      expect(config.options.stdio).toBe('ignore')
    })

    it('does not use shell option', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.options.shell).toBeUndefined()
    })

    it('finds app bundle from nested exe path', () => {
      mockGetPath.mockReturnValue('/Users/test/Applications/Erfana.app/Contents/MacOS/Erfana')

      const config = getSpawnConfig()

      expect(config.args).toContain('/Users/test/Applications/Erfana.app')
    })

    it('handles exe path with spaces in bundle name', () => {
      mockGetPath.mockReturnValue('/Applications/My Apps.app/Contents/MacOS/MyApp')

      const config = getSpawnConfig()

      expect(config.args).toContain('/Applications/My Apps.app')
    })

    it('falls back to exe path when app bundle not found', () => {
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      const config = getSpawnConfig()

      expect(config.command).toBe('/usr/local/bin/erfana')
      expect(config.args).toEqual(['--new-window'])
    })

    it('logs warning when falling back to exe path', () => {
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      getSpawnConfig()

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Could not find macOS app bundle, falling back to exe path',
        { exePath: '/usr/local/bin/erfana' }
      )
    })

    it('logs debug message with app bundle path', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      getSpawnConfig()

      expect(mockLoggerDebug).toHaveBeenCalledWith('macOS app bundle found', {
        appBundlePath: '/Applications/Erfana.app'
      })
    })

    it('logs debug message with platform and exePath', () => {
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      getSpawnConfig()

      expect(mockLoggerDebug).toHaveBeenCalledWith('Spawn config: production mode', {
        platform: 'darwin',
        exePath: '/Applications/Erfana.app/Contents/MacOS/Erfana'
      })
    })
  })

  describe('production mode - Windows', () => {
    beforeEach(() => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'win32' })
    })

    it('spawns exe directly with --new-window', () => {
      mockGetPath.mockReturnValue('C:\\Program Files\\Erfana\\erfana.exe')

      const config = getSpawnConfig()

      expect(config.command).toBe('C:\\Program Files\\Erfana\\erfana.exe')
      expect(config.args).toEqual(['--new-window'])
    })

    it('uses detached: true and stdio: ignore', () => {
      mockGetPath.mockReturnValue('C:\\Program Files\\Erfana\\erfana.exe')

      const config = getSpawnConfig()

      expect(config.options.detached).toBe(true)
      expect(config.options.stdio).toBe('ignore')
    })

    it('does not use shell option', () => {
      mockGetPath.mockReturnValue('C:\\Program Files\\Erfana\\erfana.exe')

      const config = getSpawnConfig()

      expect(config.options.shell).toBeUndefined()
    })

    it('handles exe path with spaces', () => {
      mockGetPath.mockReturnValue('C:\\Program Files\\My Apps\\Erfana\\erfana.exe')

      const config = getSpawnConfig()

      expect(config.command).toBe('C:\\Program Files\\My Apps\\Erfana\\erfana.exe')
    })

    it('logs debug message with platform and exePath', () => {
      mockGetPath.mockReturnValue('C:\\Program Files\\Erfana\\erfana.exe')

      getSpawnConfig()

      expect(mockLoggerDebug).toHaveBeenCalledWith('Spawn config: production mode', {
        platform: 'win32',
        exePath: 'C:\\Program Files\\Erfana\\erfana.exe'
      })
    })
  })

  describe('production mode - other platforms (dev fallback)', () => {
    // Erfana ships macOS + Windows only. On any other platform (e.g. a Linux
    // dev machine running a production build) getSpawnConfig falls back to
    // spawning the executable directly — no AppImage handling.
    beforeEach(() => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'linux' })
      delete process.env.APPIMAGE
    })

    it('falls back to the exe path with --new-window', () => {
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      const config = getSpawnConfig()

      expect(config.command).toBe('/usr/local/bin/erfana')
      expect(config.args).toEqual(['--new-window'])
    })

    it('ignores the APPIMAGE env var (no AppImage handling)', () => {
      process.env.APPIMAGE = '/tmp/.mount_erfanaXXXXXX/erfana.AppImage'
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      const config = getSpawnConfig()

      expect(config.command).toBe('/usr/local/bin/erfana')
      expect(mockLoggerDebug).not.toHaveBeenCalledWith(
        'Linux AppImage detected',
        expect.any(Object)
      )
    })

    it('uses detached: true, stdio: ignore, and no shell', () => {
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      const config = getSpawnConfig()

      expect(config.options.detached).toBe(true)
      expect(config.options.stdio).toBe('ignore')
      expect(config.options.shell).toBeUndefined()
    })

    it('logs debug message with platform and exePath', () => {
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      getSpawnConfig()

      expect(mockLoggerDebug).toHaveBeenCalledWith('Spawn config: production mode', {
        platform: 'linux',
        exePath: '/usr/local/bin/erfana'
      })
    })
  })
})

describe('spawnNewInstance', () => {
  let originalPlatform: string
  let originalEnv: NodeJS.ProcessEnv
  let mockUnref: ReturnType<typeof vi.fn>
  let mockOn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    originalPlatform = process.platform
    originalEnv = { ...process.env }
    mockIs.dev = false

    // Create fresh mock functions for each test
    mockUnref = vi.fn()
    mockOn = vi.fn()

    mockSpawn.mockReturnValue({
      unref: mockUnref,
      on: mockOn,
      pid: 12345
    } as any)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
    process.env = originalEnv
  })

  describe('successful spawn', () => {
    it('returns true on successful spawn', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const result = spawnNewInstance()

      expect(result).toBe(true)
    })

    it('calls spawn with correct config for development', () => {
      mockIs.dev = true
      mockGetAppPath.mockReturnValue('/path/to/erfana')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith('npm', ['run', 'dev'], {
        shell: true,
        cwd: '/path/to/erfana',
        detached: true,
        stdio: 'ignore'
      })
    })

    it('calls spawn with correct config for macOS production', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith(
        'open',
        ['-n', '-a', '/Applications/Erfana.app', '--args', '--new-window'],
        {
          detached: true,
          stdio: 'ignore'
        }
      )
    })

    it('calls spawn with correct config for Windows production', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'win32' })
      mockGetPath.mockReturnValue('C:\\Program Files\\Erfana\\erfana.exe')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\Program Files\\Erfana\\erfana.exe',
        ['--new-window'],
        {
          detached: true,
          stdio: 'ignore'
        }
      )
    })

    it('calls spawn with the exe fallback on non-darwin/non-win32 platforms', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'linux' })
      delete process.env.APPIMAGE
      mockGetPath.mockReturnValue('/usr/local/bin/erfana')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith('/usr/local/bin/erfana', ['--new-window'], {
        detached: true,
        stdio: 'ignore'
      })
    })

    it('calls unref() on spawned child process', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockUnref).toHaveBeenCalled()
    })

    it('registers error handler on child process', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('logs info message with spawn details', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockLoggerInfo).toHaveBeenCalledWith('Spawning new Erfana instance', {
        command: 'open',
        args: ['-n', '-a', '/Applications/Erfana.app', '--args', '--new-window'],
        isDev: false,
        platform: 'darwin'
      })
    })

    it('logs debug message with child process PID', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockLoggerDebug).toHaveBeenCalledWith('New instance spawn initiated', {
        pid: 12345
      })
    })
  })

  describe('error handling', () => {
    it('returns false when spawn throws exception', () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn ENOENT')
      })

      const result = spawnNewInstance()

      expect(result).toBe(false)
    })

    it('logs error when spawn throws exception', () => {
      const spawnError = new Error('spawn ENOENT')
      mockSpawn.mockImplementation(() => {
        throw spawnError
      })

      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      spawnNewInstance()

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Exception while spawning new instance',
        spawnError,
        {
          isDev: false,
          platform: 'darwin'
        }
      )
    })

    it('handles non-Error exceptions gracefully', () => {
      mockSpawn.mockImplementation(() => {
        throw 'string error'
      })

      const result = spawnNewInstance()

      expect(result).toBe(false)
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Exception while spawning new instance',
        new Error('string error'),
        expect.any(Object)
      )
    })

    it('registers error handler that logs spawn errors', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      const errorHandler = mockOn.mock.calls.find((call) => call[0] === 'error')?.[1]
      expect(errorHandler).toBeDefined()

      const spawnError = new Error('ENOENT')
      errorHandler(spawnError)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Failed to spawn new instance',
        spawnError,
        {
          command: 'open',
          args: ['-n', '-a', '/Applications/Erfana.app', '--args', '--new-window']
        }
      )
    })

    it('error handler does not affect return value', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      const result = spawnNewInstance()

      expect(result).toBe(true)

      const errorHandler = mockOn.mock.calls.find((call) => call[0] === 'error')?.[1]
      errorHandler(new Error('ENOENT'))

      // Still returns true because error happens asynchronously
      expect(result).toBe(true)
    })
  })

  describe('development vs production', () => {
    it('uses npm in development mode', () => {
      mockIs.dev = true
      mockGetAppPath.mockReturnValue('/path/to/erfana')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.any(Array),
        expect.objectContaining({ shell: true })
      )
    })

    it('uses platform-specific command in production', () => {
      mockIs.dev = false
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

      spawnNewInstance()

      expect(mockSpawn).toHaveBeenCalledWith(
        'open',
        expect.any(Array),
        expect.not.objectContaining({ shell: true })
      )
    })
  })
})

describe('findMacOSAppBundle (internal)', () => {
  let originalPlatform: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalPlatform = process.platform
    mockIs.dev = false
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
  })

  it('extracts .app path from Contents/MacOS/exe path', () => {
    mockGetPath.mockReturnValue('/Applications/Erfana.app/Contents/MacOS/Erfana')

    const config = getSpawnConfig()

    expect(config.args).toContain('/Applications/Erfana.app')
  })

  it('extracts .app path from deeply nested exe path', () => {
    mockGetPath.mockReturnValue(
      '/Users/test/Applications/My Apps/Erfana.app/Contents/MacOS/Erfana'
    )

    const config = getSpawnConfig()

    expect(config.args).toContain('/Users/test/Applications/My Apps/Erfana.app')
  })

  it('handles exe path with multiple .app in parent directories', () => {
    mockGetPath.mockReturnValue('/Applications/Apps.app/Subfolder.app/Contents/MacOS/App')

    const config = getSpawnConfig()

    // Should find the closest .app to the exe
    expect(config.args).toContain('/Applications/Apps.app/Subfolder.app')
  })

  it('returns undefined when no .app in path', () => {
    mockGetPath.mockReturnValue('/usr/local/bin/erfana')

    const config = getSpawnConfig()

    // Falls back to exe path
    expect(config.command).toBe('/usr/local/bin/erfana')
  })

  it('handles root-level .app', () => {
    mockGetPath.mockReturnValue('/Erfana.app/Contents/MacOS/Erfana')

    const config = getSpawnConfig()

    expect(config.args).toContain('/Erfana.app')
  })

  it('handles .app with spaces in name', () => {
    mockGetPath.mockReturnValue('/Applications/My Cool App.app/Contents/MacOS/MyApp')

    const config = getSpawnConfig()

    expect(config.args).toContain('/Applications/My Cool App.app')
  })

  it('handles .app with special characters', () => {
    mockGetPath.mockReturnValue('/Applications/My-App_v2.0.app/Contents/MacOS/MyApp')

    const config = getSpawnConfig()

    expect(config.args).toContain('/Applications/My-App_v2.0.app')
  })
})
