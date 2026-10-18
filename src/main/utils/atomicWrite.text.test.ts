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

import { atomicWriteText, atomicWriteJSON, isAtomicTempName, ATOMIC_TEMP_PREFIX } from './atomicWrite'

const posixOnly = process.platform === 'win32' ? it.skip : it
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

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

  posixOnly('a read-only file keeps refusing to save and is not replaced', async () => {
    if (isRoot) return // root writes through the missing permission
    const target = join(dir, 'locked.md')
    await writeFile(target, 'old')
    await chmod(target, 0o444)
    const before = (await stat(target)).ino

    await expect(atomicWriteText(target, 'new')).rejects.toMatchObject({ code: 'EACCES' })

    expect(await readFile(target, 'utf8')).toBe('old')
    expect((await stat(target)).ino).toBe(before)
    expect((await stat(target)).mode & 0o777).toBe(0o444)
    expect(await readdir(dir)).toEqual(['locked.md'])
  })

  posixOnly('a file the user cannot write is not replaced either', async () => {
    if (isRoot) return
    const target = join(dir, 'locked.md')
    await writeFile(target, 'old')
    await chmod(target, 0o200 ^ 0o200) // no bits at all

    await expect(atomicWriteText(target, 'new')).rejects.toMatchObject({ code: 'EACCES' })
    await chmod(target, 0o600)
    expect(await readFile(target, 'utf8')).toBe('old')
  })

  posixOnly('on a case-insensitive disk a differently spelled path writes to the on-disk name', async () => {
    const onDisk = join(dir, 'notes.md')
    await writeFile(onDisk, 'old')
    const caseInsensitive = await stat(join(dir, 'NOTES.md')).then(() => true, () => false)
    if (!caseInsensitive) return

    await atomicWriteText(join(dir, 'Notes.md'), 'new')

    expect(await readdir(dir)).toEqual(['notes.md'])
    expect(await readFile(onDisk, 'utf8')).toBe('new')
  })

  it('rejects when the parent directory is missing and leaves nothing behind', async () => {
    await expect(atomicWriteText(join(dir, 'missing', 'a.md'), 'x')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])
  })
})

describe('atomicWriteJSON keeps links', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erfana-atomic-json-links-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  posixOnly('writes through a symlink (a dotfile manager setup), which stays a symlink', async () => {
    const real = join(dir, 'managed.json')
    const linkPath = join(dir, 'settings.json')
    await writeFile(real, '{}')
    await symlink(real, linkPath)

    await atomicWriteJSON(linkPath, { a: 1 }, 2)

    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(real, 'utf8'))).toEqual({ a: 1 })
    expect((await readdir(dir)).sort()).toEqual(['managed.json', 'settings.json'])
  })

  posixOnly('writes a hard-linked file in place', async () => {
    const a = join(dir, 'a.json')
    const b = join(dir, 'b.json')
    await writeFile(a, '{}')
    await link(a, b)

    await atomicWriteJSON(a, { a: 1 })

    expect(JSON.parse(await readFile(b, 'utf8'))).toEqual({ a: 1 })
    expect((await stat(a)).nlink).toBe(2)
  })

  it('still replaces a plain file through a temp file', async () => {
    const a = join(dir, 'a.json')
    await writeFile(a, '{}')

    await atomicWriteJSON(a, { a: 1 })

    expect(JSON.parse(await readFile(a, 'utf8'))).toEqual({ a: 1 })
    expect(await readdir(dir)).toEqual(['a.json'])
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
