// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External File Handlers Tests
 *
 * Covers Spec #012 (external file drop to project tree), end to end through
 * the real handlers and the real `ExternalFileService` on a temp tree:
 *
 * - the target folder resolves against the project the main process has open;
 *   the `projectRoot` argument the renderer still sends is accepted and ignored
 * - a move deletes its source only when the user picked that file in the dialog
 * - validation and the file picker keep their behaviour
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ErrorCode } from '../../shared/errors'

const { handlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => any>,
  showOpenDialog: vi.fn()
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
  dialog: { showOpenDialog, showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('electron-store', () => {
  class MockStore {
    constructor(_opts?: any) {}
    get(_key: string, _def?: any): any {
      return null
    }
    set(_key: string, _val: any): void {}
    delete(_key: string): void {}
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

import { registerExternalFileHandlers } from './external-file-handlers'
import { getConfinedChannels } from './confinement/registerConfinedHandle'
import { externalSourceGrants } from '../services/ExternalSourceGrants'
import { logger } from '../services/LoggingService'
import { openTestProject } from './__test-helpers__/openTestProject'

const OWNER_ID = 1
const event = { sender: { id: OWNER_ID } }
const otherEvent = { sender: { id: OWNER_ID + 1 } }
const invoke = (channel: string, ...args: unknown[]) => handlers[channel](event, ...args)

describe('External File Handlers', () => {
  let base: string
  let root: string
  let outside: string
  let source: string
  let projectService: { session: Parameters<typeof registerExternalFileHandlers>[0] }

  const listDir = (dir: string): string[] => readdirSync(dir).sort()

  /** Pick `source` in the dialog, the way the renderer's shortcut does. */
  const pick = async (...paths: string[]): Promise<void> => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: paths })
    await invoke('file:selectExternalFiles')
  }

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    showOpenDialog.mockReset()
    externalSourceGrants.clear()
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-external-')))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    mkdirSync(path.join(base, 'proj-sibling'), { recursive: true })
    mkdirSync(path.join(outside, 'folder'), { recursive: true })
    writeFileSync(path.join(root, 'a.md'), 'inside')
    source = path.join(outside, 'incoming.md')
    writeFileSync(source, 'incoming')
    // Refusals are logged by design; keep the suite output readable
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await openTestProject(root, { ownerWebContentsId: OWNER_ID })
    projectService = (await import('./file-handlers')).projectService
    registerExternalFileHandlers(projectService.session)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('registration', () => {
    it('registers all required handlers', () => {
      for (const channel of [
        'file:validateExternal',
        'file:copyFromExternal',
        'file:moveFromExternal',
        'file:selectExternalFiles'
      ]) {
        expect(handlers[channel], channel).toBeDefined()
      }
    })

    it('lists every path argument of the confined channels', () => {
      const confined = getConfinedChannels()
      expect([...(confined.get('file:validateExternal') ?? [])]).toEqual(['source'])
      expect([...(confined.get('file:copyFromExternal') ?? [])].sort()).toEqual(['source', 'target'])
      expect([...(confined.get('file:moveFromExternal') ?? [])].sort()).toEqual(['source', 'target'])
    })
  })

  describe('file:validateExternal', () => {
    it('accepts a regular file whatever project root is sent', async () => {
      for (const lying of [root, outside, 'not-even-absolute', undefined]) {
        const result = await invoke('file:validateExternal', source, lying)
        expect(result).toMatchObject({ valid: true, isRegularFile: true })
      }
    })

    it('rejects a folder', async () => {
      const result = await invoke('file:validateExternal', path.join(outside, 'folder'), root)
      expect(result).toMatchObject({
        valid: false,
        isDirectory: true,
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      })
    })

    it('reports a missing file', async () => {
      const result = await invoke('file:validateExternal', path.join(outside, 'gone.md'), root)
      expect(result).toMatchObject({
        valid: false,
        exists: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND
      })
    })

    it('rejects a relative path', async () => {
      const result = await invoke('file:validateExternal', 'relative/path/file.md', root)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Path must be absolute')
      expect(result.errorCode).toBe('VALIDATION_ERROR')
    })

    it('rejects an empty path', async () => {
      const result = await invoke('file:validateExternal', '', root)
      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
    })

    it.skipIf(process.platform === 'win32')(
      'refuses a path inside the project that resolves outside it',
      async () => {
        symlinkSync(path.join(outside, 'incoming.md'), path.join(root, 'link.md'))
        const result = await invoke('file:validateExternal', path.join(root, 'link.md'), root)
        expect(result).toMatchObject({ valid: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      }
    )
  })

  describe('file:copyFromExternal', () => {
    it('copies into a folder of the open project', async () => {
      const target = path.join(root, 'docs')
      const result = await invoke('file:copyFromExternal', source, target, root)

      expect(result).toMatchObject({ success: true, path: path.join(target, 'incoming.md') })
      expect(readFileSync(path.join(target, 'incoming.md'), 'utf8')).toBe('incoming')
      expect(existsSync(source)).toBe(true)
    })

    it('ignores a project root that names another folder', async () => {
      // The renderer claims the outside folder is the project: the copy still
      // goes by the project the main process has open
      const refused = await invoke('file:copyFromExternal', source, path.join(outside, 'folder'), outside)
      expect(refused).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])

      const landed = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), outside)
      expect(landed.success).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual(['incoming.md'])
    })

    it('refuses a folder beside the project whose name starts like the project', async () => {
      const result = await invoke('file:copyFromExternal', source, path.join(base, 'proj-sibling'), base)
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(base, 'proj-sibling'))).toEqual([])
    })

    it('refuses a folder reached through ..', async () => {
      const target = path.join(root, 'docs', '..', '..', 'outside', 'folder')
      const result = await invoke('file:copyFromExternal', source, target, root)
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')('refuses a link inside the project that leads out', async () => {
      symlinkSync(path.join(outside, 'folder'), path.join(root, 'linked'))
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'linked'), root)
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')(
      'will not replace a name inside the project that is a link out',
      async () => {
        const victim = path.join(outside, 'victim.md')
        writeFileSync(victim, 'untouched')
        symlinkSync(victim, path.join(root, 'docs', 'incoming.md'))

        const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'replace')

        expect(result.success).toBe(false)
        expect(readFileSync(victim, 'utf8')).toBe('untouched')
      }
    )

    it('refuses a folder that does not exist', async () => {
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'nope'), root)
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND })
      expect(existsSync(path.join(root, 'nope'))).toBe(false)
    })

    it('refuses a target that is a file', async () => {
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'a.md'), root)
      expect(result.success).toBe(false)
      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
    })

    it('refuses every target when no project is open', async () => {
      await openTestProject(null)
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root)
      expect(result).toMatchObject({ success: false, errorCode: 'NO_PROJECT' })
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('refuses a window that does not own the project', async () => {
      const result = await handlers['file:copyFromExternal'](
        otherEvent,
        source,
        path.join(root, 'docs'),
        root
      )
      expect(result).toMatchObject({ success: false, errorCode: 'NOT_SESSION_OWNER' })
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('keeps both files on a name clash', async () => {
      writeFileSync(path.join(root, 'docs', 'incoming.md'), 'old')
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'keepBoth')
      expect(result).toMatchObject({ success: true, path: path.join(root, 'docs', 'incoming (1).md') })
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('old')
    })

    it('replaces on request', async () => {
      writeFileSync(path.join(root, 'docs', 'incoming.md'), 'old')
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'replace')
      expect(result.success).toBe(true)
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
    })

    it('rejects relative paths and a bad strategy', async () => {
      const relative = await invoke('file:copyFromExternal', source, 'relative/target', root)
      expect(relative).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })

      const strategy = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'overwrite')
      expect(strategy).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
    })

    it('does not need a pick to copy', async () => {
      const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root)
      expect(result.success).toBe(true)
    })
  })

  describe('file:moveFromExternal', () => {
    it('refuses a file that was not picked and leaves both sides alone', async () => {
      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED
      })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('moves a file the user picked in the dialog', async () => {
      await pick(source)

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result).toMatchObject({ success: true, path: path.join(root, 'docs', 'incoming.md') })
      expect(existsSync(source)).toBe(false)
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
    })

    it('uses a pick once', async () => {
      await pick(source)
      await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)
      writeFileSync(source, 'again')

      const second = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(second.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
      expect(readFileSync(source, 'utf8')).toBe('again')
    })

    it('does not move another file than the one picked', async () => {
      const other = path.join(outside, 'other.md')
      writeFileSync(other, 'other')
      await pick(source)

      const result = await invoke('file:moveFromExternal', other, path.join(root, 'docs'), root)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
      expect(existsSync(other)).toBe(true)
    })

    it('does not move a picked file into a folder outside the project', async () => {
      await pick(source)

      const result = await invoke('file:moveFromExternal', source, path.join(outside, 'folder'), outside)

      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it('does not honour a pick made by another window', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
      await handlers['file:selectExternalFiles'](otherEvent)

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
      expect(existsSync(source)).toBe(true)
    })

    it('does not honour a lapsed pick', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        await pick(source)
        vi.setSystemTime(Date.now() + 60 * 60 * 1000)

        const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

        expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
        expect(existsSync(source)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects relative paths', async () => {
      const result = await invoke('file:moveFromExternal', source, 'relative/target', root)
      expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
    })
  })

  describe('file:selectExternalFiles', () => {
    it('opens the dialog and returns file paths', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })

      const result = await invoke('file:selectExternalFiles')

      expect(result).toEqual({ paths: [source] })
      expect(showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['openFile', 'multiSelections'],
          title: 'Select files to add',
          buttonLabel: 'Add to project'
        })
      )
    })

    it('returns null when cancelled', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      expect(await invoke('file:selectExternalFiles')).toBeNull()
    })

    it('returns null when no files selected', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
      expect(await invoke('file:selectExternalFiles')).toBeNull()
    })

    it('records nothing when cancelled', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [source] })
      await invoke('file:selectExternalFiles')

      expect(externalSourceGrants.consume(OWNER_ID, source)).toBe(false)
    })

    it('handles dialog errors', async () => {
      showOpenDialog.mockRejectedValueOnce(new Error('Dialog error'))
      await expect(invoke('file:selectExternalFiles')).rejects.toThrow('Failed to open file picker')
    })
  })
})
