// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External File Handlers Tests
 *
 * Covers Spec #012 (external file drop to project tree), end to end through
 * the real handlers and the real `ExternalFileService` on a temp tree:
 *
 * - the target folder resolves against the project the main process has open;
 *   the requests carry no project root, and one that names a root is refused
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
  renameSync,
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
import {
  ExternalMoveConfirmerImpl,
  MAX_FILES_PER_BOX,
  MAX_WAITING_PER_WINDOW
} from '../services/ExternalMoveConfirmer'
import { EXTERNAL_MOVE_BATCH_MAX } from '../../shared/ipc/external-file-schema'
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
        'file:moveBatchFromExternal',
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
      // The sources of a batch sit in an array: the handler resolves each one itself
      expect([...(confined.get('file:moveBatchFromExternal') ?? [])]).toEqual(['target'])
    })
  })

  describe('file:validateExternal', () => {
    it('accepts a regular file', async () => {
      const result = await invoke('file:validateExternal', { sourcePath: source })
      expect(result).toMatchObject({ valid: true, isRegularFile: true })
    })

    it('refuses a request that names a project root, or any other key', async () => {
      for (const extra of [{ projectRoot: root }, { projectRoot: outside }, { other: 1 }]) {
        const result = await handlers['file:validateExternal'](event, { sourcePath: source, ...extra })
        expect(result).toMatchObject({ valid: false, errorCode: 'VALIDATION_ERROR' })
      }
    })

    it('refuses positional arguments in place of the request object', async () => {
      const result = await handlers['file:validateExternal'](event, source, root)
      expect(result).toMatchObject({ valid: false, errorCode: 'VALIDATION_ERROR' })
    })

    it('rejects a folder', async () => {
      const result = await invoke('file:validateExternal', { sourcePath: path.join(outside, 'folder') })
      expect(result).toMatchObject({
        valid: false,
        isDirectory: true,
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      })
    })

    it('reports a missing file', async () => {
      const result = await invoke('file:validateExternal', { sourcePath: path.join(outside, 'gone.md') })
      expect(result).toMatchObject({
        valid: false,
        exists: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND
      })
    })

    it('rejects a relative path', async () => {
      const result = await invoke('file:validateExternal', { sourcePath: 'relative/path/file.md' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Path must be absolute')
      expect(result.errorCode).toBe('VALIDATION_ERROR')
    })

    it('rejects an empty path', async () => {
      const result = await invoke('file:validateExternal', { sourcePath: '' })
      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
    })

    it.skipIf(process.platform === 'win32')(
      'refuses a path inside the project that resolves outside it',
      async () => {
        symlinkSync(path.join(outside, 'incoming.md'), path.join(root, 'link.md'))
        const result = await invoke('file:validateExternal', { sourcePath: path.join(root, 'link.md') })
        expect(result).toMatchObject({ valid: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      }
    )
  })

  describe('file:copyFromExternal', () => {
    it('copies into a folder of the open project', async () => {
      const target = path.join(root, 'docs')
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: target })

      expect(result).toMatchObject({ success: true, path: path.join(target, 'incoming.md') })
      expect(readFileSync(path.join(target, 'incoming.md'), 'utf8')).toBe('incoming')
      expect(existsSync(source)).toBe(true)
    })

    it('does not take a project root: a request that names one is refused and nothing is copied', async () => {
      // The renderer claims the outside folder is the project: the request is not even read
      const lying = await handlers['file:copyFromExternal'](event, {
        sourcePath: source,
        targetFolder: path.join(outside, 'folder'),
        projectRoot: outside
      })
      expect(lying).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])

      // Without it the copy still goes by the project the main process has open
      const refused = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(outside, 'folder') })
      expect(refused).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])

      const landed = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })
      expect(landed.success).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual(['incoming.md'])
    })

    it('refuses a folder beside the project whose name starts like the project', async () => {
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(base, 'proj-sibling') })
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(base, 'proj-sibling'))).toEqual([])
    })

    it('refuses a folder reached through ..', async () => {
      const target = path.join(root, 'docs', '..', '..', 'outside', 'folder')
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: target })
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')('refuses a link inside the project that leads out', async () => {
      symlinkSync(path.join(outside, 'folder'), path.join(root, 'linked'))
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'linked') })
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')(
      'replaces a link inside the project by a regular file and writes nothing through it',
      async () => {
        const victim = path.join(outside, 'victim.md')
        writeFileSync(victim, 'untouched')
        symlinkSync(victim, path.join(root, 'docs', 'incoming.md'))

        const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'replace' })

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

        const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'replace' })

        expect(result.success).toBe(true)
        expect(readFileSync(other, 'utf8')).toBe('untouched')
        expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
      }
    )

    it('refuses a folder that does not exist', async () => {
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'nope') })
      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND })
      expect(existsSync(path.join(root, 'nope'))).toBe(false)
    })

    it('refuses a target that is a file', async () => {
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'a.md') })
      expect(result.success).toBe(false)
      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
    })

    it('refuses every target when no project is open', async () => {
      await openTestProject(null)
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })
      expect(result).toMatchObject({ success: false, errorCode: 'NO_PROJECT' })
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('refuses a window that does not own the project', async () => {
      const result = await handlers['file:copyFromExternal'](otherEvent, {
        sourcePath: source,
        targetFolder: path.join(root, 'docs')
      })
      expect(result).toMatchObject({ success: false, errorCode: 'NOT_SESSION_OWNER' })
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('keeps both files on a name clash', async () => {
      writeFileSync(path.join(root, 'docs', 'incoming.md'), 'old')
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'keepBoth' })
      expect(result).toMatchObject({ success: true, path: path.join(root, 'docs', 'incoming (1).md') })
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('old')
    })

    it('replaces on request', async () => {
      writeFileSync(path.join(root, 'docs', 'incoming.md'), 'old')
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'replace' })
      expect(result.success).toBe(true)
      expect(readFileSync(path.join(root, 'docs', 'incoming.md'), 'utf8')).toBe('incoming')
    })

    it('rejects relative paths and a bad strategy', async () => {
      const relative = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: 'relative/target' })
      expect(relative).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })

      const strategy = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'overwrite' })
      expect(strategy).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
    })

    it('does not need a pick to copy', async () => {
      const result = await invoke('file:copyFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })
      expect(result.success).toBe(true)
    })
  })

  describe('file:moveFromExternal', () => {
    it('leaves a file alone when the user cancels, and answers quietly', async () => {
      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
      })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual([])
    })

    it('moves a dropped file after the user confirms, and asks about it', async () => {
      confirm.mockResolvedValueOnce('move')

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

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

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(result.success).toBe(true)
      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, [source, second])
    })

    it('does not delete a picked file when the user cancels', async () => {
      await pick(source)

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED)
      expect(existsSync(source)).toBe(true)
    })

    it('does not treat a pick made by another window as a pick', async () => {
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
      await handlers['file:selectExternalFiles'](otherEvent)

      await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, undefined)
    })

    it('does not treat a file that changed after the pick as picked', async () => {
      await pick(source)
      // Keep the picked file alive under another name so the new one cannot reuse its inode
      const kept = path.join(outside, 'kept.md')
      renameSync(source, kept)
      writeFileSync(source, 'a different file')

      await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(confirm).toHaveBeenCalledWith(OWNER_ID, source, undefined)
    })

    it('does not move a confirmed file into a folder outside the project', async () => {
      confirm.mockResolvedValue('move')

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(outside, 'folder') })

      expect(result).toMatchObject({ success: false, errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
      expect(confirm).not.toHaveBeenCalled()
    })

    it('refuses a source that is inside the project and asks nothing', async () => {
      confirm.mockResolvedValue('move')

      const result = await invoke('file:moveFromExternal', { sourcePath: path.join(root, 'a.md'), targetFolder: path.join(root, 'docs') })

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

        const result = await invoke('file:moveFromExternal', { sourcePath: link, targetFolder: path.join(root, 'docs') })

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

        const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'replace' })

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

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

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

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(existsSync(source)).toBe(true)
    })

    it('cancels with no change when the source changed while the box was open', async () => {
      confirm.mockImplementation(async () => {
        renameSync(source, path.join(outside, 'kept-original.md'))
        writeFileSync(source, 'swapped in')
        return 'move'
      })

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

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

        const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

        expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
        expect(existsSync(source)).toBe(true)
        expect(listDir(path.join(outside, 'folder'))).toEqual([])
      }
    )

    it('cancels with no change when the target folder became a file while the box was open', async () => {
      confirm.mockImplementation(async () => {
        rmSync(path.join(root, 'docs'), { recursive: true })
        writeFileSync(path.join(root, 'docs'), 'now a file')
        return 'move'
      })

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(existsSync(source)).toBe(true)
      expect(readFileSync(path.join(root, 'docs'), 'utf8')).toBe('now a file')
    })

    it('leaves no temporary file behind after a replace', async () => {
      confirm.mockResolvedValue('move')
      writeFileSync(path.join(root, 'docs', 'incoming.md'), 'old')

      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs'), conflictResolution: 'replace' })

      expect(result.success).toBe(true)
      expect(listDir(path.join(root, 'docs'))).toEqual(['incoming.md'])
    })

    it('asks once for a batch, in a box modal to the window that owns the project', async () => {
      const ownerWindow = { id: 'owner-window' }
      const showBox = vi.fn(async () => ({ response: 0 }))
      const resolveOwner = vi.fn(() => ownerWindow)
      // The batch window closes only when the test says so, after both moves
      // have reached the confirmer, however slow the file checks before it are
      let closeWindow: () => void = () => {}
      const impl = new ExternalMoveConfirmerImpl({
        showBox,
        resolveOwner,
        schedule: (ask) => {
          closeWindow = ask
        }
      })
      let arrived = 0
      registerExternalFileHandlers(projectService.session, {
        confirm: (...args) => {
          const answer = impl.confirm(...args)
          arrived++
          return answer
        }
      })
      const second = path.join(outside, 'second.md')
      writeFileSync(second, 'second')

      const moves = Promise.all([
        invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') }),
        invoke('file:moveFromExternal', { sourcePath: second, targetFolder: path.join(root, 'docs') })
      ])
      await vi.waitFor(() => expect(arrived).toBe(2))
      await new Promise((resolve) => setImmediate(resolve))
      closeWindow()
      const [one, two] = await moves

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

      const one = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: path.join(root, 'docs') })
      const two = await invoke('file:moveFromExternal', { sourcePath: second, targetFolder: path.join(root, 'docs') })

      expect(one.success).toBe(true)
      expect(two.success).toBe(true)
      expect(showBox).toHaveBeenCalledTimes(1)
    })

    it('rejects relative paths', async () => {
      const result = await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: 'relative/target' })
      expect(result).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
    })
  })

  describe('file:moveBatchFromExternal', () => {
    const docs = (): string => path.join(root, 'docs')
    const request = (paths: string[], extra: Record<string, unknown> = {}) => ({
      items: paths.map((sourcePath) => ({ sourcePath })),
      targetFolder: docs(),
      ...extra
    })
    /** `count` files in the outside folder, besides `source` */
    const makeFiles = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => {
        const file = path.join(outside, `batch-${index}.md`)
        writeFileSync(file, `batch ${index}`)
        return file
      })
    /** The real confirmer behind a box that answers `response` (0 = Move). */
    const useBox = (response: number, deps: Record<string, unknown> = {}) => {
      const showBox = vi.fn(async () => ({ response }))
      registerExternalFileHandlers(
        projectService.session,
        new ExternalMoveConfirmerImpl({ showBox, resolveOwner: () => ({}), coalesceMs: 0, ...deps })
      )
      return showBox
    }

    it('keeps the batch limits in step with the confirmer queue', () => {
      expect(EXTERNAL_MOVE_BATCH_MAX).toBe(MAX_WAITING_PER_WINDOW)
    })

    it('asks once for all the files and moves them in order', async () => {
      const showBox = useBox(0)
      const files = [source, ...makeFiles(3)]

      const response = await invoke('file:moveBatchFromExternal', request(files))

      expect(showBox).toHaveBeenCalledTimes(1)
      expect(showBox.mock.calls[0][1]).toMatchObject({ message: 'Move 4 files into the project?' })
      expect(response.results).toHaveLength(4)
      response.results.forEach((result: { success: boolean; path: string }, index: number) => {
        expect(result).toMatchObject({
          success: true,
          path: path.join(docs(), path.basename(files[index]))
        })
      })
      for (const file of files) expect(existsSync(file)).toBe(false)
      expect(listDir(docs())).toEqual(files.map((file) => path.basename(file)).sort())
    })

    it('asks once for a single file too, worded for one file', async () => {
      const showBox = useBox(0)

      const response = await invoke('file:moveBatchFromExternal', request([source]))

      expect(response.results).toEqual([
        { success: true, path: path.join(docs(), 'incoming.md'), isSymlink: false }
      ])
      expect(showBox).toHaveBeenCalledTimes(1)
      expect(showBox.mock.calls[0][1]).toMatchObject({ message: 'Move "incoming.md" into the project?' })
    })

    it('moves nothing when the user cancels, and approves nothing for later', async () => {
      const showBox = useBox(1)
      const files = [source, ...makeFiles(2)]

      const response = await invoke('file:moveBatchFromExternal', request(files))

      expect(response.results).toHaveLength(3)
      for (const result of response.results) {
        expect(result).toMatchObject({
          success: false,
          errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
        })
      }
      for (const file of files) expect(existsSync(file)).toBe(true)
      expect(listDir(docs())).toEqual([])
      expect(showBox).toHaveBeenCalledTimes(1)

      // A single move afterwards has no approval to lean on: it asks again
      await invoke('file:moveFromExternal', { sourcePath: source, targetFolder: docs() })
      expect(showBox).toHaveBeenCalledTimes(2)
      expect(existsSync(source)).toBe(true)
    })

    it('approves nothing for a single move after the batch was answered Move', async () => {
      const showBox = useBox(0)
      const files = [source, ...makeFiles(1)]
      await invoke('file:moveBatchFromExternal', request(files))
      expect(showBox).toHaveBeenCalledTimes(1)

      // Both files were moved by the batch; a new file needs its own answer
      const again = path.join(outside, 'again.md')
      writeFileSync(again, 'again')
      await invoke('file:moveFromExternal', { sourcePath: again, targetFolder: docs() })
      expect(showBox).toHaveBeenCalledTimes(2)
    })

    it('keeps the ten files to a box and asks again for a larger batch', async () => {
      const showBox = useBox(0)
      const files = makeFiles(MAX_FILES_PER_BOX + 2)

      const response = await invoke('file:moveBatchFromExternal', request(files))

      expect(showBox).toHaveBeenCalledTimes(2)
      expect(showBox.mock.calls[0][1]).toMatchObject({ message: `Move ${MAX_FILES_PER_BOX} files into the project?` })
      expect(showBox.mock.calls[1][1]).toMatchObject({ message: 'Move 2 files into the project?' })
      expect(response.results.every((result: { success: boolean }) => result.success)).toBe(true)
    })

    it('answers each box on its own: cancel on the second leaves the first moved', async () => {
      const showBox = vi.fn()
      showBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
      registerExternalFileHandlers(
        projectService.session,
        new ExternalMoveConfirmerImpl({ showBox, resolveOwner: () => ({}), coalesceMs: 0 })
      )
      const files = makeFiles(MAX_FILES_PER_BOX + 1)

      const response = await invoke('file:moveBatchFromExternal', request(files))

      const moved = response.results.filter((result: { success: boolean }) => result.success)
      const cancelled = response.results.filter(
        (result: { errorCode?: string }) => result.errorCode === ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
      )
      expect(moved).toHaveLength(MAX_FILES_PER_BOX)
      expect(cancelled).toHaveLength(1)
      expect(existsSync(files[MAX_FILES_PER_BOX])).toBe(true)
    })

    it('answers every file as unavailable when the box rate cap is used up', async () => {
      const showBox = useBox(0, { rateCap: { allow: () => false } })
      const files = [source, ...makeFiles(1)]

      const response = await invoke('file:moveBatchFromExternal', request(files))

      expect(showBox).not.toHaveBeenCalled()
      for (const result of response.results) {
        expect(result).toMatchObject({
          success: false,
          errorCode: ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED
        })
      }
      for (const file of files) expect(existsSync(file)).toBe(true)
    })

    it('does not name a file that cannot be moved in the box, and reports it on its own', async () => {
      const showBox = useBox(0)
      const second = makeFiles(1)[0]
      const folder = path.join(outside, 'folder')

      const response = await invoke('file:moveBatchFromExternal', request([source, folder, second]))

      expect(showBox).toHaveBeenCalledTimes(1)
      expect(showBox.mock.calls[0][1]).toMatchObject({ message: 'Move 2 files into the project?' })
      expect(response.results[0].success).toBe(true)
      expect(response.results[1]).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      })
      expect(response.results[2].success).toBe(true)
      expect(existsSync(folder)).toBe(true)
    })

    it('reports a file already in the project without asking about it', async () => {
      const showBox = useBox(0)

      const response = await invoke('file:moveBatchFromExternal', request([path.join(root, 'a.md'), source]))

      expect(response.results[0]).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_IN_PROJECT
      })
      expect(response.results[1].success).toBe(true)
      expect(showBox.mock.calls[0][1]).toMatchObject({ message: 'Move "incoming.md" into the project?' })
      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
    })

    it('settles each file’s name conflict as the request says', async () => {
      useBox(0)
      const second = makeFiles(1)[0]
      writeFileSync(path.join(docs(), 'incoming.md'), 'old')
      writeFileSync(path.join(docs(), path.basename(second)), 'old')

      const response = await invoke('file:moveBatchFromExternal', {
        items: [
          { sourcePath: source, conflictResolution: 'keepBoth' },
          { sourcePath: second, conflictResolution: 'replace' }
        ],
        targetFolder: docs()
      })

      expect(response.results[0]).toMatchObject({ success: true, path: path.join(docs(), 'incoming (1).md') })
      expect(response.results[1]).toMatchObject({ success: true, path: path.join(docs(), path.basename(second)) })
      expect(readFileSync(path.join(docs(), 'incoming.md'), 'utf8')).toBe('old')
      expect(readFileSync(path.join(docs(), path.basename(second)), 'utf8')).toBe('batch 0')
    })

    it('refuses the whole request when the target is outside the project, without asking', async () => {
      const showBox = useBox(0)

      const response = await invoke('file:moveBatchFromExternal', {
        items: [{ sourcePath: source }],
        targetFolder: path.join(outside, 'folder')
      })

      expect(response).toMatchObject({ results: [], errorCode: ErrorCode.PATH_OUTSIDE_PROJECT })
      expect(showBox).not.toHaveBeenCalled()
      expect(existsSync(source)).toBe(true)
      expect(listDir(path.join(outside, 'folder'))).toEqual([])
    })

    it('refuses the whole request from a window that does not own the project', async () => {
      const showBox = useBox(0)

      const response = await handlers['file:moveBatchFromExternal'](otherEvent, request([source]))

      expect(response).toMatchObject({ results: [], errorCode: 'NOT_SESSION_OWNER' })
      expect(showBox).not.toHaveBeenCalled()
      expect(existsSync(source)).toBe(true)
    })

    it('refuses the whole request when no project is open', async () => {
      const showBox = useBox(0)
      await openTestProject(null)

      const response = await invoke('file:moveBatchFromExternal', request([source]))

      expect(response).toMatchObject({ results: [], errorCode: 'NO_PROJECT' })
      expect(showBox).not.toHaveBeenCalled()
      expect(existsSync(source)).toBe(true)
    })

    it('cancels every file when the project changed while the box was open', async () => {
      const showBox = vi.fn(async () => {
        // The user opens another project before answering
        await openTestProject(root, { ownerWebContentsId: OWNER_ID, generation: 2 })
        return { response: 0 }
      })
      registerExternalFileHandlers(
        projectService.session,
        new ExternalMoveConfirmerImpl({ showBox, resolveOwner: () => ({}), coalesceMs: 0 })
      )
      const files = [source, ...makeFiles(1)]

      const response = await invoke('file:moveBatchFromExternal', request(files))

      for (const result of response.results) {
        expect(result).toMatchObject({
          success: false,
          errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CHANGED
        })
      }
      for (const file of files) expect(existsSync(file)).toBe(true)
      expect(listDir(docs())).toEqual([])
    })

    describe('limits and shape of the request', () => {
      it('refuses an empty request', async () => {
        const response = await invoke('file:moveBatchFromExternal', request([]))
        expect(response).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
      })

      it('refuses more files than one request may carry, and asks about none', async () => {
        const showBox = useBox(0)
        const paths = Array.from({ length: EXTERNAL_MOVE_BATCH_MAX + 1 }, (_, index) =>
          path.join(outside, `many-${index}.md`)
        )
        const response = await invoke('file:moveBatchFromExternal', request(paths))
        expect(response).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
        expect(showBox).not.toHaveBeenCalled()
      })

      it('refuses the same file listed twice', async () => {
        const response = await invoke('file:moveBatchFromExternal', request([source, source]))
        expect(response).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
      })

      it('refuses a relative source or target', async () => {
        const relativeSource = await invoke('file:moveBatchFromExternal', request(['relative/file.md']))
        expect(relativeSource).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
        const relativeTarget = await invoke('file:moveBatchFromExternal', {
          items: [{ sourcePath: source }],
          targetFolder: 'relative/target'
        })
        expect(relativeTarget).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
        expect(existsSync(source)).toBe(true)
      })

      it('refuses a project root, an unknown key, an unknown strategy and positional arguments', async () => {
        for (const bad of [
          request([source], { projectRoot: root }),
          request([source], { other: 1 }),
          { items: [{ sourcePath: source, other: 1 }], targetFolder: docs() },
          { items: [{ sourcePath: source, conflictResolution: 'overwrite' }], targetFolder: docs() },
          { items: [source], targetFolder: docs() }
        ]) {
          const response = await handlers['file:moveBatchFromExternal'](event, bad)
          expect(response).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
        }
        const positional = await handlers['file:moveBatchFromExternal'](event, [source], docs())
        expect(positional).toMatchObject({ results: [], errorCode: 'VALIDATION_ERROR' })
        expect(existsSync(source)).toBe(true)
        expect(listDir(docs())).toEqual([])
      })
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
