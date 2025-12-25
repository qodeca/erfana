/**
 * atomicWrite.test.ts
 *
 * Tests for atomic file write utilities
 *
 * Coverage:
 * - atomicWriteJSON creates file with correct content
 * - atomicWriteJSON creates directory if not exists
 * - atomicWriteJSON sets correct permissions (0o600 for files, 0o700 for dirs)
 * - atomicWriteJSON handles write errors and cleans up temp files
 * - removeIfExists returns true when file exists
 * - removeIfExists returns false for ENOENT
 * - removeIfExists throws on other errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { atomicWriteJSON, removeIfExists } from './atomicWrite'

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn()
}))

// Mock crypto
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234')
}))

// Import mocked modules
import { writeFile, rename, unlink, mkdir } from 'node:fs/promises'

const mockedWriteFile = vi.mocked(writeFile)
const mockedRename = vi.mocked(rename)
const mockedUnlink = vi.mocked(unlink)
const mockedMkdir = vi.mocked(mkdir)

describe('atomicWriteJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates file with correct JSON content', async () => {
    const content = { foo: 'bar', num: 42 }
    const filePath = '/Users/test/.erfana/locks/test.lock'

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    // Should write formatted JSON to temp file
    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/Users/test/.erfana/locks/.test-uuid-1234.tmp',
      JSON.stringify(content, null, 2),
      {
        encoding: 'utf8',
        mode: 0o600
      }
    )

    // Should rename temp file to target
    expect(mockedRename).toHaveBeenCalledWith(
      '/Users/test/.erfana/locks/.test-uuid-1234.tmp',
      filePath
    )
  })

  it('creates directory if not exists with correct permissions', async () => {
    const content = { test: 'data' }
    const filePath = '/Users/test/.erfana/locks/new/test.lock'

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    expect(mockedMkdir).toHaveBeenCalledWith('/Users/test/.erfana/locks/new', {
      recursive: true,
      mode: 0o700
    })
  })

  it('sets owner-only permissions (0o600) for files', async () => {
    const content = { sensitive: 'data' }
    const filePath = '/Users/test/.erfana/locks/test.lock'

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        mode: 0o600
      })
    )
  })

  it('handles write errors and cleans up temp file', async () => {
    const content = { test: 'data' }
    const filePath = '/Users/test/.erfana/locks/test.lock'
    const writeError = new Error('Disk full')

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockRejectedValue(writeError)
    mockedUnlink.mockResolvedValue(undefined)

    await expect(atomicWriteJSON(filePath, content)).rejects.toThrow('Disk full')

    // Should attempt to clean up temp file
    expect(mockedUnlink).toHaveBeenCalledWith('/Users/test/.erfana/locks/.test-uuid-1234.tmp')
  })

  it('handles rename errors and cleans up temp file', async () => {
    const content = { test: 'data' }
    const filePath = '/Users/test/.erfana/locks/test.lock'
    const renameError = new Error('Permission denied')

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockRejectedValue(renameError)
    mockedUnlink.mockResolvedValue(undefined)

    await expect(atomicWriteJSON(filePath, content)).rejects.toThrow('Permission denied')

    // Should attempt to clean up temp file
    expect(mockedUnlink).toHaveBeenCalledWith('/Users/test/.erfana/locks/.test-uuid-1234.tmp')
  })

  it('ignores cleanup errors if temp file does not exist', async () => {
    const content = { test: 'data' }
    const filePath = '/Users/test/.erfana/locks/test.lock'
    const renameError = new Error('Permission denied')
    const unlinkError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockRejectedValue(renameError)
    mockedUnlink.mockRejectedValue(unlinkError)

    // Should throw the original rename error, not the unlink error
    await expect(atomicWriteJSON(filePath, content)).rejects.toThrow('Permission denied')
  })

  it('serializes complex objects correctly', async () => {
    const content = {
      nested: {
        array: [1, 2, 3],
        null: null,
        bool: true
      }
    }
    const filePath = '/Users/test/.erfana/locks/test.lock'

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(content, null, 2),
      expect.any(Object)
    )
  })

  it('uses unique temp file names for concurrent writes', async () => {
    const content = { test: 'data' }
    const filePath = '/Users/test/.erfana/locks/test.lock'

    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    // Temp file should use randomUUID
    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/Users/test/.erfana/locks/.test-uuid-1234.tmp',
      expect.any(String),
      expect.any(Object)
    )
  })
})

describe('removeIfExists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when file exists and is removed', async () => {
    const filePath = '/Users/test/.erfana/locks/test.lock'

    mockedUnlink.mockResolvedValue(undefined)

    const result = await removeIfExists(filePath)

    expect(result).toBe(true)
    expect(mockedUnlink).toHaveBeenCalledWith(filePath)
  })

  it('returns false for ENOENT (file does not exist)', async () => {
    const filePath = '/Users/test/.erfana/locks/nonexistent.lock'
    const enoentError = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(enoentError)

    const result = await removeIfExists(filePath)

    expect(result).toBe(false)
  })

  it('throws on permission errors', async () => {
    const filePath = '/Users/test/.erfana/locks/test.lock'
    const epermError = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(epermError)

    await expect(removeIfExists(filePath)).rejects.toThrow('EPERM: operation not permitted')
  })

  it('throws on other filesystem errors', async () => {
    const filePath = '/Users/test/.erfana/locks/test.lock'
    const eioError = Object.assign(new Error('EIO: input/output error'), {
      code: 'EIO'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(eioError)

    await expect(removeIfExists(filePath)).rejects.toThrow('EIO: input/output error')
  })

  it('handles multiple consecutive calls', async () => {
    const filePath1 = '/Users/test/.erfana/locks/test1.lock'
    const filePath2 = '/Users/test/.erfana/locks/test2.lock'

    mockedUnlink
      .mockResolvedValueOnce(undefined) // First call succeeds
      .mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException
      ) // Second call fails with ENOENT

    const result1 = await removeIfExists(filePath1)
    const result2 = await removeIfExists(filePath2)

    expect(result1).toBe(true)
    expect(result2).toBe(false)
  })
})
