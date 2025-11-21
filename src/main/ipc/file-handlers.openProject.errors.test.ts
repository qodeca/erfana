import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture handlers
const handlers: Record<string, (...args: any[]) => any> = {}
// Capture broadcasts
const sends: Array<{ ch: string; payload: any }> = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch: string, cb: any) => { handlers[ch] = cb })
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/bad/path'] }))
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: (ch: string, payload: any) => sends.push({ ch, payload }) } }])
  }
}))

// Mock fs/promises.stat to throw (simulate inaccessible dir)
// Mock lstat to succeed so validatePath passes, but stat fails for project validation
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises')
  return {
    ...actual,
    stat: vi.fn(async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) }),
    lstat: vi.fn(async () => ({ isSymbolicLink: () => false })) // Not a symlink, so validatePath passes
  }
})

// Mock services used by file-handlers
const stopAllFiles = vi.fn(async () => {})
const stopAllDirs = vi.fn(async () => {})
const setFileSvcPath = vi.fn()
const setFileWatchPath = vi.fn()
const setDirWatchPath = vi.fn()
vi.mock('../services/FileWatcherService', () => ({ fileWatcherService: { stopAll: stopAllFiles, setProjectPath: setFileWatchPath } }))
vi.mock('../services/DirectoryWatcherService', () => ({ directoryWatcherService: { stopAll: stopAllDirs, setProjectPath: setDirWatchPath } }))
vi.mock('../services/FileService', () => ({ fileService: { getProjectPath: () => '/old/path', setProjectPath: setFileSvcPath } }))
vi.mock('../services/SettingsService', () => ({ settingsService: { setLastProjectPath: vi.fn(async () => {}) } }))

describe('file:openProject error hardening', () => {
  beforeEach(async () => {
    sends.length = 0
    Object.keys(handlers).forEach((k) => delete handlers[k])
    const mod = await import('./file-handlers')
    mod.registerFileHandlers()
  })

  it('throws and does not broadcast on inaccessible directory', async () => {
    expect(typeof handlers['file:openProject']).toBe('function')
    await expect(handlers['file:openProject']()).rejects.toBeInstanceOf(Error)
    // No project:changed broadcast
    expect(sends.find((s) => s.ch === 'project:changed')).toBeUndefined()
    // Attempted rollback to old path on services
    expect(setFileSvcPath).toHaveBeenCalledWith('/old/path')
    expect(setFileWatchPath).toHaveBeenCalledWith('/old/path')
    expect(setDirWatchPath).toHaveBeenCalledWith('/old/path')
  })
})

