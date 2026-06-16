// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-handlers.openProject.errors.test.ts
 *
 * Tests for openProject error hardening at the IPC handler layer.
 *
 * IMPORTANT: This test file validates the THIN ADAPTER pattern.
 * - It mocks fs/promises and services to test the error handling WIRING
 * - It does NOT test actual FileService behavior (that's in FileService.test.ts)
 * - The value is verifying: error propagation, rollback invocation, broadcast prevention
 *
 * Why this approach is valid:
 * - IPC handlers are adapters connecting main process services to renderer
 * - Testing the adapter layer with mocks verifies the CONTRACT between layers
 * - Integration tests would duplicate FileService tests without additional value
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture handlers
const handlers: Record<string, (...args: any[]) => any> = {}
// Capture broadcasts
const sends: Array<{ ch: string; payload: any }> = []

vi.mock('./senderValidation', () => ({ isTrustedSender: () => true }))

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

// Mock fs/promises: access and lstat succeed (validatePath passes), but stat fails
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises')
  return {
    ...actual,
    stat: vi.fn(async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) }),
    lstat: vi.fn(async () => ({ isSymbolicLink: () => false })), // Not a symlink
    access: vi.fn(async () => {}) // Path is accessible (validatePath passes)
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

