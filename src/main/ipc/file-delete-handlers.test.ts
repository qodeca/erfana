// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `file:deleteFile` / `file:deleteFolder` (#486), end to end through the real
 * handlers and the real `FileService` on a temp tree, with Electron's
 * `shell.trashItem` mocked:
 *
 * - the default moves the item to the trash and never calls `rm`;
 * - a refusal of a free item answers `TRASH_UNAVAILABLE`, of an item in use
 *   `IN_USE`, of an item already gone a rejection; each removes nothing and
 *   logs a fixed category, never a path or the platform's text;
 * - `permanent: true` removes the item without asking the trash, unless the
 *   in-use probe finds it locked – then nothing at all is removed;
 * - the confinement and project-root guards still refuse before the trash is asked;
 * - the trash, the probe and the permanent removal run with Erfana's own watch
 *   handles under the item released, and re-armed after (#486).
 *
 * Split from file-handlers.test.ts because the `fs/promises` mock hoists to
 * module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { handlers, trashItem, rmSpy, renameSpy } = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => any>,
  trashItem: vi.fn<(p: string) => Promise<void>>(),
  rmSpy: vi.fn(),
  renameSpy: vi.fn()
}))

vi.mock('./senderValidation', () => ({
  isTrustedSender: () => true,
  isTrustedAppSender: () => true
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlers[channel] = fn
    }
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem }
}))

vi.mock('electron-store', () => {
  class MockStore {
    get(): unknown {
      return null
    }
    set(): void {}
    delete(): void {}
  }
  return { default: MockStore }
})

vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(async () => ({ status: 'acquired' })),
    releaseLock: vi.fn(async () => {}),
    checkLock: vi.fn(async () => ({ status: 'unlocked' })),
    requestFocus: vi.fn(async () => true),
    cleanupStaleLocks: vi.fn(async () => 0),
    dispose: vi.fn(async () => {})
  }
}))

// Records every `rm` and `rename` (the in-use probe), and still performs them
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  rmSpy.mockImplementation((...args: Parameters<typeof actual.rm>) => actual.rm(...args))
  renameSpy.mockImplementation((...args: Parameters<typeof actual.rename>) => actual.rename(...args))
  return { ...actual, rm: rmSpy, rename: renameSpy }
})

const actualRename = async (from: string, to: string): Promise<void> => {
  const { rename } = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  await rename(from, to)
}

const locked = (): Promise<never> =>
  Promise.reject(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }))

import { registerFileHandlers } from './file-handlers'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { fileWatcherService } from '../services/FileWatcherService'
import type { WatchEvent } from '../../shared/freshness/freshnessTypes'
import { logger } from '../services/LoggingService'
import { openTestProject } from './__test-helpers__/openTestProject'
import { DeleteEntryResultSchema, IN_USE, TRASH_UNAVAILABLE } from '../../shared/ipc/file-schema'

const event = { sender: { id: 1 } }
const invoke = (channel: string, request: unknown) => handlers[channel](event, request)

