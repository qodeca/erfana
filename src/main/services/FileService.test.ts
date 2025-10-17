import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  let fs: jest.Mocked<typeof import('fs/promises')>
  let svc: FileService

  beforeEach(async () => {
    fs = (await import('fs/promises')) as unknown as jest.Mocked<
      typeof import('fs/promises')
    >
    // Reset all mocks
    vi.resetAllMocks()
    svc = new FileService()
  })

  describe('deleteFile', () => {
    it('throws when target is a directory', async () => {
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFile('/proj/dir'))
        .rejects.toThrow('Cannot delete a directory using deleteFile')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('throws when file is outside project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      await expect(svc.deleteFile('/other/file.md'))
        .rejects.toThrow('outside the project directory')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('deletes file within project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(fs.rm as unknown as jest.Mock).mockResolvedValueOnce(undefined)
      await expect(svc.deleteFile('/proj/docs/readme.md')).resolves.toBeUndefined()
      expect(fs.rm).toHaveBeenCalledWith('/proj/docs/readme.md')
    })
  })

  describe('deleteFolder', () => {
    it('throws when not a directory', async () => {
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      await expect(svc.deleteFolder('/proj/file.md')).rejects.toThrow('Path is not a directory')
    })

    it('prevents deleting project root', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFolder('/proj')).rejects.toThrow('Cannot delete the project root')
    })

    it('prevents deleting outside project', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      await expect(svc.deleteFolder('/other/folder')).rejects.toThrow('outside the project directory')
    })

    it('deletes folder recursively within project', async () => {
      svc.setProjectPath('/proj')
      ;(fs.stat as unknown as jest.Mock).mockResolvedValueOnce(makeStats({ isDir: true }))
      ;(fs.rm as unknown as jest.Mock).mockResolvedValueOnce(undefined)
      await expect(svc.deleteFolder('/proj/tmp/cache')).resolves.toBeUndefined()
      expect(fs.rm).toHaveBeenCalledWith('/proj/tmp/cache', { recursive: true, force: true })
    })
  })
})

