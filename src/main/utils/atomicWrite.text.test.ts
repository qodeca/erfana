// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWriteText on a real temp directory (no fs mocks – see
 * `atomicWrite.text.failure.test.ts` for the mocked-rename cases).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile, chmod, link, symlink, stat, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../services/LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { atomicWriteText, isAtomicTempName, ATOMIC_TEMP_PREFIX } from './atomicWrite'

const posixOnly = process.platform === 'win32' ? it.skip : it

describe('atomicWriteText', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erfana-atomic-text-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a new file and replaces an existing one, leaving no temp file behind', async () => {
    const target = join(dir, 'a.md')

    await atomicWriteText(target, 'first')
    expect(await readFile(target, 'utf8')).toBe('first')
    await atomicWriteText(target, 'second é ✓')
    expect(await readFile(target, 'utf8')).toBe('second é ✓')

    expect(await readdir(dir)).toEqual(['a.md'])
  })

  posixOnly('keeps the permission bits of the original file', async () => {
    const target = join(dir, 'script.md')
    await writeFile(target, 'old')
    await chmod(target, 0o751)

    await atomicWriteText(target, 'new')

    expect((await stat(target)).mode & 0o777).toBe(0o751)
    expect(await readFile(target, 'utf8')).toBe('new')
  })

  posixOnly('writes through a hard link in place, so the other name sees the change', async () => {
    const target = join(dir, 'a.md')
    const other = join(dir, 'b.md')
    await writeFile(target, 'old')
    await link(target, other)

    await atomicWriteText(target, 'new')

    expect(await readFile(other, 'utf8')).toBe('new')
    expect((await stat(target)).ino).toBe((await stat(other)).ino)
    expect((await stat(target)).nlink).toBe(2)
  })

  posixOnly('writes through a symlink, which stays a symlink', async () => {
    const real = join(dir, 'real.md')
    const linkPath = join(dir, 'link.md')
    await writeFile(real, 'old')
    await symlink(real, linkPath)

    await atomicWriteText(linkPath, 'new')

    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(real, 'utf8')).toBe('new')
    expect((await readdir(dir)).sort()).toEqual(['link.md', 'real.md'])
  })

  it('rejects when the parent directory is missing and leaves nothing behind', async () => {
    await expect(atomicWriteText(join(dir, 'missing', 'a.md'), 'x')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])
  })
})

describe('isAtomicTempName', () => {
  it('matches the last segment only, with either separator', () => {
    expect(isAtomicTempName(`${ATOMIC_TEMP_PREFIX}x`)).toBe(true)
    expect(isAtomicTempName(`a/b/${ATOMIC_TEMP_PREFIX}x`)).toBe(true)
    expect(isAtomicTempName(`a\\b\\${ATOMIC_TEMP_PREFIX}x`)).toBe(true)
    expect(isAtomicTempName(`a/${ATOMIC_TEMP_PREFIX}dir/file.md`)).toBe(false)
    expect(isAtomicTempName('a/b.md')).toBe(false)
  })
})
