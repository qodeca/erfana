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
 *   or confirms the move in a native box
 * - validation and the file picker keep their behaviour
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  linkSync,
  lstatSync,
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
import { ExternalMoveConfirmerImpl } from '../services/ExternalMoveConfirmer'
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
  // Answers Cancel unless a test says otherwise
  const confirm = vi.fn()

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
    confirm.mockReset()
    confirm.mockResolvedValue('cancel')
    registerExternalFileHandlers(projectService.session, { confirm })
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
      'replaces a link inside the project by a regular file and writes nothing through it',
      async () => {
        const victim = path.join(outside, 'victim.md')
        writeFileSync(victim, 'untouched')
        symlinkSync(victim, path.join(root, 'docs', 'incoming.md'))

        const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'replace')

        expect(result.success).toBe(true)
        expect(readFileSync(victim, 'utf8')).toBe('untouched')
        expect(lstatSync(path.join(root, 'docs', 'incoming.md')).isSymbolicLink()).toBe(false)
        expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
        expect(listDir(path.join(root, 'docs'))).toEqual(['incoming.md'])
      }
    )

    it.skipIf(process.platform === 'win32')(
      'replaces a hard-linked name without writing into the other name',
      async () => {
        const other = path.join(outside, 'hard.md')
        writeFileSync(other, 'untouched')
        linkSync(other, path.join(root, 'docs', 'incoming.md'))

        const result = await invoke('file:copyFromExternal', source, path.join(root, 'docs'), root, 'replace')

        expect(result.success).toBe(true)
        expect(readFileSync(other, 'utf8')).toBe('untouched')
        expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
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
    it('leaves a file alone when the user cancels, and answers quietly', async () => {
      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
      })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('moves a dropped file after the user confirms, and asks about it', async () => {
      confirm.mockResolvedValueOnce('move')

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result).toMatchObject({ success: true, path: path.join(root, 'docs', 'incoming.md') })
      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, undefined)
      expect(existsSync(source)).toBe(false)
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
    })

    it('asks about a file picked in the dialog too, naming the whole pick', async () => {
      const second = path.join(outside, 'second.md')
      writeFileSync(second, 'second')
      await pick(source, second)
      confirm.mockResolvedValueOnce('move')

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result.success).toBe(true)
      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, [source, second])
    })

    it('does not delete a picked file when the user cancels', async () => {
      await pick(source)

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED)
      expect(existsSync(source)).toBe(true)
    })

    it('does not treat a pick made by another window as a pick', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
      await handlers['file:selectExternalFiles'](otherEvent)

      await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, undefined)
    })

    it('does not treat a file that changed after the pick as picked', async () => {
      await pick(source)
      rmSync(source)
      writeFileSync(source, 'a different file')

      await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, undefined)
    })

    it('does not move a confirmed file into a folder outside the project', async () => {
      confirm.mockResolvedValue('move')

      const result = await invoke('file:moveFromExternal', source, path.join(outside, 'folder'), outside)

      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
      expect(confirm).not.toHaveBeenCalled()
    })

    it('refuses a source that is inside the project and asks nothing', async () => {
      confirm.mockResolvedValue('move')

      const result = await invoke(
        'file:moveFromExternal',
        path.join(root, 'a.md'),
        path.join(root, 'docs'),
        root
      )

      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.EXTERNAL_FILE_IN_PROJECT })
      expect(existsSync(path.join(root, 'a.md'))).toBe(true)
      expect(confirm).not.toHaveBeenCalled()
    })

    it.skipIf(process.platform === 'win32')(
      'refuses a source that is a link to a file inside the project',
      async () => {
        confirm.mockResolvedValue('move')
        const link = path.join(outside, 'to-a.md')
        symlinkSync(path.join(root, 'a.md'), link)

        const result = await invoke('file:moveFromExternal', link, path.join(root, 'docs'), root)

        expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IN_PROJECT)
        expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
      }
    )

    it.skipIf(process.platform === 'win32')(
      'keeps a file that is already the one at the destination (replace)',
      async () => {
        confirm.mockResolvedValue('move')
        // the project's copy and the outside file are one file on disk
        linkSync(source, path.join(root, 'docs', 'incoming.md'))

        const result = await invoke(
          'file:moveFromExternal',
          source,
          path.join(root, 'docs'),
          root,
          'replace'
        )

        expect(result).toMatchObject({ success: false, errorCode: ErrorCode.EXTERNAL_FILE_SAME_FILE })
        expect(readFileSync(source, 'utf8')).toBe('incoming')
        expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
        expect(confirm).not.toHaveBeenCalled()
      }
    )

    it('cancels with no change when the project changed while the box was open', async () => {
      confirm.mockImplementation(async () => {
        await openTestProject(root, { ownerWebContentsId: OWNER_ID, generation: 2 })
        return 'move'
      })

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CHANGED
      })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('cancels with no change when the project was closed while the box was open', async () => {
      confirm.mockImplementation(async () => {
        await openTestProject(null)
        return 'move'
      })

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(existsSync(source)).toBe(true)
    })

    it('cancels with no change when the source changed while the box was open', async () => {
      confirm.mockImplementation(async () => {
        rmSync(source)
        writeFileSync(source, 'swapped in')
        return 'move'
      })

      const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(readFileSync(source, 'utf8')).toBe('swapped in')
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')(
      'cancels with no change when the target folder became a link out while the box was open',
      async () => {
        confirm.mockImplementation(async () => {
          rmSync(path.join(root, 'docs'), { recursive: true })
          symlinkSync(path.join(outside, 'folder'), path.join(root, 'docs'))
          return 'move'
        })

        const result = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)

        expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
        expect(existsSync(source)).toBe(true)
        expect(listDir(path.join(outside, 'folder'))).toEqual([])
      }
    )

    it('asks once for a batch, in a box modal to the window that owns the project', async () => {
      const ownerWindow = { id: 'owner-window' }
      const showBox = vi.fn(async () => ({ response: 0 }))
      const resolveOwner = vi.fn(() => ownerWindow)
      registerExternalFileHandlers(
        projectService.session,
        new ExternalMoveConfirmerImpl({ showBox, resolveOwner, coalesceMs: 0 })
      )
      const second = path.join(outside, 'second.md')
      writeFileSync(second, 'second')

      const [one, two] = await Promise.all([
        invoke('file:moveFromExternal', source, path.join(root, 'docs'), root),
        invoke('file:moveFromExternal', second, path.join(root, 'docs'), root)
      ])

      expect(one.success).toBe(true)
      expect(two.success).toBe(true)
      expect(showBox).toHaveBeenCalledTimes(1)
      expect(showBox.mock.calls[0]).toEqual([ownerWindow, expect.objectContaining({ type: 'question' })])
      expect(resolveOwner).toHaveBeenCalledWith(OWNER_ID)
      expect(listDir(path.join(root, 'docs'))).toEqual(['incoming.md', 'second.md'])
    })

    it('asks once for a whole dialog pick even when the moves arrive one by one', async () => {
      const showBox = vi.fn(async () => ({ response: 0 }))
      registerExternalFileHandlers(
        projectService.session,
        new ExternalMoveConfirmerImpl({ showBox, resolveOwner: () => ({}), coalesceMs: 0 })
      )
      const second = path.join(outside, 'second.md')
      writeFileSync(second, 'second')
      await pick(source, second)

      const one = await invoke('file:moveFromExternal', source, path.join(root, 'docs'), root)
      const two = await invoke('file:moveFromExternal', second, path.join(root, 'docs'), root)

      expect(one.success).toBe(true)
      expect(two.success).toBe(true)
      expect(showBox).toHaveBeenCalledTimes(1)
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

      expect(await externalSourceGrants.batchOf(OWNER_ID, source)).toBeNull()
    })

    it('handles dialog errors', async () => {
      showOpenDialog.mockRejectedValueOnce(new Error('Dialog error'))
      await expect(invoke('file:selectExternalFiles')).rejects.toThrow('Failed to open file picker')
    })
  })
})