describe('file:deleteFile / file:deleteFolder', () => {
  let base: string
  let root: string
  let outside: string
  let note: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    trashItem.mockReset()
    trashItem.mockResolvedValue(undefined)
    rmSpy.mockClear()
    renameSpy.mockClear()
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-delete-')))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'docs', 'deep'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(root, 'secret-name.md'), 'x')
    writeFileSync(path.join(root, 'docs', 'deep', 'a.md'), 'a')
    writeFileSync(path.join(outside, 'keep.txt'), 'keep')
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    note = vi.spyOn(directoryWatcherService, 'noteInternalChange')
    await openTestProject(root)
    registerFileHandlers()
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('to the trash (the default)', () => {
    it.each([
      ['file:deleteFile', 'secret-name.md'],
      ['file:deleteFolder', 'docs']
    ])('%s hands the entry to shell.trashItem and never calls rm', async (channel, name) => {
      const target = path.join(root, name)
      const result = await invoke(channel, { filePath: target })

      expect(result).toEqual({ ok: true, trashed: true })
      expect(DeleteEntryResultSchema.parse(result)).toEqual(result)
      expect(trashItem).toHaveBeenCalledTimes(1)
      expect(trashItem).toHaveBeenCalledWith(target)
      expect(rmSpy).not.toHaveBeenCalled()
      // The mock trash moved nothing, so the item is still there: proof that rm did not run
      expect(existsSync(target)).toBe(true)
      expect(note).toHaveBeenCalledWith({ path: target, kind: 'removed', subtree: true })
    })
  })

  describe('when the trash refuses the item', () => {
    beforeEach(() => {
      trashItem.mockRejectedValue(
        new Error(`“secret-name.md” couldn’t be moved to the trash at ${path.join(root, 'secret-name.md')}`)
      )
    })

    it.each([
      ['file:deleteFile', 'secret-name.md'],
      ['file:deleteFolder', 'docs']
    ])('%s answers TRASH_UNAVAILABLE and removes nothing', async (channel, name) => {
      const target = path.join(root, name)
      const result = await invoke(channel, { filePath: target })

      expect(result).toEqual({ ok: false, code: TRASH_UNAVAILABLE })
      expect(DeleteEntryResultSchema.parse(result)).toEqual(result)
      expect(existsSync(target)).toBe(true)
      expect(rmSpy).not.toHaveBeenCalled()
      expect(note).not.toHaveBeenCalled()
    })

    it('probes the item and leaves it where it was', async () => {
      await invoke('file:deleteFolder', { filePath: path.join(root, 'docs') })
      expect(renameSpy).toHaveBeenCalledTimes(2) // away to a hidden sibling, and back
      expect(existsSync(path.join(root, 'docs', 'deep', 'a.md'))).toBe(true)
    })

    it('logs a fixed category and the cause’s name – never the path or the platform’s text', async () => {
      await invoke('file:deleteFile', { filePath: path.join(root, 'secret-name.md') })

      expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1)
      const [, fields] = vi.mocked(logger.warn).mock.calls[0]!
      expect(fields).toEqual({
        entry: '[redacted]/secret-name.md',
        category: 'trash-unavailable',
        cause: 'Error',
        code: 'none'
      })
      const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
      expect(logged).not.toContain(JSON.stringify(base).slice(1, -1))
      expect(logged).not.toContain('couldn’t be moved')
    })
  })

  describe('when the item is in use', () => {
    it.each([
      ['file:deleteFile', 'secret-name.md'],
      ['file:deleteFolder', 'docs']
    ])('%s answers IN_USE when the trash refuses with a lock code, and never probes', async (channel, name) => {
      trashItem.mockImplementation(locked)
      const target = path.join(root, name)

      const result = await invoke(channel, { filePath: target })

      expect(result).toEqual({ ok: false, code: IN_USE })
      expect(DeleteEntryResultSchema.parse(result)).toEqual(result)
      expect(existsSync(target)).toBe(true)
      expect(renameSpy).not.toHaveBeenCalled()
      expect(rmSpy).not.toHaveBeenCalled()
      expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({ category: 'in-use', code: 'EBUSY' })
    })

    it('answers IN_USE when the trash says nothing but the probe cannot rename the item', async () => {
      trashItem.mockRejectedValue(new Error('Failed to perform delete operation'))
      renameSpy.mockImplementationOnce(locked)

      await expect(invoke('file:deleteFolder', { filePath: path.join(root, 'docs') })).resolves.toEqual({
        ok: false,
        code: IN_USE
      })
      expect(existsSync(path.join(root, 'docs', 'deep', 'a.md'))).toBe(true)
    })
  })

  describe('when the item is already gone (a second Delete of an item in the bin)', () => {
    it('rejects with ENOENT instead of offering a permanent delete', async () => {
      const target = path.join(root, 'secret-name.md')
      // The first Delete's trash moved it away while this one was on its way
      trashItem.mockImplementation(async () => {
        rmSync(target)
        throw new Error('Failed to perform delete operation')
      })

      await expect(invoke('file:deleteFile', { filePath: target })).rejects.toThrow('ENOENT')
      expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({ category: 'gone' })
      expect(vi.mocked(logger.error)).not.toHaveBeenCalled()
    })
  })

  describe('permanently, when asked', () => {
    it('file:deleteFile with permanent: true removes the file and never asks the trash', async () => {
      const target = path.join(root, 'secret-name.md')
      await expect(invoke('file:deleteFile', { filePath: target, permanent: true })).resolves.toEqual({
        ok: true,
        trashed: false
      })
      expect(existsSync(target)).toBe(false)
      expect(trashItem).not.toHaveBeenCalled()
    })

    it('file:deleteFolder with permanent: true removes the folder and its contents', async () => {
      const target = path.join(root, 'docs')
      await expect(invoke('file:deleteFolder', { filePath: target, permanent: true })).resolves.toEqual({
        ok: true,
        trashed: false
      })
      expect(existsSync(target)).toBe(false)
      expect(trashItem).not.toHaveBeenCalled()
    })

    it('file:deleteFolder with permanent: true refuses a locked folder with IN_USE and removes nothing', async () => {
      renameSpy.mockImplementationOnce(locked)
      const target = path.join(root, 'docs')

      await expect(invoke('file:deleteFolder', { filePath: target, permanent: true })).resolves.toEqual({
        ok: false,
        code: IN_USE
      })
      expect(rmSpy).not.toHaveBeenCalled()
      expect(existsSync(path.join(target, 'deep', 'a.md'))).toBe(true)
    })

    it.runIf(process.platform === 'win32')(
      'Windows: a folder with a process’s working folder inside is refused whole, not half-deleted',
      async () => {
        writeFileSync(path.join(root, 'docs', 'b.md'), 'b')
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
          cwd: path.join(root, 'docs', 'deep'),
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: 'ignore'
        })
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', () => resolve())
          child.once('error', reject)
        })
        try {
          await expect(
            invoke('file:deleteFolder', { filePath: path.join(root, 'docs'), permanent: true })
          ).resolves.toEqual({ ok: false, code: IN_USE })
          expect(rmSpy).not.toHaveBeenCalled()
          expect(existsSync(path.join(root, 'docs', 'b.md'))).toBe(true)
          expect(existsSync(path.join(root, 'docs', 'deep', 'a.md'))).toBe(true)
        } finally {
          child.kill()
          await new Promise((resolve) => child.once('exit', resolve))
        }
      }
    )

    it.each([false, 'yes', 1])('refuses permanent: %j – only a literal true turns it on', async (permanent) => {
      const target = path.join(root, 'secret-name.md')
      await expect(invoke('file:deleteFile', { filePath: target, permanent })).rejects.toThrow()
      expect(existsSync(target)).toBe(true)
      expect(trashItem).not.toHaveBeenCalled()
    })
  })

  describe('guards run before the trash is asked', () => {
    it.each([true, undefined])('the project root is refused (permanent: %s)', async (permanent) => {
      const request = permanent ? { filePath: root, permanent } : { filePath: root }
      await expect(invoke('file:deleteFolder', request)).rejects.toThrow('project root')
      await expect(invoke('file:deleteFile', request)).rejects.toThrow('project root')
      expect(trashItem).not.toHaveBeenCalled()
      expect(existsSync(root)).toBe(true)
    })

    it.each([
      ['file:deleteFile', () => path.join(outside, 'keep.txt')],
      ['file:deleteFolder', () => outside],
      ['file:deleteFile', () => path.join(root, '..', 'outside', 'keep.txt')]
    ])('%s refuses a path outside the project', async (channel, target) => {
      await expect(invoke(channel, { filePath: target() })).rejects.toThrow('outside the project directory')
      expect(trashItem).not.toHaveBeenCalled()
      expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true)
    })

    it('a folder sent to deleteFile is refused by the entry-type check, not trashed', async () => {
      await expect(invoke('file:deleteFile', { filePath: path.join(root, 'docs') })).rejects.toThrow(
        'Use deleteFolder instead'
      )
      expect(trashItem).not.toHaveBeenCalled()
    })

    it('a missing entry rejects instead of answering TRASH_UNAVAILABLE', async () => {
      await expect(invoke('file:deleteFile', { filePath: path.join(root, 'gone.md') })).rejects.toThrow()
      expect(trashItem).not.toHaveBeenCalled()
    })
  })

  describe('Erfana’s own watch handles (#486)', () => {
    let steps: string[]

    beforeEach(() => {
      steps = []
      for (const [name, owner] of [
        ['files', fileWatcherService],
        ['dirs', directoryWatcherService]
      ] as const) {
        const real = owner.releaseUnder.bind(owner)
        vi.spyOn(owner, 'releaseUnder').mockImplementation(async (realPath) => {
          steps.push(`${name}:release:${path.basename(realPath)}`)
          const rearm = await real(realPath)
          return async () => {
            steps.push(`${name}:rearm`)
            await rearm()
          }
        })
      }
      trashItem.mockImplementation(async () => void steps.push('trash'))
    })

    afterEach(async () => {
      await fileWatcherService.dropOwner('p:delete-test')
    })

    const aroundTrash = ['files:release:docs', 'dirs:release:docs', 'trash', 'files:rearm', 'dirs:rearm']

    it('releases both watchers under the item before the trash, and re-arms them after', async () => {
      await invoke('file:deleteFolder', { filePath: path.join(root, 'docs') })
      expect(steps).toEqual(aroundTrash)
    })

    it('re-arms them after a refusal too, with the probe inside the release', async () => {
      trashItem.mockImplementation(async () => {
        steps.push('trash')
        throw new Error('Failed to perform delete operation')
      })
      renameSpy.mockImplementationOnce(async () => {
        steps.push('probe')
        return locked()
      })
      await expect(invoke('file:deleteFolder', { filePath: path.join(root, 'docs') })).resolves.toEqual({
        ok: false,
        code: IN_USE
      })
      expect(steps).toEqual(['files:release:docs', 'dirs:release:docs', 'trash', 'probe', 'files:rearm', 'dirs:rearm'])
    })

    it('releases around a permanent delete as well', async () => {
      rmSpy.mockImplementationOnce(async () => void steps.push('rm'))
      await invoke('file:deleteFolder', { filePath: path.join(root, 'docs'), permanent: true })
      expect(steps).toEqual(['files:release:docs', 'dirs:release:docs', 'rm', 'files:rearm', 'dirs:rearm'])
    })

    it('releases nothing when a guard refuses the item', async () => {
      await expect(invoke('file:deleteFolder', { filePath: root })).rejects.toThrow('project root')
      await expect(invoke('file:deleteFolder', { filePath: outside })).rejects.toThrow()
      expect(steps).toEqual([])
    })

    it('a file open in a tab below the folder: the trash finds no Erfana handle there, and the tab hears deleted', async () => {
      const events: WatchEvent[] = []
      const reply = await fileWatcherService.subscribe({
        owner: { kind: 'process', ownerId: 'delete-test', onEvent: (event) => events.push(event) },
        watchId: 'w1',
        filePath: path.join(root, 'docs', 'deep', 'a.md'),
        profile: 'editor'
      })
      expect(reply.status).toBe('started')
      const docs = path.join(root, 'docs')
      expect(fileWatcherService.openHandlesUnder(docs)).toBe(1)
      let openAtTrash = -1
      // The trash stand-in moves the folder away by renaming it, as the Recycle Bin does
      trashItem.mockImplementation(async (target) => {
        openAtTrash = fileWatcherService.openHandlesUnder(target)
        await actualRename(target, path.join(base, 'trashed'))
      })

      await expect(invoke('file:deleteFolder', { filePath: docs })).resolves.toEqual({ ok: true, trashed: true })
      expect(openAtTrash).toBe(0)
      expect(events.map((event) => event.kind)).toEqual(['deleted'])
    })
  })
})
