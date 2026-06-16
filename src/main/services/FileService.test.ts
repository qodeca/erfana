// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type * as FsProm from 'fs/promises'
import { FileService } from './FileService'

vi.mock('fs/promises', () => {
  return {
    stat: vi.fn(),
    rm: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    readdir: vi.fn(),
  } satisfies Partial<FsProm>
})

function makeStats(opts: { isDir: boolean }) {
  return {
    isDirectory: () => opts.isDir,
    isFile: () => !opts.isDir,
  } as unknown as Awaited<ReturnType<(typeof import('fs/promises'))['stat']>>
}

describe('FileService', () => {
  let fs: any
  let svc: FileService

  beforeEach(async () => {
    fs = (await import('fs/promises')) as any
    // Reset all mocks
    vi.resetAllMocks()
    svc = new FileService()
  })

  describe('deleteFile', () => {
    it('throws when target is a directory', async () => {
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFile('/proj/dir'))
        .rejects.toThrow('Cannot delete a directory using deleteFile')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('throws when file is outside project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      await expect(svc.deleteFile('/other/file.md'))
        .rejects.toThrow('outside the project directory')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('deletes file within project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(fs.rm as unknown as Mock).mockResolvedValueOnce(undefined)
      await expect(svc.deleteFile('/proj/docs/readme.md')).resolves.toBeUndefined()
      expect(fs.rm).toHaveBeenCalledWith('/proj/docs/readme.md')
    })
  })

  describe('deleteFolder', () => {
    it('throws when not a directory', async () => {
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      await expect(svc.deleteFolder('/proj/file.md')).rejects.toThrow('Path is not a directory')
    })

    it('prevents deleting project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFolder('/proj')).rejects.toThrow('Cannot delete the project root')
    })

    it('prevents deleting outside project', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFolder('/other/folder')).rejects.toThrow('outside the project directory')
    })

    it('deletes folder recursively within project', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      ;(fs.rm as unknown as Mock).mockResolvedValueOnce(undefined)
      await expect(svc.deleteFolder('/proj/tmp/cache')).resolves.toBeUndefined()
      expect(fs.rm).toHaveBeenCalledWith('/proj/tmp/cache', { recursive: true, force: true })
    })
  })

  // ---------------------------------------------------------------------------
  // #161 + post-review H1 — input validation on create/rename
  // ---------------------------------------------------------------------------
  describe('createFile path-traversal protection (post security review)', () => {
    it('strips path separators from fileName before join (prevents ../../etc/passwd traversal)', async () => {
      // stat must reject (file doesn't exist yet)
      ;(fs.stat as unknown as Mock).mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      )
      ;(fs.writeFile as unknown as Mock).mockResolvedValueOnce(undefined)

      const result = await svc.createFile('/proj', '../../etc/passwd')

      // Separators (forward + back) stripped first → '....etcpasswd' → '.md' appended.
      // The dots remain as part of the filename — what matters for security is
      // that the result CANNOT escape `/proj`. Use platform-aware path
      // normalization to assert the parent directory.
      const writtenPath = (fs.writeFile as unknown as Mock).mock.calls[0][0] as string
      expect(writtenPath.endsWith('etcpasswd.md')).toBe(true)
      // Critical assertion: the written path is INSIDE /proj, never outside.
      expect(writtenPath).toMatch(/[/\\]proj[/\\][^/\\]+\.md$/)
      expect(result).toBe(writtenPath)
    })

    it('throws when fileName collapses to empty after separator strip', async () => {
      await expect(svc.createFile('/proj', '/////'))
        .rejects.toThrow('File name cannot be empty')
    })
  })

  describe('createFile + createFolder + rename validate filename via assertValidUserFilename', () => {
    let originalPlatform: PropertyDescriptor | undefined

    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    })

    afterEach(() => {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    })

    it('createFile throws on Windows-reserved basename CON.md', async () => {
      await expect(svc.createFile('/proj', 'CON')).rejects.toThrow(/CON.*not a valid filename/)
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('createFolder throws on Windows-reserved basename PRN', async () => {
      await expect(svc.createFolder('/proj', 'PRN')).rejects.toThrow(/PRN.*not a valid filename/)
      expect(fs.mkdir).not.toHaveBeenCalled()
    })

    it('rename throws on Windows-reserved basename COM1.md', async () => {
      await expect(svc.rename('/proj/foo.md', 'COM1.md')).rejects.toThrow(/COM1.*not a valid filename/)
    })
  })
})
