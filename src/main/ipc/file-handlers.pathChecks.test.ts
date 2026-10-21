// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Path checks for every `file:*` channel, end to end through the real
 * handlers and the real `FileService` on a temp tree:
 *
 * - coverage: each registered `file:*` channel is confined or on an explicit
 *   allow-list, and each lists every path argument it takes;
 * - ordering: a path outside the project is refused before the service's first `stat`;
 * - negative contract: every channel refuses outside paths and links that lead
 *   out, and touches nothing;
 * - positive contract: inside paths work, and answers keep the spelling the
 *   caller used.
 *
 * Split from file-handlers.test.ts because the `fs/promises` mock hoists to
 * module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
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

const { handlers, showItemInFolder, statSpy, realStat } = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => any>,
  showItemInFolder: vi.fn(),
  statSpy: vi.fn(),
  realStat: { current: undefined as unknown as (...args: any[]) => Promise<unknown> }
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
  shell: { showItemInFolder }
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

// Records every `stat` the services make, and still performs it
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  realStat.current = actual.stat as never
  return { ...actual, stat: statSpy }
})

import { registerFileHandlers } from './file-handlers'
import { getConfinedChannels } from './confinement/registerConfinedHandle'
import { fileService } from '../services/FileService'
import { logger } from '../services/LoggingService'
import { openTestProject } from './__test-helpers__/openTestProject'

const event = { sender: { id: 1 } }
const invoke = (channel: string, ...args: unknown[]) => handlers[channel](event, ...args)

/** Channels that take no path argument, or whose path comes from a native dialog. */
const UNCONFINED_ALLOW_LIST: Readonly<Record<string, string>> = {
  'file:openProject': 'dialog: the path comes from the native folder picker in main',
  'file:getSession': 'takes no argument',
  'file:getProjectPath': 'takes no argument',
  'file:closeProject': 'takes a generation number, not a path'
}

/** The path arguments each confined channel must list. */
const EXPECTED_PATH_ARGS: Readonly<Record<string, readonly string[]>> = {
  'file:openProjectByPath': ['projectPath'],
  'file:readDirectory': ['dirPath'],
  'file:readFile': ['filePath'],
  'file:readImage': ['filePath'],
  'file:writeFile': ['filePath'],
  'file:getStats': ['filePath'],
  'file:exists': ['filePath'],
  'file:createFile': ['dirPath'],
  'file:createFolder': ['dirPath'],
  'file:deleteFile': ['filePath'],
  'file:deleteFolder': ['folderPath'],
  'file:rename': ['oldPath'],
  'file:moveItem': ['sourcePath', 'targetParentPath'],
  'file:copyItem': ['sourcePath', 'sourceEntry', 'targetParentPath'],
  'file:checkConflict': ['targetParentPath'],
  'file:revealInFileManager': ['filePath'],
  'file:validatePath': ['filePath']
}

