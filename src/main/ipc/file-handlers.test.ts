// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import nodePath from 'node:path'
import { openTestProject } from './__test-helpers__/openTestProject'

/** `rel` below `root`, with the host's separators. */
const J = (root: string, rel: string): string => nodePath.join(root, ...rel.split('/'))

// Mocks for electron BrowserWindow
const sends: Array<{ idx: number; channel: string; payload: unknown }> = []
// Captures ipcMain.handle registrations so tests can invoke handlers directly
const handlers: Record<string, (...args: any[]) => any> = {}
// Captures shell.showItemInFolder calls for the reveal handler
const showItemInFolder = vi.fn()
// Toggleable sender-trust gate for the reveal handler
const isTrustedSenderMock = vi.fn(() => true)

vi.mock('./senderValidation', () => ({
  isTrustedSender: isTrustedSenderMock,
    isTrustedAppSender: () => true
}))

vi.mock('electron', () => {
  const mkWin = (idx: number, destroyed = false) => ({
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sends.push({ idx, channel, payload })
      }
    }
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(0), mkWin(1), mkWin(2, true)])
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => any) => {
        handlers[channel] = fn
      }
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    shell: {
      showItemInFolder
    }
  }
})

// Mock electron-store used by SettingsService to avoid projectName error
vi.mock('electron-store', () => {
  class MockStore {
    constructor(_opts?: any) {}
    get(_key: string, _def?: any): any { return null }
    set(_key: string, _val: any): void {}
    delete(_key: string): void {}
  }
  return { default: MockStore }
})

// Mock ProjectLockService to avoid app.getPath dependency
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

