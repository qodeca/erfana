// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWriteText failure paths. Split from `atomicWrite.text.test.ts` because
 * the module-scope `rename` mock hoists (docs/windows/contributing.md, test-file
 * split policy). Everything else is the real fs on a temp directory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hooks = vi.hoisted(() => ({ rename: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: hooks.rename }
})

vi.mock('../services/LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../services/LoggingService'
import { atomicWriteText } from './atomicWrite'

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated, rename '/secret/user/notes.md'`), { code })
}

describe('atomicWriteText failure paths', () => {
  let dir: string
  let target: string
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erfana-atomic-fail-'))
    target = join(dir, 'doc.md')
    await writeFile(target, 'ORIGINAL')
    vi.clearAllMocks()
    hooks.rename.mockReset()
  })

  afterEach(async () => {
    Object.defineProperty(process, 'platform', platform)
    await rm(dir, { recursive: true, force: true })
  })

  it('a crash between the temp write and the rename leaves the original intact and no temp file', async () => {
    hooks.rename.mockRejectedValue(errno('EIO'))

    await expect(atomicWriteText(target, 'NEW CONTENT')).rejects.toMatchObject({ code: 'EIO' })

    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
    expect(await readdir(dir)).toEqual(['doc.md'])
  })

  it('a temp file written but never renamed (process killed) does not touch the original', async () => {
    // The kill: the rename never completes, so neither does the cleanup
    hooks.rename.mockImplementation(() => new Promise(() => {}))
    void atomicWriteText(target, 'NEW CONTENT')
    await vi.waitFor(async () => expect((await readdir(dir)).length).toBe(2))

    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
    const temp = (await readdir(dir)).find((n) => n !== 'doc.md')!
    expect(temp.startsWith('.erfana-tmp-')).toBe(true)
    expect(await readFile(join(dir, temp), 'utf8')).toBe('NEW CONTENT')
  })

  it('renames the temp file over the target on the happy path', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    hooks.rename.mockImplementation(actual.rename)

    await atomicWriteText(target, 'NEW')

    expect(await readFile(target, 'utf8')).toBe('NEW')
    expect(await readdir(dir)).toEqual(['doc.md'])
  })

  it('on POSIX a persistent EPERM is rethrown, not papered over', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    hooks.rename.mockRejectedValue(errno('EPERM'))

    await expect(atomicWriteText(target, 'NEW')).rejects.toMatchObject({ code: 'EPERM' })

    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
    expect(await readdir(dir)).toEqual(['doc.md'])
  })

  it.each(['EPERM', 'EBUSY'])(
    'on Windows a persistent %s falls back to an in-place write, warns without the path, and cleans the temp',
    async (code) => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      hooks.rename.mockRejectedValue(errno(code))

      await atomicWriteText(target, 'NEW CONTENT')

      expect(await readFile(target, 'utf8')).toBe('NEW CONTENT')
      expect(await readdir(dir)).toEqual(['doc.md'])
      expect(hooks.rename).toHaveBeenCalledTimes(4) // first try + 3 retries
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('/secret/user')
    }
  )

  it('on Windows a non-lock error is still rethrown', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    hooks.rename.mockRejectedValue(errno('ENOSPC'))

    await expect(atomicWriteText(target, 'NEW')).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL')
  })
})
