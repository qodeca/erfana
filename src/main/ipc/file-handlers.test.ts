import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks for electron BrowserWindow
const sends: Array<{ idx: number; channel: string; payload: unknown }> = []
// Captures ipcMain.handle registrations so tests can invoke handlers directly
const handlers: Record<string, (...args: any[]) => any> = {}

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
