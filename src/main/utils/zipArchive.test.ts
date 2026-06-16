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
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import yazl from 'yazl'

import { ZipSlipError, assertSafeEntry, unzip } from './zipArchive'

async function makeZip(
  entries: Array<{ name: string; content: string }>
): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  for (const { name, content } of entries) {
    zip.addBuffer(Buffer.from(content, 'utf8'), name)
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
