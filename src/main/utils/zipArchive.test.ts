// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for zipArchive.ts — covers:
 * 1. Happy path: a well-formed zip built by `yazl` extracts correctly.
 * 2. Pure-logic tests for `assertSafeEntry`: every zip-slip rule.
 *
 * We can't easily build a malicious zip fixture here because `yazl` refuses
 * to emit entry names that fail its own validation (good library hygiene).
 * Instead, we unit-test the pure validator function directly. This gives
 * complete coverage of the rejection rules without needing adversarial
 * binary fixtures.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import yazl from 'yazl'

import { ZipSlipError, assertSafeEntry, assertSafeEntryType, unzip } from './zipArchive'

async function makeZip(
  entries: Array<{ name: string; content?: string; mode?: number; dir?: boolean }>
): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  for (const { name, content = '', mode, dir } of entries) {
    if (dir) zip.addEmptyDirectory(name)
    else zip.addBuffer(Buffer.from(content, 'utf8'), name, mode === undefined ? {} : { mode })
  }
  zip.end()
  return new Promise<Buffer>((resolveP, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolveP(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

describe('zipArchive.unzip (integration, happy path)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'erfana-zipArchive-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('extracts a well-formed zip with nested directories', async () => {
    const src = join(workDir, 'src.zip')
    const dest = join(workDir, 'dest')
    const buf = await makeZip([
      { name: 'hello.txt', content: 'world' },
      { name: 'nested/deep/file.txt', content: 'deep' }
    ])
    await writeFile(src, buf)

    await unzip(src, dest)

    expect(await readFile(join(dest, 'hello.txt'), 'utf8')).toBe('world')
    expect(await readFile(join(dest, 'nested', 'deep', 'file.txt'), 'utf8')).toBe('deep')
  })

  it('preserves multiple top-level files', async () => {
    const src = join(workDir, 'multi.zip')
    const dest = join(workDir, 'dest')
    const buf = await makeZip([
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
      { name: 'c.txt', content: 'ccc' }
    ])
    await writeFile(src, buf)
    await unzip(src, dest)
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('aaa')
    expect(await readFile(join(dest, 'b.txt'), 'utf8')).toBe('bbb')
    expect(await readFile(join(dest, 'c.txt'), 'utf8')).toBe('ccc')
  })

  it('fails closed with the ENOENT open error when the source zip cannot be opened', async () => {
    // yauzl.open errors (ENOENT) → validateEntries rejects rather than extracting.
    // Assert the specific ENOENT message so this cannot pass on any thrown value.
    await expect(unzip(join(workDir, 'does-not-exist.zip'), join(workDir, 'dest')))
      .rejects.toThrow(/ENOENT/)
  })

  // yazl refuses to emit an escaping/unsafe name, so build a benign zip and patch
  // the fixed-length filename bytes (present in both the local header and the
  // central directory) to an adversarial one. Reused by the two cases below.
  async function makePatchedZip(src: string, replacement: string): Promise<void> {
    const placeholder = 'AAAAAAAAA' // 9 bytes
    const buf = await makeZip([{ name: placeholder, content: 'x' }])
    const from = Buffer.from(placeholder)
    const to = Buffer.from(replacement)
    if (to.length !== from.length) throw new Error('replacement must match length')
    for (let i = buf.indexOf(from); i !== -1; i = buf.indexOf(from, i + from.length)) {
      to.copy(buf, i)
    }
    await writeFile(src, buf)
  }

  it('rejects a `..` entry through yauzl’s own error event (validateEntries reject path)', async () => {
    // yauzl validates `..` itself and emits it on the zipfile `error` event, which
    // validateEntries surfaces as a rejection — exercising the error-handler path.
    const src = join(workDir, 'dots.zip')
    await makePatchedZip(src, '../evil.z')
    await expect(unzip(src, join(workDir, 'dest'))).rejects.toThrow(/invalid relative path/i)
  })

  it('rejects an entry our validator flags (NTFS colon) via assertSafeEntry in the entry loop', async () => {
    // A colon passes yauzl’s own checks but assertSafeEntry rejects it, so the
    // `entry` handler throws a ZipSlipError and validateEntries rejects with it —
    // exercising the per-entry rejection path, not just the pure validator.
    const src = join(workDir, 'colon.zip')
    await makePatchedZip(src, 'file:x.tx')
    await expect(unzip(src, join(workDir, 'dest'))).rejects.toBeInstanceOf(ZipSlipError)
  })

  it('rejects a symbolic-link entry and writes nothing (#165)', async () => {
    // The extract-zip advisories: a symlink entry pointing outside destDir,
    // followed by a file written through it. The pre-pass must reject the
    // archive before any entry – even the safe one in front – is written.
    const src = join(workDir, 'symlink.zip')
    const dest = join(workDir, 'dest')
    await writeFile(src, await makeZip([
      { name: 'safe.txt', content: 'ok' },
      { name: 'link', content: '../../outside', mode: 0o120777 },
      { name: 'link/payload.txt', content: 'escaped' }
    ]))
    await expect(unzip(src, dest)).rejects.toThrow(/symbolic-link entry/)
    await expect(access(dest)).rejects.toThrow(/ENOENT/)
  })

  it('extracts explicit directory entries', async () => {
    const src = join(workDir, 'dirs.zip')
    const dest = join(workDir, 'dest')
    await writeFile(src, await makeZip([
      { name: 'empty/', dir: true },
      { name: 'bin/tool', content: 'x' }
    ]))
    await unzip(src, dest)
    expect((await stat(join(dest, 'empty'))).isDirectory()).toBe(true)
    expect(await readFile(join(dest, 'bin', 'tool'), 'utf8')).toBe('x')
  })

  it.skipIf(process.platform === 'win32')('keeps the executable bit of a regular file', async () => {
    const src = join(workDir, 'exec.zip')
    const dest = join(workDir, 'dest')
    await writeFile(src, await makeZip([{ name: 'run.sh', content: '#!/bin/sh', mode: 0o100755 }]))
    await unzip(src, dest)
    expect((await stat(join(dest, 'run.sh'))).mode & 0o111).not.toBe(0)
  })
})

describe('zipArchive.assertSafeEntryType (unit tests for the entry-type rule)', () => {
  it.each([
    ['DOS-made entry (no type bits)', 0],
    ['regular file', 0o100644],
    ['executable file', 0o100755],
    ['directory', 0o040755]
  ])('accepts %s', (_label, mode) => {
    expect(() => assertSafeEntryType('entry', mode)).not.toThrow()
  })

  it('rejects a symbolic link', () => {
    expect(() => assertSafeEntryType('link', 0o120777)).toThrow(ZipSlipError)
    expect(() => assertSafeEntryType('link', 0o120777)).toThrow(/symbolic-link entry/)
  })

  it.each([
    ['character device', 0o020644],
    ['block device', 0o060644],
    ['FIFO', 0o010644],
    ['socket', 0o140644]
  ])('rejects a %s', (_label, mode) => {
    expect(() => assertSafeEntryType('odd', mode)).toThrow(/unsupported entry type/)
  })
})

describe('zipArchive.assertSafeEntry (unit tests for the validator)', () => {
  const dest = resolve('/safe/dest')

  describe('accepts', () => {
    it.each([
      'hello.txt',
      'nested/deep/file.txt',
      'folder/subfolder/file.bin',
      'with spaces.txt',
      'unicode-ñ-file.txt',
      'dash-and_underscore.md',
      'ends-in-dot.'
    ])('safe entry: %s', (name) => {
      expect(() => assertSafeEntry(name, dest)).not.toThrow()
    })
  })

  describe('rejects with ZipSlipError', () => {
    it('rejects `..` traversal at top level', () => {
      expect(() => assertSafeEntry('../escape.txt', dest)).toThrow(ZipSlipError)
      expect(() => assertSafeEntry('../escape.txt', dest)).toThrow(/resolves outside destDir/)
    })

    it('rejects `..` traversal from inside a subdir', () => {
      expect(() => assertSafeEntry('subdir/../../escape.txt', dest)).toThrow(ZipSlipError)
    })

    it('rejects absolute POSIX paths', () => {
      expect(() => assertSafeEntry('/etc/passwd', dest)).toThrow(/absolute POSIX path/)
    })

    it('rejects Windows drive-letter paths', () => {
      expect(() => assertSafeEntry('C:/Windows/evil.exe', dest)).toThrow(/drive-letter/)
      expect(() => assertSafeEntry('D:\\Windows\\evil.exe', dest)).toThrow(/drive-letter/)
    })

    it('rejects UNC-style paths (// prefix)', () => {
      expect(() => assertSafeEntry('//server/share/evil.txt', dest)).toThrow(/UNC path/)
      // Back-slash UNC (converted via normaliser to forward-slash UNC)
      expect(() => assertSafeEntry('\\\\server\\share\\evil.txt', dest)).toThrow(/UNC path/)
    })

    it('rejects NTFS ADS colons', () => {
      expect(() => assertSafeEntry('whisper.exe:Zone.Identifier', dest)).toThrow(/NTFS ADS colon/)
      expect(() => assertSafeEntry('folder/file.bin:$DATA', dest)).toThrow(/NTFS ADS colon/)
    })

    it('ZipSlipError carries the entry name + reason', () => {
      try {
        assertSafeEntry('../evil.txt', dest)
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ZipSlipError)
        expect((e as ZipSlipError).entryName).toBe('../evil.txt')
        expect((e as ZipSlipError).reason).toMatch(/resolves outside destDir/)
        expect((e as ZipSlipError).message).toContain('../evil.txt')
      }
    })
  })
})
