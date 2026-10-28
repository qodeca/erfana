// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectService.session.test.ts
 *
 * The main-owned project session: transitions run one at a time, a failed open
 * leaves the snapshot as it was, and every commit carries a generation number.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { ProjectService } from './ProjectService'
import { ConfinementError } from './session/ProjectSession'
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

import { stat, realpath } from 'fs/promises'
import { BrowserWindow } from 'electron'
import { assertAcceptableProjectRoot, validatePath } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'

const mockedStat = vi.mocked(stat)
const mockedRealpath = vi.mocked(realpath)

const PROJECT_A = path.resolve('/Users/test/projects/a')
const PROJECT_B = path.resolve('/Users/test/projects/b')

/** A promise the test settles by hand, to hold a transition at a chosen step. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('ProjectService – main-owned project session', () => {
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

  describe('serialisation', () => {
    it('runs a second open only after the first has finished', async () => {
      const events: string[] = []
      const firstHeld = deferred()
      vi.mocked(lockService.acquireLock).mockImplementation(async (path: string) => {
        events.push(`lock ${path}`)
        if (path === PROJECT_A) await firstHeld.promise
        return { status: 'acquired', lockPath: '/locks/x.lock' } as any
      })

      const first = service.switchProject(PROJECT_A)
      const second = service.switchProject(PROJECT_B)
      await vi.waitFor(() => expect(events).toEqual([`lock ${PROJECT_A}`]))
      // The second open has not started: no lock request, no snapshot
      expect(service.session.current()).toBeNull()

      firstHeld.resolve()
      await Promise.all([first, second])

      expect(events).toEqual([`lock ${PROJECT_A}`, `lock ${PROJECT_B}`])
      expect(service.session.current()).toMatchObject({ root: PROJECT_B, generation: 2 })
      // Both transitions committed in order, never interleaved
      expect(vi.mocked(fileService.setProjectPath).mock.calls.map(([p]) => p)).toEqual([
        PROJECT_A,
        PROJECT_B
      ])
    })

    it('queues a close behind an open that is still running', async () => {
      const openHeld = deferred()
      vi.mocked(projectSettingsService.loadSettings).mockImplementation(async () => {
        await openHeld.promise
        return {
          treeHiddenPatterns: [],
          watcherIgnorePatterns: [],
          excludePatterns: [],
          excludeRejections: []
        }
      })

      const open = service.switchProject(PROJECT_A)
      const close = service.close({ senderId: 1, reason: 'user' })
      await vi.waitFor(() => expect(projectSettingsService.loadSettings).toHaveBeenCalled())
      // The close found nothing to close yet
      expect(settingsService.clearLastProjectPath).not.toHaveBeenCalled()

      openHeld.resolve()
      await Promise.all([open, close])

      // Open committed first, then the queued close closed that very project
      expect(service.session.current()).toBeNull()
      expect(lockService.releaseLock).toHaveBeenCalledWith(PROJECT_A)
    })

    it('does not let one failed transition block the next', async () => {
      mockedStat.mockRejectedValueOnce(new Error('ENOENT'))

      const failed = service.switchProject(PROJECT_A)
      const next = service.switchProject(PROJECT_B)

      expect((await failed).success).toBe(false)
      expect((await next).action).toBe('switched')
      expect(service.session.current()?.root).toBe(PROJECT_B)
    })

    it('closes the new project only when its generation is the expected one', async () => {
      await service.switchProject(PROJECT_A)
      const staleGeneration = service.session.require().generation
      await service.switchProject(PROJECT_B)

      await service.close({ senderId: null, reason: 'project-deleted', expectedGeneration: staleGeneration })
      expect(service.session.current()?.root).toBe(PROJECT_B)

      const current = service.session.require().generation
      await service.close({ senderId: null, reason: 'project-deleted', expectedGeneration: current })
      expect(service.session.current()).toBeNull()
    })
  })

  describe('a failed open leaves the snapshot', () => {
    it('keeps the open project, its generation and the service paths', async () => {
      await service.switchProject(PROJECT_A)
      const before = service.session.current()
      const listener = vi.fn()
      service.session.onChange(listener)
      vi.mocked(fileService.setProjectPath).mockClear()
      vi.mocked(projectSettingsService.loadSettings).mockRejectedValueOnce(new Error('bad settings'))

      const result = await service.switchProject(PROJECT_B)

      expect(result).toMatchObject({ success: false, path: PROJECT_A, action: 'noop' })
      expect(service.session.current()).toBe(before)
      expect(listener).not.toHaveBeenCalled()
      expect(fileService.setProjectPath).not.toHaveBeenCalled()
    })

    it('refuses a folder whose canonical path is unacceptable, before the watchers stop', async () => {
      await service.switchProject(PROJECT_A)
      const before = service.session.current()
      vi.mocked(assertAcceptableProjectRoot).mockImplementationOnce(() => {
        throw new AppError('Cannot open the top of a drive', ErrorCode.PATH_SYSTEM_DIR)
      })
      vi.mocked(directoryWatcherService.stopAll).mockClear()

      const result = await service.switchProject(PROJECT_B)

      expect(result).toMatchObject({
        success: false,
        path: PROJECT_A,
        action: 'noop',
        errorCode: ErrorCode.PATH_SYSTEM_DIR
      })
      expect(service.session.current()).toBe(before)
      expect(directoryWatcherService.stopAll).not.toHaveBeenCalled()
    })

    it('does not spend a generation number', async () => {
      await service.switchProject(PROJECT_A)
      mockedStat.mockRejectedValueOnce(new Error('ENOENT'))
      await service.switchProject(PROJECT_B)

      await service.switchProject(PROJECT_B)

      expect(service.session.current()).toMatchObject({ root: PROJECT_B, generation: 2 })
    })

    it('keeps the project open when remembering it fails after the commit', async () => {
      vi.mocked(settingsService.setLastProjectPath).mockRejectedValueOnce(new Error('disk full'))

      const result = await service.switchProject(PROJECT_A)

      expect(result).toMatchObject({ success: true, action: 'switched' })
      expect(service.session.current()?.root).toBe(PROJECT_A)
      expect(mockSend).toHaveBeenCalledWith('project:changed', expect.objectContaining({ newPath: PROJECT_A }))
    })
  })

  describe('generation', () => {
    it('adds one per open and one per close', async () => {
      expect(service.session.current()).toBeNull()

      await service.switchProject(PROJECT_A)
      expect(service.session.require().generation).toBe(1)

      await service.switchProject(PROJECT_B)
      expect(service.session.require().generation).toBe(2)

      await service.close({ senderId: null, reason: 'user' })
      await service.switchProject(PROJECT_A)
      expect(service.session.require().generation).toBe(4)
    })

    it('stays put when the same project is opened again', async () => {
      await service.switchProject(PROJECT_A)

      const again = await service.switchProject(PROJECT_A)

      expect(again.action).toBe('noop')
      expect(service.session.require().generation).toBe(1)
    })

    it('is carried by every project:changed event, a close included', async () => {
      await service.switchProject(PROJECT_A)
      await service.switchProject(PROJECT_B)
      await service.close({ senderId: null, reason: 'user' })

      const payloads = mockSend.mock.calls
        .filter(([channel]) => channel === 'project:changed')
        .map(([, payload]) => payload)
      expect(payloads).toEqual([
        { oldPath: null, newPath: PROJECT_A, generation: 1 },
        { oldPath: PROJECT_A, newPath: PROJECT_B, generation: 2 },
        { oldPath: PROJECT_B, newPath: null, generation: 3 }
      ])
    })
  })

  describe('snapshot and onChange', () => {
    it('records the owner and the resolved root', async () => {
      mockedRealpath.mockImplementation((p) => Promise.resolve(`${p.toString()}-real`))

      await service.switchProject(PROJECT_A, { senderId: 42, source: 'dialog' })

      expect(service.session.require()).toEqual({
        generation: 1,
        // On Windows the shown root is the native realpath spelling; elsewhere the typed one
        root: process.platform === 'win32' ? `${PROJECT_A}-real` : PROJECT_A,
        realRoot: `${PROJECT_A}-real`,
        caseSensitive: expect.any(Boolean),
        ownerWebContentsId: 42
      })
    })

    it('tells listeners synchronously at the commit, before the services are given their settings', async () => {
      const order: string[] = []
      service.session.onChange((prev, next) => order.push(`change ${prev?.root ?? 'none'} -> ${next?.root ?? 'none'}`))
      vi.mocked(fileService.setPathFilter).mockImplementation(() => {
        order.push('filter')
      })

      await service.switchProject(PROJECT_A)
      await service.close({ senderId: null, reason: 'user' })

      expect(order).toEqual([`change none -> ${PROJECT_A}`, 'filter', `change ${PROJECT_A} -> none`])
    })

    it('feeds the services from the session, and an empty path on close', async () => {
      await service.switchProject(PROJECT_A)
      await service.close({ senderId: null, reason: 'window-destroyed' })

      for (const target of [fileService, fileWatcherService, directoryWatcherService]) {
        expect(vi.mocked(target.setProjectPath).mock.calls.map(([p]) => p)).toEqual([PROJECT_A, ''])
      }
    })

    it('stops notifying a listener once it unsubscribes, and survives one that throws', async () => {
      const thrower = vi.fn(() => {
        throw new Error('listener bug')
      })
      const healthy = vi.fn()
      const unsubscribe = service.session.onChange(healthy)
      service.session.onChange(thrower)

      await service.switchProject(PROJECT_A)
      unsubscribe()
      await service.switchProject(PROJECT_B)

      expect(healthy).toHaveBeenCalledTimes(1)
      expect(thrower).toHaveBeenCalledTimes(2)
      expect(service.session.current()?.root).toBe(PROJECT_B)
    })

    it('require() throws NO_PROJECT while nothing is open', () => {
      expect(() => service.session.require()).toThrow(ConfinementError)
      try {
        service.session.require()
      } catch (error) {
        expect((error as ConfinementError).code).toBe('NO_PROJECT')
      }
    })
  })

  describe('close', () => {
    it('releases the lock, stops the watchers, forgets the last path and broadcasts', async () => {
      await service.switchProject(PROJECT_A)
      vi.mocked(lockService.releaseLock).mockClear()

      await service.close({ senderId: 1, reason: 'user' })

      expect(lockService.releaseLock).toHaveBeenCalledWith(PROJECT_A)
      expect(fileWatcherService.stopAll).toHaveBeenCalledTimes(2)
      expect(settingsService.clearLastProjectPath).toHaveBeenCalledTimes(1)
      expect(service.session.current()).toBeNull()
    })

    it('keeps the last path when the window is destroyed', async () => {
      await service.switchProject(PROJECT_A)

      await service.close({ senderId: 1, reason: 'window-destroyed' })

      expect(lockService.releaseLock).toHaveBeenCalledWith(PROJECT_A)
      expect(settingsService.clearLastProjectPath).not.toHaveBeenCalled()
    })

    it('does nothing when no project is open', async () => {
      await service.close({ senderId: 1, reason: 'user' })

      expect(lockService.releaseLock).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('lets a new window open the same project after the first one was destroyed', async () => {
      await service.switchProject(PROJECT_A)
      await service.close({ senderId: 1, reason: 'window-destroyed' })

      const result = await service.switchProject(PROJECT_A)

      expect(result.action).toBe('switched')
    })
  })
  describe('a transition that throws', () => {
    it('does not poison the queue for the next one', async () => {
      vi.mocked(validatePath).mockRejectedValueOnce(new Error('disk exploded'))

      const rejected = service.switchProject(PROJECT_A)
      const next = service.switchProject(PROJECT_B)

      await expect(rejected).rejects.toThrow('disk exploded')
      expect((await next).action).toBe('switched')
      expect(service.session.current()?.root).toBe(PROJECT_B)
    })
  })

  describe('steps after the commit', () => {
    it('keep the project open and the lock when one of them fails', async () => {
      vi.mocked(fileService.setPathFilter).mockImplementation(() => {
        throw new Error('filter refused')
      })

      const result = await service.switchProject(PROJECT_A)

      expect(result).toMatchObject({ success: true, action: 'switched' })
      expect(service.session.current()?.root).toBe(PROJECT_A)
      // Never handed back as if the open had failed
      expect(lockService.releaseLock).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith('project:changed', expect.objectContaining({ generation: 1 }))
    })
  })

  describe('settings cache', () => {
    const loaded = {
      treeHiddenPatterns: ['.git'],
      watcherIgnorePatterns: [],
      excludePatterns: [],
      excludeRejections: []
    }

    it('is set at the commit and cleared when the project closes', async () => {
      vi.mocked(projectSettingsService.loadSettings).mockResolvedValue(loaded)

      await service.switchProject(PROJECT_A)
      expect(projectSettingsService.setCurrentSettings).toHaveBeenCalledWith(loaded)

      await service.close({ senderId: null, reason: 'user' })
      expect(projectSettingsService.clearSettings).toHaveBeenCalledTimes(1)
    })

    it('is left alone by a failed open', async () => {
      await service.switchProject(PROJECT_A)
      vi.mocked(projectSettingsService.setCurrentSettings).mockClear()
      mockedStat.mockRejectedValueOnce(new Error('ENOENT'))

      await service.switchProject(PROJECT_B)

      expect(projectSettingsService.setCurrentSettings).not.toHaveBeenCalled()
      expect(projectSettingsService.clearSettings).not.toHaveBeenCalled()
    })
  })

  describe('a step that never settles', () => {
    const STEP_TIMEOUT_MS = 15_000

    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      ['stat', () => mockedStat.mockReturnValueOnce(new Promise(() => {}))],
      ['loadSettings', () => vi.mocked(projectSettingsService.loadSettings).mockReturnValueOnce(new Promise(() => {}))],
      ['realpath', () => mockedRealpath.mockReturnValueOnce(new Promise(() => {}))]
    ])('fails an open when %s hangs, and the next open still runs', async (_name, hang) => {
      hang()

      const hung = service.switchProject(PROJECT_A)
      const next = service.switchProject(PROJECT_B)
      await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS)

      expect(await hung).toMatchObject({ success: false, action: 'noop' })
      expect((await next).action).toBe('switched')
      expect(service.session.current()?.root).toBe(PROJECT_B)
    })

    it('does not free the queue slot before the hung task has settled', async () => {
      mockedStat.mockReturnValueOnce(new Promise(() => {}))
      const order: string[] = []

      const hung = service.switchProject(PROJECT_A).then(() => order.push('hung settled'))
      const next = service.switchProject(PROJECT_B).then(() => order.push('next settled'))
      await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS - 1)
      expect(order).toEqual([])
      expect(lockService.acquireLock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([hung, next])
      expect(order).toEqual(['hung settled', 'next settled'])
    })

    it('still closes the project when releasing its lock hangs', async () => {
      await service.switchProject(PROJECT_A)
      vi.mocked(lockService.releaseLock).mockReturnValueOnce(new Promise(() => {}))

      const closing = service.close({ senderId: null, reason: 'user' })
      await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS)
      await closing

      expect(service.session.current()).toBeNull()
    })
  })

  describe('close from a destroyed window', () => {
    it('is ignored when another window owns the project', async () => {
      await service.switchProject(PROJECT_A, { senderId: 5, source: 'dialog' })
      vi.mocked(lockService.releaseLock).mockClear()

      await service.close({ senderId: 9, reason: 'window-destroyed' })

      expect(service.session.current()?.root).toBe(PROJECT_A)
      expect(lockService.releaseLock).not.toHaveBeenCalled()
    })

    it('closes when the owning window is the one destroyed', async () => {
      await service.switchProject(PROJECT_A, { senderId: 5, source: 'dialog' })

      await service.close({ senderId: 5, reason: 'window-destroyed' })

      expect(service.session.current()).toBeNull()
    })

    it('closes a project that has no owner, whichever window is destroyed', async () => {
      await service.switchProject(PROJECT_A)

      await service.close({ senderId: 9, reason: 'window-destroyed' })

      expect(service.session.current()).toBeNull()
    })

    it('does not let a destroyed window block a user close from elsewhere', async () => {
      await service.switchProject(PROJECT_A, { senderId: 5, source: 'dialog' })

      await service.close({ senderId: 9, reason: 'user' })

      expect(service.session.current()).toBeNull()
    })
  })

  describe('project:changed sender', () => {
    it('skips destroyed windows and keeps going when a send throws', async () => {
      const sent: string[] = []
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
        { isDestroyed: () => true, webContents: { send: () => sent.push('destroyed') } },
        {
          isDestroyed: () => false,
          webContents: {
            send: () => {
              throw new Error('gone')
            }
          }
        },
        { isDestroyed: () => false, webContents: { send: () => sent.push('live') } }
      ] as any)

      await service.switchProject(PROJECT_A)

      expect(sent).toEqual(['live'])
    })
  })
})