describe('file:* path checks', () => {
  let base: string
  let root: string
  let outside: string

  const listOutside = (): string[] => readdirSync(outside).sort()

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    statSpy.mockReset()
    statSpy.mockImplementation((...args: any[]) => realStat.current(...args))
    showItemInFolder.mockClear()
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-path-checks-')))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    mkdirSync(path.join(outside, 'folder'), { recursive: true })
    writeFileSync(path.join(root, 'a.md'), 'inside')
    writeFileSync(path.join(root, 'pic.png'), 'png')
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    writeFileSync(path.join(outside, 'pic.png'), 'png')
    writeFileSync(path.join(outside, 'folder', 'keep.txt'), 'keep')
    if (process.platform !== 'win32') {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.md'))
      symlinkSync(outside, path.join(root, 'dirlink'))
    }
    // Refusals and failures are logged by design; keep the suite output readable
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await openTestProject(root)
    registerFileHandlers()
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('coverage', () => {
    it('every registered file:* channel is confined or on the explicit allow-list', () => {
      const confined = getConfinedChannels()
      const registered = Object.keys(handlers).filter((channel) => channel.startsWith('file:'))
      expect(registered.length).toBeGreaterThan(Object.keys(UNCONFINED_ALLOW_LIST).length)
      const unaccounted = registered.filter(
        (channel) => !confined.has(channel) && !(channel in UNCONFINED_ALLOW_LIST)
      )
      expect(unaccounted).toEqual([])
    })

    it('the allow-list holds no channel that is gone or already confined', () => {
      const confined = getConfinedChannels()
      for (const channel of Object.keys(UNCONFINED_ALLOW_LIST)) {
        expect(handlers[channel], channel).toBeDefined()
        expect(confined.has(channel), channel).toBe(false)
      }
    })

    it('each confined channel lists exactly the path arguments it takes', () => {
      const confined = getConfinedChannels()
      for (const [channel, names] of confined) {
        if (!channel.startsWith('file:')) continue
        expect(EXPECTED_PATH_ARGS[channel], `${channel} is missing from the expected table`).toBeDefined()
        expect([...names].sort(), channel).toEqual([...EXPECTED_PATH_ARGS[channel]].sort())
      }
      for (const channel of Object.keys(EXPECTED_PATH_ARGS)) {
        expect(confined.has(channel), channel).toBe(true)
      }
    })
  })

  describe('ordering: the check runs before the first stat', () => {
    it.each([
      ['file:deleteFile', () => [path.join(outside, 'secret.txt')]],
      ['file:deleteFolder', () => [path.join(outside, 'folder')]],
      ['file:rename', () => [path.join(outside, 'secret.txt'), 'renamed.txt']],
      ['file:moveItem', () => [path.join(outside, 'secret.txt'), path.join(root, 'sub')]],
      ['file:moveItem', () => [path.join(root, 'a.md'), path.join(outside, 'folder')]],
      ['file:copyItem', () => [path.join(root, 'a.md'), path.join(outside, 'folder')]],
      ['file:createFile', () => [outside, 'new.md']]
    ])('%s with an outside path never calls stat', async (channel, args) => {
      await expect(invoke(channel, ...args())).rejects.toThrow('outside the project directory')
      expect(statSpy).not.toHaveBeenCalled()
    })

    it('an outside path that does not exist is refused the same way as one that does', async () => {
      const existing = await invoke('file:deleteFile', path.join(outside, 'secret.txt')).catch((e) => e.message)
      const missing = await invoke('file:deleteFile', path.join(outside, 'no-such.txt')).catch((e) => e.message)
      expect(missing).toBe(existing)
      expect(statSpy).not.toHaveBeenCalled()
    })

    it('control: a path inside the project does reach stat', async () => {
      await invoke('file:deleteFile', path.join(root, 'a.md'))
      expect(statSpy).toHaveBeenCalled()
    })
  })

  describe('negative contract: outside paths are refused and nothing is touched', () => {
    const refused = (channel: string, args: () => unknown[]) =>
      expect(invoke(channel, ...args())).rejects.toThrow('outside the project directory')

    it.each([
      ['file:readDirectory', () => [outside]],
      ['file:readFile', () => [path.join(outside, 'secret.txt')]],
      ['file:readImage', () => [path.join(outside, 'pic.png')]],
      ['file:writeFile', () => [path.join(outside, 'secret.txt'), 'overwritten']],
      ['file:writeFile', () => [path.join(outside, 'new.md'), 'x']],
      ['file:writeFile', () => [path.join(outside, 'deep', 'er', 'new.md'), 'x', { createParentDirs: true }]],
      ['file:createFile', () => [outside, 'created']],
      ['file:createFolder', () => [outside, 'created']],
      ['file:deleteFile', () => [path.join(outside, 'secret.txt')]],
      ['file:deleteFolder', () => [path.join(outside, 'folder')]],
      ['file:rename', () => [path.join(outside, 'secret.txt'), 'renamed']],
      ['file:moveItem', () => [path.join(outside, 'secret.txt'), path.join(root, 'sub')]],
      ['file:moveItem', () => [path.join(root, 'a.md'), path.join(outside, 'folder')]],
      ['file:copyItem', () => [path.join(outside, 'secret.txt'), path.join(root, 'sub')]],
      ['file:copyItem', () => [path.join(root, 'a.md'), path.join(outside, 'folder')]],
      ['file:checkConflict', () => [outside, 'secret.txt']]
    ])('%s', async (channel, args) => {
      await refused(channel, args)
      expect(listOutside()).toEqual(['folder', 'pic.png', 'secret.txt'])
      expect(readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret')
      expect(readdirSync(path.join(outside, 'folder'))).toEqual(['keep.txt'])
      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
    })

    it('read channels keep the read wording; channels that change things name a link as a reason', async () => {
      const outsideFile = path.join(outside, 'secret.txt')
      await expect(invoke('file:readFile', outsideFile)).rejects.toThrow(
        'Cannot read files outside the project directory'
      )
      for (const [channel, args] of [
        ['file:writeFile', [outsideFile, 'x']],
        ['file:createFile', [outside, 'n']],
        ['file:deleteFile', [outsideFile]],
        ['file:rename', [outsideFile, 'n']],
        ['file:moveItem', [path.join(root, 'a.md'), outside]],
        ['file:copyItem', [path.join(root, 'a.md'), outside]]
      ] as Array<[string, unknown[]]>) {
        await expect(invoke(channel, ...args), channel).rejects.toThrow(
          'Cannot change files outside the project directory, or through a link that leads outside it'
        )
      }
    })

    it('a missing target reads as "not found"', async () => {
      await expect(invoke('file:createFile', path.join(root, 'nope'), 'n')).rejects.toThrow('Item not found')
    })

    it('file:revealInFileManager answers with a message and never opens the file manager', async () => {
      await expect(invoke('file:revealInFileManager', path.join(outside, 'secret.txt'))).resolves.toBe(
        'Cannot reveal items outside the project'
      )
      expect(showItemInFolder).not.toHaveBeenCalled()
    })

    it('file:exists answers false for a value that is not a usable absolute path', async () => {
      await expect(invoke('file:exists', 'relative/path.md')).resolves.toBe(false)
      await expect(invoke('file:exists', '')).resolves.toBe(false)
      await expect(invoke('file:exists', path.join(outside, 'secret.txt'))).resolves.toBe(true)
      if (process.platform !== 'win32') {
        // A link inside the project that leads out does not answer as an existing file
        await expect(invoke('file:exists', path.join(root, 'link.md'))).resolves.toBe(false)
        await expect(invoke('file:exists', path.join(root, 'a.md'))).resolves.toBe(true)
      }
    })

    it('file:openProjectByPath refuses a value that is not an absolute path', async () => {
      await expect(invoke('file:openProjectByPath', 'relative/project')).rejects.toThrow('Invalid file path')
    })

    it.skipIf(process.platform === 'win32')(
      'file:validatePath checks the system folders on the canonical path',
      async () => {
        const blocked = { exists: false, error: 'Access to system paths not allowed' }
        await expect(invoke('file:validatePath', '/etc/hosts')).resolves.toEqual(blocked)
        if (process.platform === 'darwin') {
          await expect(invoke('file:validatePath', '/private/etc/hosts')).resolves.toEqual(blocked)
        }
        // A link in the project that leads into a system folder is judged by where it leads
        symlinkSync('/etc', path.join(root, 'sysetc'))
        await expect(invoke('file:validatePath', path.join(root, 'sysetc', 'hosts'))).resolves.toEqual(blocked)
      }
    )

    it('file:validatePath still reports on a path outside, and refuses a malformed one', async () => {
      await expect(invoke('file:validatePath', 'relative.md')).resolves.toEqual({
        exists: false,
        error: 'Invalid file path'
      })
    })

    it('a project-relative value is not resolved against anything', async () => {
      await expect(invoke('file:readFile', 'a.md')).rejects.toThrow('Invalid file path')
      await expect(invoke('file:createFile', 'sub', 'x')).rejects.toThrow('Invalid file path')
    })

    describe.skipIf(process.platform === 'win32')('through a link inside the project that leads out', () => {
      it.each([
        ['file:readDirectory', () => [path.join(root, 'dirlink')]],
        ['file:readFile', () => [path.join(root, 'link.md')]],
        ['file:readImage', () => [path.join(root, 'dirlink', 'pic.png')]],
        ['file:writeFile', () => [path.join(root, 'link.md'), 'overwritten']],
        ['file:writeFile', () => [path.join(root, 'dirlink', 'new.md'), 'x']],
        ['file:writeFile', () => [path.join(root, 'dirlink', 'er', 'new.md'), 'x', { createParentDirs: true }]],
        ['file:createFile', () => [path.join(root, 'dirlink'), 'created']],
        ['file:createFolder', () => [path.join(root, 'dirlink'), 'created']],
        ['file:deleteFile', () => [path.join(root, 'dirlink', 'secret.txt')]],
        ['file:deleteFolder', () => [path.join(root, 'dirlink', 'folder')]],
        ['file:rename', () => [path.join(root, 'dirlink', 'secret.txt'), 'renamed']],
        ['file:moveItem', () => [path.join(root, 'a.md'), path.join(root, 'dirlink')]],
        ['file:moveItem', () => [path.join(root, 'dirlink', 'secret.txt'), path.join(root, 'sub')]],
        ['file:copyItem', () => [path.join(root, 'link.md'), path.join(root, 'sub')]],
        ['file:copyItem', () => [path.join(root, 'a.md'), path.join(root, 'dirlink')]],
        ['file:checkConflict', () => [path.join(root, 'dirlink'), 'secret.txt']]
      ])('%s', async (channel, args) => {
        await refused(channel, args)
        expect(listOutside()).toEqual(['folder', 'pic.png', 'secret.txt'])
        expect(readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret')
        expect(readdirSync(path.join(outside, 'folder'))).toEqual(['keep.txt'])
      })

      it('file:getStats refuses a path that looks inside and leads out', async () => {
        await expect(invoke('file:getStats', path.join(root, 'link.md'))).rejects.toThrow(
          'outside the project directory'
        )
      })

      it('file:revealInFileManager refuses it with a message', async () => {
        await expect(invoke('file:revealInFileManager', path.join(root, 'dirlink'))).resolves.toBe(
          'Cannot reveal items outside the project'
        )
        expect(showItemInFolder).not.toHaveBeenCalled()
      })
    })

    it('every channel refuses when no project is open', async () => {
      await openTestProject(null)
      for (const [channel, args] of [
        ['file:readDirectory', [root]],
        ['file:readFile', [path.join(root, 'a.md')]],
        ['file:readImage', [path.join(root, 'pic.png')]],
        ['file:writeFile', [path.join(root, 'a.md'), 'x']],
        ['file:createFile', [root, 'n']],
        ['file:createFolder', [root, 'n']],
        ['file:deleteFile', [path.join(root, 'a.md')]],
        ['file:deleteFolder', [path.join(root, 'sub')]],
        ['file:rename', [path.join(root, 'a.md'), 'n']],
        ['file:moveItem', [path.join(root, 'a.md'), path.join(root, 'sub')]],
        ['file:copyItem', [path.join(root, 'a.md'), path.join(root, 'sub')]],
        ['file:checkConflict', [root, 'a.md']]
      ] as Array<[string, unknown[]]>) {
        await expect(invoke(channel, ...args), channel).rejects.toThrow('No project is open')
      }
      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('inside')
    })

    it.each(['.', '..'])('rejects the dot-segment name %j on every channel that takes a name', async (name) => {
      const before = readdirSync(base).sort()
      await expect(invoke('file:createFile', root, name)).rejects.toThrow('Invalid')
      await expect(invoke('file:createFolder', root, name)).rejects.toThrow('Invalid')
      await expect(invoke('file:rename', path.join(root, 'a.md'), name)).rejects.toThrow('Invalid')
      await expect(
        invoke('file:moveItem', path.join(root, 'a.md'), path.join(root, 'sub'), name)
      ).rejects.toThrow('Invalid')
      await expect(invoke('file:copyItem', path.join(root, 'sub'), root, name)).rejects.toThrow('Invalid')
      expect(readdirSync(base).sort()).toEqual(before)
    })

    it.each(['...', '.. '])('a name such as %j never lands outside the folder it is placed in', async (name) => {
      const before = readdirSync(base).sort()
      await invoke('file:copyItem', path.join(root, 'sub'), root, name).catch(() => undefined)
      expect(readdirSync(base).sort()).toEqual(before)
    })

    it('names with a separator are rejected, not stripped', async () => {
      await expect(invoke('file:createFile', root, 'sub/escape')).rejects.toThrow('Invalid name')
      await expect(invoke('file:createFolder', root, '..\\escape')).rejects.toThrow('Invalid name')
      await expect(invoke('file:rename', path.join(root, 'a.md'), '../b.md')).rejects.toThrow('Invalid name')
      await expect(invoke('file:moveItem', path.join(root, 'a.md'), root, 'x/y')).rejects.toThrow(
        'Invalid new name'
      )
      await expect(invoke('file:copyItem', path.join(root, 'a.md'), root, 'x/y')).rejects.toThrow(
        'Invalid new name'
      )
      expect(readdirSync(root).sort()).toEqual(
        process.platform === 'win32' ? ['a.md', 'pic.png', 'sub'] : ['a.md', 'dirlink', 'link.md', 'pic.png', 'sub']
      )
    })

    it('the root cannot be deleted, renamed, moved or written as a file', async () => {
      await expect(invoke('file:deleteFolder', root)).rejects.toThrow('project root')
      await expect(invoke('file:deleteFile', root)).rejects.toThrow('project root')
      await expect(invoke('file:rename', root, 'other')).rejects.toThrow('project root')
      await expect(invoke('file:moveItem', root, path.join(root, 'sub'))).rejects.toThrow('project root')
      await expect(invoke('file:writeFile', root, 'x')).rejects.toThrow('project root')
      expect(existsSync(root)).toBe(true)
    })
  })

  describe('positive contract: inside paths work and answers keep the caller’s spelling', () => {
    it('reads, lists and stats inside the project', async () => {
      await expect(invoke('file:readFile', path.join(root, 'a.md'))).resolves.toBe('inside')
      const tree = await invoke('file:readDirectory', root)
      expect(tree.map((node: { name: string }) => node.name)).toContain('a.md')
      expect(tree[0].path.startsWith(root)).toBe(true)
      await expect(invoke('file:getStats', path.join(root, 'a.md'))).resolves.toMatchObject({ size: 6 })
      await expect(invoke('file:checkConflict', root, 'A.MD')).resolves.toBe(true)
      await expect(invoke('file:checkConflict', path.join(root, 'missing-dir'), 'x')).resolves.toBe(false)
    })

    it('writes, and restores a missing folder chain only on request', async () => {
      const nested = path.join(root, 'docs', 'deep', 'note.md')
      await expect(invoke('file:writeFile', nested, 'x')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(existsSync(path.join(root, 'docs'))).toBe(false)
      await expect(invoke('file:writeFile', nested, 'x', { createParentDirs: false })).rejects.toThrow()
      await expect(invoke('file:writeFile', nested, 'x', { createParentDirs: true })).resolves.toBe(true)
      expect(readFileSync(nested, 'utf8')).toBe('x')
    })

    it.skipIf(process.platform === 'win32')('creates, renames, copies and moves, and answers with paths built from the request', async () => {
      const aliasRoot = path.join(base, 'alias')
      symlinkSync(root, aliasRoot)
      await openTestProject(aliasRoot)
      // The tree the renderer holds is keyed by the alias spelling
      expect(await invoke('file:createFile', aliasRoot, 'fresh')).toBe(path.join(aliasRoot, 'fresh.md'))
      expect(await invoke('file:createFolder', aliasRoot, 'folder2')).toBe(path.join(aliasRoot, 'folder2'))
      expect(existsSync(path.join(root, 'fresh.md'))).toBe(true)
      expect(await invoke('file:rename', path.join(aliasRoot, 'fresh.md'), 'renamed.md')).toBe(
        path.join(aliasRoot, 'renamed.md')
      )
      expect(await invoke('file:copyItem', path.join(aliasRoot, 'a.md'), path.join(aliasRoot, 'sub'))).toEqual({
        path: path.join(aliasRoot, 'sub', 'a.md')
      })
      expect(
        await invoke('file:moveItem', path.join(aliasRoot, 'renamed.md'), path.join(aliasRoot, 'folder2'))
      ).toMatchObject({ path: path.join(aliasRoot, 'folder2', 'renamed.md') })
      expect(existsSync(path.join(root, 'folder2', 'renamed.md'))).toBe(true)
    })

    it.skipIf(process.platform === 'win32')('copying a link inside the project keeps the name the link was given', async () => {
      symlinkSync(path.join(root, 'a.md'), path.join(root, 'alias.md'))
      const copied = await invoke('file:copyItem', path.join(root, 'alias.md'), path.join(root, 'sub'))
      expect(copied.path).toBe(path.join(root, 'sub', 'alias.md'))
      // A file link is copied as the content it resolved to
      expect(lstatSync(path.join(root, 'sub', 'alias.md')).isSymbolicLink()).toBe(false)
      expect(readFileSync(path.join(root, 'sub', 'alias.md'), 'utf8')).toBe('inside')
    })

    it.skipIf(process.platform === 'win32')('a copied folder link stays a link and is reported as one', async () => {
      mkdirSync(path.join(root, 'real-folder'))
      writeFileSync(path.join(root, 'real-folder', 'inner.md'), 'inner')
      symlinkSync(path.join(root, 'real-folder'), path.join(root, 'folder-link'))
      const copied = await invoke('file:copyItem', path.join(root, 'folder-link'), path.join(root, 'sub'))
      expect(copied.path).toBe(path.join(root, 'sub', 'folder-link'))
      expect(copied.isSymlink).toBe(true)
      expect(lstatSync(path.join(root, 'sub', 'folder-link')).isSymbolicLink()).toBe(true)
      expect(existsSync(path.join(root, 'sub', 'folder-link', 'inner.md'))).toBe(true)
    })

    it.skipIf(process.platform === 'win32')(
      'deleting or renaming a link removes or renames the link, never what it leads to',
      async () => {
        await invoke('file:rename', path.join(root, 'link.md'), 'renamed-link.md')
        expect(lstatSync(path.join(root, 'renamed-link.md')).isSymbolicLink()).toBe(true)
        await invoke('file:deleteFile', path.join(root, 'renamed-link.md'))
        expect(existsSync(path.join(root, 'renamed-link.md'))).toBe(false)
        expect(readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret')

        await invoke('file:deleteFolder', path.join(root, 'dirlink'))
        expect(existsSync(path.join(root, 'dirlink'))).toBe(false)
        expect(readdirSync(path.join(outside, 'folder'))).toEqual(['keep.txt'])
      }
    )

    it('a project folder that is gone is named as such', async () => {
      rmSync(root, { recursive: true })
      await expect(invoke('file:writeFile', path.join(root, 'docs', 'a.md'), 'x', { createParentDirs: true })).rejects.toThrow(
        'The project folder no longer exists'
      )
      expect(existsSync(root)).toBe(false)
    })

    it('reveals an inside item at its canonical path and the root itself', async () => {
      await expect(invoke('file:revealInFileManager', path.join(root, 'a.md'))).resolves.toBe('')
      expect(showItemInFolder).toHaveBeenCalledWith(path.join(realpathSync.native(root), 'a.md'))
      await expect(invoke('file:revealInFileManager', root)).resolves.toBe('')
    })

    it('does not mention paths in the refusal log', async () => {
      await invoke('file:readFile', path.join(outside, 'secret.txt')).catch(() => undefined)
      const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls) + JSON.stringify(vi.mocked(logger.error).mock.calls)
      expect(logged).not.toContain(outside)
      expect(logged).not.toContain('secret.txt')
    })

    it('the service is not asked to read when the path was refused', async () => {
      const read = vi.spyOn(fileService, 'readFile')
      await invoke('file:readFile', path.join(outside, 'secret.txt')).catch(() => undefined)
      expect(read).not.toHaveBeenCalled()
    })
  })
})
