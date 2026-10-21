// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalFileService log redaction
 *
 * A dropped file's full path (user name, folder layout) must not reach the log
 * file; only the file or folder name may. Split from ExternalFileService.test.ts
 * because it needs the logger mocked at module scope.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { ExternalFileService } from './ExternalFileService'
import { ExternalSourceGrants } from './ExternalSourceGrants'
import type { IFileService } from '../interfaces/IFileService'

const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('./LoggingService', () => ({ logger: mockLogger }))

vi.mock('fs/promises', () => ({
  lstat: vi.fn(),
  realpath: vi.fn(),
  copyFile: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
  constants: { R_OK: 4, COPYFILE_EXCL: 1 }
}))

vi.mock('../utils/pathSecurity', () => ({
  validateSymlink: vi.fn(),
  isSystemDirectory: vi.fn(() => false)
}))

const SECRET_DIR = '/Users/alice/private'
const SOURCE = `${SECRET_DIR}/notes.md`
const PROJECT = '/Users/alice/work/project'

function everythingLogged(): string {
  return JSON.stringify(Object.values(mockLogger).flatMap((fn) => fn.mock.calls))
}

function makeFileService(): IFileService {
  return {
    setProjectPath: vi.fn(),
    getProjectPath: vi.fn(),
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    getFileStats: vi.fn(),
    isMarkdownFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    deleteFile: vi.fn(),
    deleteFolder: vi.fn(),
    rename: vi.fn(),
    moveItem: vi.fn(),
    copyItem: vi.fn(),
    checkNameConflict: vi.fn(),
    setHiddenPatterns: vi.fn(),
    getHiddenPatterns: vi.fn()
  }
}

describe('ExternalFileService log redaction', () => {
  let fs: any
  let service: ExternalFileService

  beforeEach(async () => {
    fs = await import('fs/promises')
    vi.clearAllMocks()
    ;(fs.access as Mock).mockResolvedValue(undefined)
    service = new ExternalFileService(makeFileService())
  })

  it('logs only the file name when a source file is not found', async () => {
    ;(fs.lstat as Mock).mockRejectedValue(
      Object.assign(new Error(`ENOENT: no such file or directory, lstat '${SOURCE}'`), {
        code: 'ENOENT',
        syscall: 'lstat'
      })
    )

    const result = await service.validateExternalFile(SOURCE)

    expect(result.valid).toBe(false)
    const logged = everythingLogged()
    expect(logged).not.toContain('/Users/alice')
    expect(logged).toContain('notes.md')
  })

  it('logs no full paths when a copy fails', async () => {
    ;(fs.lstat as Mock).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false
    })
    ;(fs.copyFile as Mock).mockRejectedValue(
      Object.assign(new Error(`EACCES: permission denied, copyfile '${SOURCE}' -> '${PROJECT}/notes.md'`), {
        code: 'EACCES',
        syscall: 'copyfile'
      })
    )

    const result = await service.copyFromExternal(SOURCE, { real: PROJECT, requested: PROJECT })

    expect(result.success).toBe(false)
    expect(mockLogger.error).toHaveBeenCalled()
    expect(everythingLogged()).not.toContain('/Users/alice')
  })

  it('logs no full paths when a move is refused for lack of a pick', async () => {
    ;(fs.lstat as Mock).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false
    })
    const unpicked = new ExternalFileService(makeFileService(), new ExternalSourceGrants())

    const result = await unpicked.moveFromExternal(SOURCE, { real: PROJECT, requested: PROJECT }, 1)

    expect(result.success).toBe(false)
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(everythingLogged()).not.toContain('/Users/alice')
  })
})
