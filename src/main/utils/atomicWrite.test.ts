// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWrite.test.ts
 *
 * Tests for atomic file write utilities
 *
 * Coverage:
 * - atomicWriteJSON creates file with correct content
 * - atomicWriteJSON sets correct permissions (0o600 for files)
 * - atomicWriteJSON handles write errors and cleans up temp files
 * - removeIfExists returns true when file exists
 * - removeIfExists returns false for ENOENT
 * - removeIfExists throws on other errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import { atomicWriteJSON, removeIfExists } from './atomicWrite'

const TEST_BASE = path.join(os.tmpdir(), 'erfana-test', '.erfana', 'locks')
const LOCK_PATH = path.join(TEST_BASE, 'test.lock')
const TMP_PATH = path.join(TEST_BASE, '.test-uuid-1234.tmp')
const NONEXISTENT_LOCK = path.join(TEST_BASE, 'nonexistent.lock')
const LOCK_1 = path.join(TEST_BASE, 'test1.lock')
const LOCK_2 = path.join(TEST_BASE, 'test2.lock')

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
import { writeFile, rename, unlink } from 'node:fs/promises'

const mockedWriteFile = vi.mocked(writeFile)
const mockedRename = vi.mocked(rename)
const mockedUnlink = vi.mocked(unlink)

describe('atomicWriteJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates file with correct JSON content', async () => {
    const content = { foo: 'bar', num: 42 }
    const filePath = LOCK_PATH

    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    // Should write compact JSON to temp file
    expect(mockedWriteFile).toHaveBeenCalledWith(
      TMP_PATH,
      JSON.stringify(content),
      {
        encoding: 'utf8',
        mode: 0o600
      }
    )

    // Should rename temp file to target
    expect(mockedRename).toHaveBeenCalledWith(
      TMP_PATH,
      filePath
    )
  })

  it('sets owner-only permissions (0o600) for files', async () => {
    const content = { sensitive: 'data' }
    const filePath = LOCK_PATH

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
    const filePath = LOCK_PATH
    const writeError = new Error('Disk full')

    mockedWriteFile.mockRejectedValue(writeError)
    mockedUnlink.mockResolvedValue(undefined)

    await expect(atomicWriteJSON(filePath, content)).rejects.toThrow('Disk full')

    // Should attempt to clean up temp file
    expect(mockedUnlink).toHaveBeenCalledWith(TMP_PATH)
  })

  it('handles rename errors and cleans up temp file', async () => {
    const content = { test: 'data' }
    const filePath = LOCK_PATH
    const renameError = new Error('Permission denied')

    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockRejectedValue(renameError)
    mockedUnlink.mockResolvedValue(undefined)

    await expect(atomicWriteJSON(filePath, content)).rejects.toThrow('Permission denied')

    // Should attempt to clean up temp file
    expect(mockedUnlink).toHaveBeenCalledWith(TMP_PATH)
  })

  it('ignores cleanup errors if temp file does not exist', async () => {
    const content = { test: 'data' }
    const filePath = LOCK_PATH
    const renameError = new Error('Permission denied')
    const unlinkError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

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
    const filePath = LOCK_PATH

    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(content),
      expect.any(Object)
    )
  })

  it('uses unique temp file names for concurrent writes', async () => {
    const content = { test: 'data' }
    const filePath = LOCK_PATH

    mockedWriteFile.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)

    await atomicWriteJSON(filePath, content)

    // Temp file should use randomUUID
    expect(mockedWriteFile).toHaveBeenCalledWith(
      TMP_PATH,
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
    const filePath = LOCK_PATH

    mockedUnlink.mockResolvedValue(undefined)

    const result = await removeIfExists(filePath)

    expect(result).toBe(true)
    expect(mockedUnlink).toHaveBeenCalledWith(filePath)
  })

  it('returns false for ENOENT (file does not exist)', async () => {
    const filePath = NONEXISTENT_LOCK
    const enoentError = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(enoentError)

    const result = await removeIfExists(filePath)

    expect(result).toBe(false)
  })

  it('throws on permission errors', async () => {
    const filePath = LOCK_PATH
    const epermError = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(epermError)

    await expect(removeIfExists(filePath)).rejects.toThrow('EPERM: operation not permitted')
  })

  it('throws on other filesystem errors', async () => {
    const filePath = LOCK_PATH
    const eioError = Object.assign(new Error('EIO: input/output error'), {
      code: 'EIO'
    }) as NodeJS.ErrnoException

    mockedUnlink.mockRejectedValue(eioError)

    await expect(removeIfExists(filePath)).rejects.toThrow('EIO: input/output error')
  })

  it('handles multiple consecutive calls', async () => {
    const filePath1 = LOCK_1
    const filePath2 = LOCK_2

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

describe('atomicWriteJSON rename retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Use fake timers to make backoff delays instant
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries rename up to 3 times when Windows reports EPERM (AV/indexer race)', async () => {
    mockedWriteFile.mockResolvedValue(undefined)
    mockedUnlink.mockResolvedValue(undefined)

    let attempts = 0
    mockedRename.mockImplementation(async () => {
      attempts++
      if (attempts < 3) {
        const err: NodeJS.ErrnoException = new Error('EPERM: simulated')
        err.code = 'EPERM'
        throw err
      }
      // third attempt succeeds
    })

    const writePromise = atomicWriteJSON('/test/file.json', { ok: true })
    await vi.runAllTimersAsync()
    await writePromise

    expect(attempts).toBe(3)
  })

  it('does not retry on non-retryable errno (ENOSPC)', async () => {
    mockedWriteFile.mockResolvedValue(undefined)
    mockedUnlink.mockResolvedValue(undefined)

    let attempts = 0
    mockedRename.mockImplementation(async () => {
      attempts++
      const err: NodeJS.ErrnoException = new Error('ENOSPC: disk full')
      err.code = 'ENOSPC'
      throw err
    })

    const writePromise = atomicWriteJSON('/test/file.json', { ok: true })
    await vi.runAllTimersAsync()

    await expect(writePromise).rejects.toThrow('ENOSPC')
    expect(attempts).toBe(1)
  })

  it('throws the last error after exhausting all retries', async () => {
    mockedWriteFile.mockResolvedValue(undefined)
    mockedUnlink.mockResolvedValue(undefined)

    let attempts = 0
    mockedRename.mockImplementation(async () => {
      attempts++
      const err: NodeJS.ErrnoException = new Error('EPERM: persistent')
      err.code = 'EPERM'
      throw err
    })

    const writePromise = atomicWriteJSON('/test/file.json', { ok: true })
    await vi.runAllTimersAsync()

    await expect(writePromise).rejects.toThrow('EPERM')
    expect(attempts).toBe(4) // initial attempt + 3 retries = 4 total
  })
})