/** A temp folder, opened as the project; `cleanup` removes it. */
async function makeProject(prefix: string, subdirs: string[] = []) {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const root = mkdtempSync(join(tmpdir(), prefix))
  for (const dir of subdirs) mkdirSync(join(root, dir), { recursive: true })
  await openTestProject(root)
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('file:getStats logging', () => {
  beforeEach(() => {
    // Clear the module-scope handler map so registrations can't leak across tests.
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs ENOENT at debug, not error', async () => {
    const { registerFileHandlers } = await import('./file-handlers')
    const { fileService } = await import('../services/FileService')
    const { logger } = await import('../services/LoggingService')

    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(fileService, 'getFileStats').mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory, stat '/x/missing.md'"), { code: 'ENOENT' })
    )

    registerFileHandlers()
    await expect(handlers['file:getStats']({}, nodePath.resolve('/x/missing.md'))).rejects.toThrow('ENOENT')

    expect(debugSpy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('file:createFile / createFolder / rename log redaction', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Test guard (#167 D5): prevents a future call site from silently logging the
  // raw user-typed filename. Each handler must (a) log a redacted copy and
  // (b) re-throw the ORIGINAL error so the renderer toast keeps the full name.
  const cases = [
    {
      title: 'file:createFile',
      channel: 'file:createFile',
      method: 'createFile' as const,
      invoke: (h: (...args: any[]) => any, root: string) => h({}, root, 'secret-budget-q4.md'),
    },
    {
      title: 'file:createFolder',
      channel: 'file:createFolder',
      method: 'createFolder' as const,
      invoke: (h: (...args: any[]) => any, root: string) => h({}, root, 'secret-budget-q4'),
    },
    {
      title: 'file:rename',
      channel: 'file:rename',
      method: 'rename' as const,
      invoke: (h: (...args: any[]) => any, root: string) =>
        h({}, `${root}/old.md`, 'secret-budget-q4.md'),
    },
  ]

  for (const { title, channel, method, invoke } of cases) {
    it(`${title} redacts the filename in logs but re-throws the original error`, async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { logger } = await import('../services/LoggingService')
      const { AppError, ErrorCode, INVALID_FILENAME_MARKER } = await import('../../shared/errors')

      const project = await makeProject('erfana-redact-')
      const rawFilename = 'secret-budget-q4.md'
      const original = new AppError(
        `"${rawFilename}" ${INVALID_FILENAME_MARKER} — remove trailing dot(s)`,
        ErrorCode.INVALID_FILENAME,
      )

      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.spyOn(fileService, method).mockRejectedValue(original)

      registerFileHandlers()

      // (b) Handler re-throws the ORIGINAL unredacted error (full filename intact).
      await expect(invoke(handlers[channel], project.root)).rejects.toBe(original)
      expect(original.message).toContain(rawFilename)

      // (a) logger.error received a redacted message, not the raw filename.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const loggedError = errorSpy.mock.calls[0][1] as Error | undefined
      expect(loggedError).toBeInstanceOf(Error)
      expect(loggedError?.message).toContain('[redacted-filename]')
      expect(loggedError?.message).not.toContain(rawFilename)
      // Stack must not re-leak the filename either.
      expect(loggedError?.stack ?? '').not.toContain(rawFilename)
      project.cleanup()
    })
  }
})

describe('file:writeFile (save after a folder rename)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes at the checked path, and recreates folders only for a literal true', async () => {
    const project = await makeProject('erfana-write-', ['docs'])
    const { join } = await import('node:path')
    const { realpath } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const { registerFileHandlers } = await import('./file-handlers')
    const { fileService } = await import('../services/FileService')
    const write = vi.spyOn(fileService, 'writeFile').mockResolvedValue()
    registerFileHandlers()

    const inDocs = join(project.root, 'docs', 'a.md')
    await handlers['file:writeFile']({}, inDocs, 'x')
    await expect(
      handlers['file:writeFile']({}, inDocs, 'x', { createParentDirs: 'yes' })
    ).rejects.toThrow()
    const gone = join(project.root, 'gone', 'deep', 'a.md')
    await handlers['file:writeFile']({}, gone, 'x')
    expect(existsSync(join(project.root, 'gone'))).toBe(false)
    await handlers['file:writeFile']({}, gone, 'x', { createParentDirs: true })
    expect(existsSync(join(project.root, 'gone', 'deep'))).toBe(true)

    const realRoot = await realpath(project.root)
    expect(write.mock.calls).toEqual([
      [join(realRoot, 'docs', 'a.md'), 'x'],
      [join(realRoot, 'gone', 'deep', 'a.md'), 'x'],
      [join(realRoot, 'gone', 'deep', 'a.md'), 'x']
    ])
    project.cleanup()
  })

  it('logs the failure without the path but re-throws the original error', async () => {
    const project = await makeProject('erfana-write-', ['docs'])
    const { join } = await import('node:path')
    const { registerFileHandlers } = await import('./file-handlers')
    const { fileService } = await import('../services/FileService')
    const { logger } = await import('../services/LoggingService')
    const original = Object.assign(
      new Error("ENOENT: no such file or directory, open '/Users/alice/proj/docs/secret.md'"),
      { code: 'ENOENT', errno: -2, syscall: 'open' }
    )
    vi.spyOn(fileService, 'writeFile').mockRejectedValue(original)
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    registerFileHandlers()
    await expect(
      handlers['file:writeFile']({}, join(project.root, 'docs', 'secret.md'), 'x')
    ).rejects.toBe(original)

    const logged = errorSpy.mock.calls[0][1] as Error
    expect(logged.message).toContain('[redacted-path]')
    expect(logged.message).not.toContain('secret.md')
    project.cleanup()
  })
})

describe('file:exists', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true for an existing path and false for a missing one, without throwing', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'file-exists-'))
    const present = join(dir, 'here.md')
    writeFileSync(present, 'x')

    const { registerFileHandlers } = await import('./file-handlers')
    registerFileHandlers()

    await expect(handlers['file:exists']({}, present)).resolves.toBe(true)
    await expect(handlers['file:exists']({}, join(dir, 'nope.md'))).resolves.toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('file:revealInFileManager', () => {
  let tmp: string
  let reveal: (...args: any[]) => any

  beforeEach(async () => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    showItemInFolder.mockClear()
    isTrustedSenderMock.mockReturnValue(true)

    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    tmp = mkdtempSync(join(tmpdir(), 'erfana-reveal-'))

    await openTestProject(tmp)

    const { registerFileHandlers } = await import('./file-handlers')
    registerFileHandlers()
    reveal = handlers['file:revealInFileManager']
  })

  afterEach(async () => {
    const { rmSync } = await import('node:fs')
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('reveals a file inside the project and returns empty string', async () => {
    const { writeFileSync } = await import('node:fs')
    const { realpath } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const file = join(tmp, 'note.md')
    writeFileSync(file, '# hi')

    expect(await reveal({}, file)).toBe('')
    expect(showItemInFolder).toHaveBeenCalledWith(await realpath(file))
  })

  it('reveals the project root directory itself', async () => {
    const { realpath } = await import('node:fs/promises')
    expect(await reveal({}, tmp)).toBe('')
    expect(showItemInFolder).toHaveBeenCalledWith(await realpath(tmp))
  })

  it('rejects a path outside the project', async () => {
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const outside = join(tmpdir(), 'definitely-outside-erfana-project')

    expect(await reveal({}, outside)).toBe('Cannot reveal items outside the project')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('rejects a sibling whose name extends the project root (prefix boundary)', async () => {
    // Shares the root string prefix but is not inside it; lexical guard must reject.
    const sibling = tmp + '-evil'
    expect(await reveal({}, sibling)).toBe('Cannot reveal items outside the project')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'rejects an in-project symlink that points outside the project',
    async () => {
      const { mkdtempSync, symlinkSync, rmSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const outsideTarget = mkdtempSync(join(tmpdir(), 'erfana-outside-'))
      const link = join(tmp, 'link')
      symlinkSync(outsideTarget, link, 'dir')

      expect(await reveal({}, link)).toBe('Cannot reveal items outside the project')
      expect(showItemInFolder).not.toHaveBeenCalled()

      rmSync(outsideTarget, { recursive: true, force: true })
    }
  )

  it('returns an error when no project is open', async () => {
    const { join } = await import('node:path')
    await openTestProject(null)

    expect(await reveal({}, join(tmp, 'note.md'))).toBe('No project is open')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('returns an error for a missing in-project path without calling shell', async () => {
    const { join } = await import('node:path')
    const missing = join(tmp, 'gone.md')

    expect(await reveal({}, missing)).toBe('Item no longer exists on disk')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'treats a path through a file as an item that is not there',
    async () => {
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      // A regular file used as a path component → realpath throws ENOTDIR.
      const file = join(tmp, 'note.md')
      writeFileSync(file, '# hi')
      const throughFile = join(file, 'child')

      expect(await reveal({}, throughFile)).toBe('Item no longer exists on disk')
      expect(showItemInFolder).not.toHaveBeenCalled()
    }
  )

  it('returns an error for invalid input', async () => {
    expect(await reveal({}, '')).toBe('Invalid path')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('no-ops for an untrusted sender', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    isTrustedSenderMock.mockReturnValue(false)
    const file = join(tmp, 'note.md')
    writeFileSync(file, '# hi')

    expect(await reveal({}, file)).toBe('')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('project confinement for read handlers (issue #70)', () => {
  let tmp: string
  let outside: string

  beforeEach(async () => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()

    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    tmp = mkdtempSync(join(tmpdir(), 'erfana-confine-'))
    outside = mkdtempSync(join(tmpdir(), 'erfana-outside-'))

    const { logger } = await import('../services/LoggingService')
    await openTestProject(tmp)
    // Refusals are logged at error by design; keep the suite output readable.
    vi.spyOn(logger, 'error').mockImplementation(() => {})

    const { registerFileHandlers } = await import('./file-handlers')
    registerFileHandlers()
  })

  afterEach(async () => {
    const { rmSync } = await import('node:fs')
    rmSync(tmp, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.resetModules()
  })

  /** An in-project name whose content lives outside the project. */
  const plantEscapingSymlink = async (name: string): Promise<string> => {
    const { writeFileSync, symlinkSync } = await import('node:fs')
    const { join } = await import('node:path')
    const target = join(outside, 'secret.txt')
    writeFileSync(target, 'secret')
    const link = join(tmp, name)
    symlinkSync(target, link, 'file')
    return link
  }

  describe('file:readFile', () => {
    it('reads a file inside the project', async () => {
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const file = join(tmp, 'note.md')
      writeFileSync(file, '# hi')

      const { fileService } = await import('../services/FileService')
      const read = vi.spyOn(fileService, 'readFile').mockResolvedValue('# hi')

      await expect(handlers['file:readFile']({}, file)).resolves.toBe('# hi')
      // Read at the canonical path the check resolved
      const { realpath } = await import('node:fs/promises')
      expect(read).toHaveBeenCalledWith(await realpath(file))
    })

    it('rejects a path outside the project without reading it', async () => {
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const target = join(outside, 'secret.txt')
      writeFileSync(target, 'secret')

      const { fileService } = await import('../services/FileService')
      const read = vi.spyOn(fileService, 'readFile').mockResolvedValue('secret')

      await expect(handlers['file:readFile']({}, target)).rejects.toThrow(
        'Cannot read files outside the project directory'
      )
      expect(read).not.toHaveBeenCalled()
    })

    it.skipIf(process.platform === 'win32')(
      'rejects an in-project symlink that points outside the project',
      async () => {
        const link = await plantEscapingSymlink('innocent.md')

        const { fileService } = await import('../services/FileService')
        const read = vi.spyOn(fileService, 'readFile').mockResolvedValue('secret')

        await expect(handlers['file:readFile']({}, link)).rejects.toThrow(
          'Cannot read files outside the project directory'
        )
        expect(read).not.toHaveBeenCalled()
      }
    )

    it("lets a missing in-project file fail with the reader's own error", async () => {
      const { join } = await import('node:path')
      const { fileService } = await import('../services/FileService')
      vi.spyOn(fileService, 'readFile').mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      )

      await expect(handlers['file:readFile']({}, join(tmp, 'gone.md'))).rejects.toThrow('ENOENT')
    })
  })

  // The image read channel's own confinement (out-of-project path, in-project
  // symlink pointing out, closed project) is covered against `file:readImage`
  // in file-handlers.readImage.test.ts; the deprecated `file:readAsBase64` it
  // replaced no longer exists (#70).

  describe('file:getStats', () => {
    it('still serves a path the user picked outside the project', async () => {
      // Spec #012: the import shortcut stats native-dialog selections, which
      // are out-of-project by definition. Confining this handler would disable
      // its large-file warnings.
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const picked = join(outside, 'picked.pdf')
      writeFileSync(picked, 'x')

      await expect(handlers['file:getStats']({}, picked)).resolves.toMatchObject({ size: 1 })
    })

    it.skipIf(process.platform === 'win32')(
      'rejects an in-project symlink that points outside the project',
      async () => {
        const link = await plantEscapingSymlink('innocent.svg')

        await expect(handlers['file:getStats']({}, link)).rejects.toThrow(
          'Cannot read files outside the project directory'
        )
      }
    )
  })
})

describe('#210 watcher catch-up hooks', () => {
  const event = { sender: { id: 7 } }
  let project: Awaited<ReturnType<typeof makeProject>>
  /** The project root, in the form the renderer would send it */
  let root: string

  beforeEach(async () => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.resetModules()

    const { logger } = await import('../services/LoggingService')
    // Failure cases log at error by design; keep the suite output readable.
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    project = await makeProject('erfana-watch-hooks-', ['sub', 'dir'])
    root = project.root
  })
  afterEach(() => {
    project.cleanup()
    vi.restoreAllMocks()
  })

  describe('file:readDirectory', () => {
    it('begins the tree read before reading and commits it after success', async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')

      const commitRead = vi.fn()
      const begin = vi.spyOn(directoryWatcherService, 'beginTreeRead').mockReturnValue(commitRead)
      const read = vi.spyOn(fileService, 'readDirectory').mockResolvedValue([])

      registerFileHandlers()
      await expect(handlers['file:readDirectory'](event, root)).resolves.toEqual([])

      expect(begin).toHaveBeenCalledWith(root, 7)
      expect(begin.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0])
      expect(commitRead).toHaveBeenCalledTimes(1)
      expect(commitRead.mock.invocationCallOrder[0]).toBeGreaterThan(read.mock.invocationCallOrder[0])
    })

    it('does not commit a read that fails, and re-throws its error', async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')

      const commitRead = vi.fn()
      vi.spyOn(directoryWatcherService, 'beginTreeRead').mockReturnValue(commitRead)
      const failure = new Error('EACCES')
      vi.spyOn(fileService, 'readDirectory').mockRejectedValue(failure)

      registerFileHandlers()
      await expect(handlers['file:readDirectory'](event, root)).rejects.toBe(failure)

      expect(commitRead).not.toHaveBeenCalled()
    })

    it('logs the folder name, never the full path, on success', async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')
      const { logger } = await import('../services/LoggingService')
      const { basename, dirname } = await import('node:path')
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      vi.spyOn(directoryWatcherService, 'beginTreeRead').mockReturnValue(vi.fn())
      vi.spyOn(fileService, 'readDirectory').mockResolvedValue([])

      registerFileHandlers()
      await handlers['file:readDirectory'](event, root)

      const logged = JSON.stringify(infoSpy.mock.calls)
      expect(logged).not.toContain(JSON.stringify(dirname(root)).slice(1, -1))
      expect(logged).toContain(basename(root))
    })

    it('logs a failed read without the path inside the errno message', async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')
      const { logger } = await import('../services/LoggingService')
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

      vi.spyOn(directoryWatcherService, 'beginTreeRead').mockReturnValue(vi.fn())
      const failure = Object.assign(
        new Error("EACCES: permission denied, scandir '/Users/alice/secret-project'"),
        { code: 'EACCES', syscall: 'scandir' }
      )
      vi.spyOn(fileService, 'readDirectory').mockRejectedValue(failure)

      registerFileHandlers()
      await expect(handlers['file:readDirectory'](event, root)).rejects.toBe(failure)

      const loggedError = errorSpy.mock.calls[0][1] as Error
      expect(loggedError.message).not.toContain('/Users/alice')
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('/Users/alice')
    })
  })

  // Paths are given as functions of the root; `resolved` is what the mocked
  // service answers with, `recorded` what the handler tells the watcher.
  const mutationCases = [
    {
      channel: 'file:createFile',
      method: 'createFile' as const,
      args: (r: string) => [r, 'a.md'],
      resolved: (r: string) => J(r, 'a.md'),
      recorded: (r: string) => [[{ path: J(r, 'a.md'), kind: 'added', subtree: false }]]
    },
    {
      channel: 'file:createFolder',
      method: 'createFolder' as const,
      args: (r: string) => [r, 'dir2'],
      resolved: (r: string) => J(r, 'dir2'),
      recorded: (r: string) => [[{ path: J(r, 'dir2'), kind: 'added', subtree: false }]]
    },
    {
      channel: 'file:deleteFile',
      method: 'deleteFile' as const,
      args: (r: string) => [J(r, 'a.md')],
      resolved: () => undefined,
      recorded: (r: string) => [[{ path: J(r, 'a.md'), kind: 'removed', subtree: true }]]
    },
    {
      channel: 'file:deleteFolder',
      method: 'deleteFolder' as const,
      args: (r: string) => [J(r, 'dir')],
      resolved: () => undefined,
      recorded: (r: string) => [[{ path: J(r, 'dir'), kind: 'removed', subtree: true }]]
    },
    {
      channel: 'file:rename',
      method: 'rename' as const,
      args: (r: string) => [J(r, 'old'), 'new'],
      resolved: (r: string) => J(r, 'new'),
      recorded: (r: string) => [
        [
          { path: J(r, 'old'), kind: 'removed', subtree: true },
          { path: J(r, 'new'), kind: 'added', subtree: true }
        ]
      ]
    },
    {
      channel: 'file:moveItem',
      method: 'moveItem' as const,
      args: (r: string) => [J(r, 'a'), J(r, 'sub')],
      resolved: (r: string) => ({ path: J(r, 'sub/a') }),
      recorded: (r: string) => [
        [
          { path: J(r, 'a'), kind: 'removed', subtree: true },
          { path: J(r, 'sub/a'), kind: 'added', subtree: true }
        ]
      ]
    },
    {
      channel: 'file:moveItem',
      label: ' (replaceExisting)',
      method: 'moveItem' as const,
      args: (r: string) => [J(r, 'a'), J(r, 'sub'), undefined, true],
      resolved: (r: string) => ({ path: J(r, 'sub/a') }),
      recorded: (r: string) => [
        [
          { path: J(r, 'a'), kind: 'removed', subtree: true },
          { path: J(r, 'sub/a'), kind: 'added', subtree: true },
          { path: J(r, 'sub/a'), kind: 'removed', subtree: true }
        ]
      ]
    },
    {
      channel: 'file:copyItem',
      method: 'copyItem' as const,
      args: (r: string) => [J(r, 'a'), J(r, 'sub')],
      resolved: (r: string) => ({ path: J(r, 'sub/a') }),
      recorded: (r: string) => [[{ path: J(r, 'sub/a'), kind: 'added', subtree: true }]]
    }
  ]

  for (const { channel, label = '', method, args, resolved, recorded } of mutationCases) {
    it(`${channel}${label} records its own changes after success`, async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')

      const note = vi.spyOn(directoryWatcherService, 'noteInternalChange')
      vi.spyOn(fileService, method).mockResolvedValue(resolved(root) as never)

      registerFileHandlers()
      await handlers[channel](event, ...args(root))

      expect(note.mock.calls).toEqual(recorded(root))
    })

    it(`${channel}${label} records nothing when the operation fails`, async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { directoryWatcherService } = await import('../services/DirectoryWatcherService')

      const note = vi.spyOn(directoryWatcherService, 'noteInternalChange')
      const failure = new Error('partial failure')
      vi.spyOn(fileService, method).mockRejectedValue(failure)

      registerFileHandlers()
      await expect(handlers[channel](event, ...args(root))).rejects.toBe(failure)

      expect(note).not.toHaveBeenCalled()
    })
  }
})
