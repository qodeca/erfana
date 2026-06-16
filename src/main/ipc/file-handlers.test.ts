// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks for electron BrowserWindow
const sends: Array<{ idx: number; channel: string; payload: unknown }> = []
// Captures ipcMain.handle registrations so tests can invoke handlers directly
const handlers: Record<string, (...args: any[]) => any> = {}
// Captures shell.showItemInFolder calls for the reveal handler
const showItemInFolder = vi.fn()
// Toggleable sender-trust gate for the reveal handler
const isTrustedSenderMock = vi.fn(() => true)

vi.mock('./senderValidation', () => ({
  isTrustedSender: isTrustedSenderMock
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

describe('broadcastProjectChanged', () => {
  beforeEach(() => {
    sends.length = 0
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('sends project:changed to all non-destroyed windows', async () => {
    const { broadcastProjectChanged } = await import('./file-handlers')

    const payload = { oldPath: '/old', newPath: '/new' }
    broadcastProjectChanged(payload)

    // Should send to window 0 and 1, skip 2 (destroyed)
    expect(sends).toHaveLength(2)
    expect(sends[0]).toMatchObject({ idx: 0, channel: 'project:changed', payload })
    expect(sends[1]).toMatchObject({ idx: 1, channel: 'project:changed', payload })
  })
})

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
    await expect(handlers['file:getStats']({}, '/x/missing.md')).rejects.toThrow('ENOENT')

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
      invoke: (h: (...args: any[]) => any) => h({}, '/proj', 'secret-budget-q4.md'),
    },
    {
      title: 'file:createFolder',
      channel: 'file:createFolder',
      method: 'createFolder' as const,
      invoke: (h: (...args: any[]) => any) => h({}, '/proj', 'secret-budget-q4'),
    },
    {
      title: 'file:rename',
      channel: 'file:rename',
      method: 'rename' as const,
      invoke: (h: (...args: any[]) => any) => h({}, '/proj/old.md', 'secret-budget-q4.md'),
    },
  ]

  for (const { title, channel, method, invoke } of cases) {
    it(`${title} redacts the filename in logs but re-throws the original error`, async () => {
      const { registerFileHandlers } = await import('./file-handlers')
      const { fileService } = await import('../services/FileService')
      const { logger } = await import('../services/LoggingService')
      const { AppError, ErrorCode, INVALID_FILENAME_MARKER } = await import('../../shared/errors')

      const rawFilename = 'secret-budget-q4.md'
      const original = new AppError(
        `"${rawFilename}" ${INVALID_FILENAME_MARKER} — remove trailing dot(s)`,
        ErrorCode.INVALID_FILENAME,
      )

      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.spyOn(fileService, method).mockRejectedValue(original)

      registerFileHandlers()

      // (b) Handler re-throws the ORIGINAL unredacted error (full filename intact).
      await expect(invoke(handlers[channel])).rejects.toBe(original)
      expect(original.message).toContain(rawFilename)

      // (a) logger.error received a redacted message, not the raw filename.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const loggedError = errorSpy.mock.calls[0][1] as Error | undefined
      expect(loggedError).toBeInstanceOf(Error)
      expect(loggedError?.message).toContain('[redacted-filename]')
      expect(loggedError?.message).not.toContain(rawFilename)
      // Stack must not re-leak the filename either.
      expect(loggedError?.stack ?? '').not.toContain(rawFilename)
    })
  }
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

    const { fileService } = await import('../services/FileService')
    vi.spyOn(fileService, 'getProjectPath').mockReturnValue(tmp)

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
    const { fileService } = await import('../services/FileService')
    const { join } = await import('node:path')
    vi.spyOn(fileService, 'getProjectPath').mockReturnValue(null)

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
    'returns a distinct message for a non-ENOENT realpath error',
    async () => {
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      // A regular file used as a path component → realpath throws ENOTDIR.
      const file = join(tmp, 'note.md')
      writeFileSync(file, '# hi')
      const throughFile = join(file, 'child')

      expect(await reveal({}, throughFile)).toBe('Cannot reveal this item')
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
