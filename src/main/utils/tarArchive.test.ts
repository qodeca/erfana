// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for tarArchive.ts — tar-slip + symlink rejection + happy path.
 *
 * Every fixture is a tar stream built header by header, never packed from a
 * staged directory. A staged symlink needs symlink privilege on Windows, and
 * `tar.c` normalises `..` and leading `/` away, so a packed fixture either
 * skipped on Windows or never reached the filter at all. A hand-built header
 * carries the hostile path or entry type verbatim on every platform.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { Header } from 'tar'

import { TarSlipError, untarGz } from './tarArchive'

type Entry = {
  path: string
  type?: 'File' | 'Directory' | 'SymbolicLink' | 'Link'
  content?: string
  linkpath?: string
}

const BLOCK = 512

/** Encode entries as a gzipped ustar stream, headers taken verbatim. */
function buildTarGz(entries: Entry[]): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const type = entry.type ?? 'File'
    const body = Buffer.from(type === 'File' ? (entry.content ?? '') : '')
    const header = Buffer.alloc(BLOCK)
    new Header({
      path: entry.path,
      type,
      size: body.length,
      mode: type === 'Directory' ? 0o755 : 0o644,
      mtime: new Date(0),
      linkpath: entry.linkpath
    }).encode(header, 0)
    blocks.push(header)
    if (body.length > 0) {
      const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK)
      body.copy(padded)
      blocks.push(padded)
    }
  }
  // End-of-archive marker: two zero blocks.
  blocks.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(blocks))
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

describe('tarArchive.untarGz', () => {
  let workDir: string
  let destDir: string
  let src: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'erfana-tarArchive-'))
    destDir = join(workDir, 'dest')
    src = join(workDir, 'src.tar.gz')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function writeArchive(entries: Entry[]): Promise<void> {
    await writeFile(src, buildTarGz(entries))
  }

  it('extracts a well-formed tarball', async () => {
    await writeArchive([
      { path: 'nested', type: 'Directory' },
      { path: 'hello.txt', content: 'world' },
      { path: 'nested/deep.txt', content: 'deep' }
    ])
    await untarGz(src, destDir)
    expect(await readFile(join(destDir, 'hello.txt'), 'utf8')).toBe('world')
    expect(await readFile(join(destDir, 'nested', 'deep.txt'), 'utf8')).toBe('deep')
  })

  it('rejects archives containing symlinks', async () => {
    await writeArchive([
      { path: 'benign.txt', content: 'ok' },
      { path: 'evil-link', type: 'SymbolicLink', linkpath: '/etc/passwd' }
    ])
    const result = untarGz(src, destDir)
    await expect(result).rejects.toThrow(TarSlipError)
    await expect(result).rejects.toThrow(/disallowed entry type: SymbolicLink/)
    expect(await exists(join(destDir, 'evil-link'))).toBe(false)
  })

  it('rejects archives containing hardlinks', async () => {
    await writeArchive([{ path: 'evil-hardlink', type: 'Link', linkpath: 'benign.txt' }])
    await expect(untarGz(src, destDir)).rejects.toThrow(/disallowed entry type: Link/)
  })

  it('rejects entries with `..` traversal and writes nothing outside destDir', async () => {
    await writeArchive([{ path: '../escape.txt', content: 'evil' }])
    const result = untarGz(src, destDir)
    await expect(result).rejects.toThrow(TarSlipError)
    await expect(result).rejects.toThrow(/resolves outside destDir/)
    expect(await exists(join(workDir, 'escape.txt'))).toBe(false)
  })

  it.each([
    ['a POSIX absolute path', '/etc/passwd'],
    ['a drive-letter absolute path', 'C:/evil.txt'],
    ['a drive-relative path', 'C:evil.txt']
  ])('rejects %s', async (_label, entryPath) => {
    await writeArchive([{ path: entryPath, content: 'evil' }])
    await expect(untarGz(src, destDir)).rejects.toThrow(/absolute path/)
  })

  it('throws the first rejection when several entries are hostile', async () => {
    await writeArchive([
      { path: '../first.txt', content: 'x' },
      { path: 'second-link', type: 'SymbolicLink', linkpath: '/etc/passwd' }
    ])
    await expect(untarGz(src, destDir)).rejects.toMatchObject({ entryName: '../first.txt' })
  })
})
