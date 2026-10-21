// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectService.session.test.ts
 *
 * On Windows the project is known by the native realpath spelling, in the
 * result, the lock, the session, recents and the broadcast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { ProjectService } from './ProjectService'
import type { IFileService } from '../interfaces/IFileService'
import type { IFileWatcherService } from '../interfaces/IFileWatcherService'
import type { IDirectoryWatcherService } from '../interfaces/IDirectoryWatcherService'
import type { ISettingsService } from '../interfaces/ISettingsService'
import type { IProjectSettingsService } from '../interfaces/IProjectSettingsService'
import type { IProjectLockService } from '../interfaces/IProjectLockService'

const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { isDestroyed: () => false, webContents: { send: (...args: unknown[]) => mockSend(...args) } }
    ])
  }
}))

vi.mock('../utils/pathSecurity', () => ({
  validatePath: vi.fn(() => Promise.resolve()),
  assertAcceptableProjectRoot: vi.fn()
}))

vi.mock('./LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  realpath: vi.fn(),
  lstat: vi.fn(() => Promise.reject(new Error('ENOENT')))
}))

import { stat, realpath, lstat } from 'fs/promises'
import { logger } from './LoggingService'
import { assertAcceptableProjectRoot } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'

const mockedStat = vi.mocked(stat)
const mockedRealpath = vi.mocked(realpath)

describe('ProjectService – canonical project root', () => {
  let service: ProjectService
  let fileService: IFileService
  let fileWatcherService: IFileWatcherService
  let directoryWatcherService: IDirectoryWatcherService
  let settingsService: ISettingsService
  let projectSettingsService: IProjectSettingsService
  let lockService: IProjectLockService

  beforeEach(() => {
    vi.clearAllMocks()

    fileService = {
      setProjectPath: vi.fn(),
      getProjectPath: vi.fn(() => null),
      setHiddenPatterns: vi.fn(),
      setPathFilter: vi.fn()
    } as any
    fileWatcherService = {
      setProjectPath: vi.fn(),
      stopAll: vi.fn(() => Promise.resolve())
    } as any
    directoryWatcherService = {
      setProjectPath: vi.fn(),
      stopAll: vi.fn(() => Promise.resolve()),
      setPathFilter: vi.fn()
    } as any
    settingsService = {
      setLastProjectPath: vi.fn(() => Promise.resolve()),
      addRecentProject: vi.fn(() => Promise.resolve()),
      clearLastProjectPath: vi.fn(() => Promise.resolve())
    } as any
    projectSettingsService = {
      loadSettings: vi.fn(() =>
        Promise.resolve({
          treeHiddenPatterns: [],
          watcherIgnorePatterns: [],
          excludePatterns: [],
          excludeRejections: []
        })
      ),
      clearSettings: vi.fn(),
      setCurrentSettings: vi.fn()
    } as any
    lockService = {
      acquireLock: vi.fn().mockResolvedValue({ status: 'acquired', lockPath: '/locks/x.lock' }),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      requestFocus: vi.fn().mockResolvedValue(true)
    } as any

    mockedStat.mockResolvedValue({ isDirectory: () => true } as any)
    mockedRealpath.mockImplementation((p) => Promise.resolve(p.toString()))

    service = new ProjectService(
      fileService,
      fileWatcherService,
      directoryWatcherService,
      settingsService,
      projectSettingsService,
      lockService
    )
  })

  const realPlatform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
  })

  const onPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value: platform })
  }

  // Built with the host's separators so no POSIX literal is hard-coded
  const typed = path.resolve(path.join(path.sep, 'users', 'xavier~1', 'notes'))
  const onDisk = path.resolve(path.join(path.sep, 'Users', 'Xavier', 'Notes'))

  it('on Windows, returns, locks, stores and commits the native realpath spelling', async () => {
    onPlatform('win32')
    mockedRealpath.mockImplementation(() => Promise.resolve(onDisk))

    const result = await service.switchProject(typed)

    expect(result).toEqual({ success: true, path: onDisk, action: 'switched' })
    expect(service.session.current()?.root).toBe(onDisk)
    expect(service.session.current()?.realRoot).toBe(onDisk)
    expect(lockService.acquireLock).toHaveBeenCalledWith(onDisk)
    expect(settingsService.addRecentProject).toHaveBeenCalledWith(onDisk, 'Notes')
    expect(mockSend).toHaveBeenCalledWith(
      'project:changed',
      expect.objectContaining({ newPath: onDisk })
    )
  })

  it('resolves the path once per open', async () => {
    onPlatform('win32')
    mockedRealpath.mockImplementation(() => Promise.resolve(onDisk))

    await service.switchProject(typed)

    expect(mockedRealpath).toHaveBeenCalledTimes(1)
  })

  it('on Windows, falls back to the resolved spelling when realpath fails', async () => {
    onPlatform('win32')
    mockedRealpath.mockRejectedValue(new Error('EPERM'))

    const result = await service.switchProject(typed)

    expect(result.path).toBe(typed)
  })

  it('on Windows, keeps a UNC admin-share path as realpath resolved it', async () => {
    onPlatform('win32')
    const unc = '\\\\server\\C$\\Notes'
    mockedRealpath.mockImplementation(() => Promise.resolve(unc))

    const result = await service.switchProject(unc)

    expect(result.path).toBe(unc)
    expect(service.session.current()?.realRoot).toBe(unc)
  })

  it('off Windows, keeps the spelling the caller sent', async () => {
    onPlatform('linux')
    mockedRealpath.mockImplementation(() => Promise.resolve(onDisk))

    const result = await service.switchProject(typed)

    expect(result.path).toBe(typed)
    expect(service.session.current()?.root).toBe(typed)
    expect(service.session.current()?.realRoot).toBe(onDisk)
  })

  it('refuses a project whose real folder is a system folder, before the lock', async () => {
    vi.mocked(assertAcceptableProjectRoot).mockImplementationOnce(() => {
      throw new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
    })
    mockedRealpath.mockImplementation(() => Promise.resolve(onDisk))

    const result = await service.switchProject(typed)

    expect(result.success).toBe(false)
    expect(result.error).toContain('system or sensitive')
    expect(assertAcceptableProjectRoot).toHaveBeenCalledWith(onDisk)
    expect(lockService.acquireLock).not.toHaveBeenCalled()
    expect(service.session.current()).toBeNull()
  })

  it('logs the refusal of a canonical root', async () => {
    vi.mocked(assertAcceptableProjectRoot).mockImplementationOnce(() => {
      throw new AppError('no', ErrorCode.PATH_SYSTEM_DIR)
    })
    mockedRealpath.mockImplementation(() => Promise.resolve(onDisk))

    await service.switchProject(typed)

    expect(logger.warn).toHaveBeenCalledWith(
      'Project switch: canonical root refused',
      expect.objectContaining({ code: ErrorCode.PATH_SYSTEM_DIR })
    )
  })

  it('refuses a link whose target cannot be resolved, before the lock', async () => {
    mockedRealpath.mockRejectedValue(new Error('EACCES'))
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => true } as any)

    const result = await service.switchProject(typed)

    expect(result).toMatchObject({ success: false, errorCode: ErrorCode.SYMLINK_ATTACK })
    expect(lockService.acquireLock).not.toHaveBeenCalled()
  })

  it('still opens a plain folder that realpath cannot resolve', async () => {
    mockedRealpath.mockRejectedValue(new Error('EACCES'))
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => false } as any)

    const result = await service.switchProject(typed)

    expect(result).toMatchObject({ success: true, path: typed })
  })
})
