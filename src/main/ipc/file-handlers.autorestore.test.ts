import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture ipc handlers
const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, cb: (...args: any[]) => any) => {
      handlers[channel] = cb
    })
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

// Mock fs/promises.stat
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises')
  return {
    ...actual,
    stat: vi.fn(async () => ({ isDirectory: () => true }))
  }
})

// Mock services that file-handlers imports
const setFileWatcherProjectPath = vi.fn()
const setDirWatcherProjectPath = vi.fn()
const setFileServiceProjectPath = vi.fn()
vi.mock('../services/FileWatcherService', () => ({ fileWatcherService: { setProjectPath: setFileWatcherProjectPath } }))
vi.mock('../services/DirectoryWatcherService', () => ({ directoryWatcherService: { setProjectPath: setDirWatcherProjectPath } }))
vi.mock('../services/FileService', () => ({ fileService: { setProjectPath: setFileServiceProjectPath } }))

const getLastProjectPath = vi.fn(async () => '/fake/project')
vi.mock('../services/SettingsService', () => ({ settingsService: { getLastProjectPath } }))

describe('file:getLastProjectPath sets watcher projectPath', () => {
  beforeEach(async () => {
    // Fresh import and register handlers with mocks
    handlers['file:getLastProjectPath'] = undefined as any
    const mod = await import('./file-handlers')
    mod.registerFileHandlers()
  })

  it('sets FileService and both watchers projectPath on auto-restore', async () => {
    expect(typeof handlers['file:getLastProjectPath']).toBe('function')
    const result = await handlers['file:getLastProjectPath']()
    expect(result).toBe('/fake/project')
    expect(setFileServiceProjectPath).toHaveBeenCalledWith('/fake/project')
    expect(setFileWatcherProjectPath).toHaveBeenCalledWith('/fake/project')
    expect(setDirWatcherProjectPath).toHaveBeenCalledWith('/fake/project')
  })
})
