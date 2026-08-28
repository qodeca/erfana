// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Handler tests for `file:readImage` (issue #70).
 *
 * Split out of file-handlers.test.ts rather than appended: the mocks below
 * hoist to module scope, and that file is at its size budget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Captures ipcMain.handle registrations so tests can invoke handlers directly
const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('./senderValidation', () => ({
  isTrustedSender: vi.fn(() => true),
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
  shell: { showItemInFolder: vi.fn() }
}))

// electron-store is an ES module dependency of SettingsService
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

describe('file:readImage', () => {
  let tmp: string
  let outside: string
  let inProjectImage: string

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    vi.resetModules()

    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    tmp = mkdtempSync(join(tmpdir(), 'erfana-readimage-'))
    outside = mkdtempSync(join(tmpdir(), 'erfana-readimage-outside-'))
    inProjectImage = join(tmp, 'shot.png')
    writeFileSync(inProjectImage, 'bytes')

    const { fileService } = await import('../services/FileService')
    const { logger } = await import('../services/LoggingService')
    vi.spyOn(fileService, 'getProjectPath').mockReturnValue(tmp)
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

  it('serves an in-project image and forwards the caller version', async () => {
    const { fileService } = await import('../services/FileService')
    const read = vi
      .spyOn(fileService, 'readImage')
      .mockResolvedValue({ status: 'ok', dataUrl: 'data:image/png;base64,AAAA', version: '1:2:3' })

    await expect(handlers['file:readImage']({}, inProjectImage, '0:0:0')).resolves.toEqual({
      status: 'ok',
      dataUrl: 'data:image/png;base64,AAAA',
      version: '1:2:3'
    })
    expect(read).toHaveBeenCalledWith(inProjectImage, '0:0:0')
  })

  it('passes an unchanged verdict through untouched', async () => {
    const { fileService } = await import('../services/FileService')
    vi.spyOn(fileService, 'readImage').mockResolvedValue({ status: 'unchanged', version: '1:2:3' })

    await expect(handlers['file:readImage']({}, inProjectImage, '1:2:3')).resolves.toEqual({
      status: 'unchanged',
      version: '1:2:3'
    })
  })

  it('omits the version when the caller sent none', async () => {
    const { fileService } = await import('../services/FileService')
    const read = vi
      .spyOn(fileService, 'readImage')
      .mockResolvedValue({ status: 'ok', dataUrl: 'data:,', version: '1:2:3' })

    await handlers['file:readImage']({}, inProjectImage)

    expect(read).toHaveBeenCalledWith(inProjectImage, undefined)
  })

  it('rejects a path outside the project without reading it', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const target = join(outside, 'secret.png')
    writeFileSync(target, 'secret')

    const { fileService } = await import('../services/FileService')
    const read = vi.spyOn(fileService, 'readImage')

    await expect(handlers['file:readImage']({}, target)).rejects.toThrow(
      'Cannot read files outside the project directory'
    )
    expect(read).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'rejects an in-project symlink that points outside the project',
    async () => {
      const { writeFileSync, symlinkSync } = await import('node:fs')
      const { join } = await import('node:path')
      const target = join(outside, 'secret.png')
      writeFileSync(target, 'secret')
      const link = join(tmp, 'innocent.png')
      symlinkSync(target, link, 'file')

      const { fileService } = await import('../services/FileService')
      const read = vi.spyOn(fileService, 'readImage')

      await expect(handlers['file:readImage']({}, link)).rejects.toThrow(
        'Cannot read files outside the project directory'
      )
      expect(read).not.toHaveBeenCalled()
    }
  )

  it('rejects when no project is open', async () => {
    const { fileService } = await import('../services/FileService')
    vi.spyOn(fileService, 'getProjectPath').mockReturnValue(null)

    await expect(handlers['file:readImage']({}, inProjectImage)).rejects.toThrow(
      'No project is open'
    )
  })

  it('rejects an oversized version token before confining the path', async () => {
    const { fileService } = await import('../services/FileService')
    const read = vi.spyOn(fileService, 'readImage')

    await expect(
      handlers['file:readImage']({}, inProjectImage, 'x'.repeat(129))
    ).rejects.toThrow('Too big: expected string to have <=128 characters')
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects an empty path', async () => {
    const { fileService } = await import('../services/FileService')
    const read = vi.spyOn(fileService, 'readImage')

    await expect(handlers['file:readImage']({}, '')).rejects.toThrow('Path is required')
    expect(read).not.toHaveBeenCalled()
  })
})
