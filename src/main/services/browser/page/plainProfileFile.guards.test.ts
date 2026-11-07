// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's plain list files (spec 025, ADR 0009 decision 7) with the guarded
 * file layer stubbed: a rejection that is not an `Error` (the read still
 * starts empty, the write still resolves, and the log line carries the value
 * as text), and a temp file that is gone before the rename (the clean-up
 * unlink fails too, and the write still resolves). Split from
 * `plainProfileFile.test.ts` because the module mock hoists.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('../../LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../browserProfileGuards', () => ({
  readFileNoFollow: vi.fn(() => Promise.reject('read went wrong')),
  createFileExclusive: vi.fn(() => Promise.reject(42))
}))

import { logger } from '../../LoggingService'
import { createFileExclusive } from '../browserProfileGuards'
import { readPlainList, writePlainList, type PlainListFile } from './plainProfileFile'

const file: PlainListFile<{ url: string }> = {
  // Never created: nothing at this path exists, so the rename and the unlink both fail.
  canonical: '/nonexistent-erfana-test/project',
  segments: ['profile', 'Erfana', 'list.json'],
  entry: z.object({ url: z.string() }).strict(),
  maxEntries: 3,
  maxBytes: 200,
  label: 'Test list'
}

describe('plain list files, with the guarded file layer stubbed', () => {
  it('reads as empty and logs the rejected value as text', async () => {
    expect(await readPlainList(file)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Test list: file unreadable, starting empty', {
      error: 'read went wrong'
    })
  })

  it('resolves the write and logs the rejected value as text', async () => {
    await expect(writePlainList(file, [{ url: 'http://a.test/' }])).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Test list: file not written, kept in memory', {
      error: '42'
    })
  })
  it('resolves and logs the rename failure when the temp file is gone and its clean-up fails too', async () => {
    vi.mocked(createFileExclusive).mockResolvedValueOnce(undefined)
    vi.mocked(logger.warn).mockClear()
    await expect(writePlainList(file, [{ url: 'http://a.test/' }])).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith('Test list: file not written, kept in memory', {
      error: expect.stringContaining('ENOENT')
    })
  })
})
