// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `readText` (#478 plan step S3, C1 rows): the classified editor read, on real
 * temp files; the open is faked only for the failures a real file cannot show
 * on every host (a lock, a FIFO, a file moving mid-read).
 */
import { mkdtempSync, rmSync, truncateSync, writeFileSync, type BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FRESHNESS_LIMITS } from '../../../shared/freshness/timingProfiles'
import { FileStamper, sha256Hex } from './fileStamp'
import { classifyTextBytes, detectEol, readText } from './textRead'

/** A fake handle whose `stat` answers come from `stats`, one per call (the last repeats). */
function fakeHandle(stats: Partial<BigIntStats>[], content = Buffer.alloc(0)): FileHandle {
  let call = 0
  return {
    stat: async () => {
      const s = stats[Math.min(call++, stats.length - 1)]
      return { isFile: () => true, size: BigInt(content.length), mtimeNs: 0n, ctimeNs: 0n, ino: 1n, ...s } as BigIntStats
    },
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = content.copy(buffer, offset, position, Math.min(position + length, content.length))
      return { bytesRead, buffer }
    },
    close: async () => undefined,
  } as unknown as FileHandle
}

function failingOpen(code: string): FileStamper {
  return new FileStamper({
    open: async () => {
      throw Object.assign(new Error(code), { code })
    },
  })
}

describe('readText', () => {
  let dir: string
  const path = (name: string): string => join(dir, name)
  const write = (name: string, bytes: Buffer | string): string => {
    writeFileSync(path(name), bytes)
    return path(name)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-textread-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads text with its stamp (SHA-256 of the exact bytes) and line ending', async () => {
    const file = write('a.md', '# Title\nbody\n')
    const reply = await readText(file)
    expect(reply).toMatchObject({ status: 'ok', text: '# Title\nbody\n', eol: 'lf' })
    if (reply.status === 'ok') {
      expect(reply.stamp.hash).toBe(sha256Hex('# Title\nbody\n'))
      expect(reply.stamp.size).toBe(13)
    }
  })

  it('reads an empty file as empty text', async () => {
    await expect(readText(write('empty.md', ''))).resolves.toMatchObject({ status: 'ok', text: '', eol: 'none' })
  })

  it('refuses a file over the limit without reading it', async () => {
    const file = write('big.md', 'x'.repeat(11))
    await expect(readText(file, { limit: 10 })).resolves.toEqual({ status: 'too-large', size: 11 })
  })

  it('the default limit is the editor’s 10 MiB (Q2)', async () => {
    const file = write('huge.md', '')
    truncateSync(file, FRESHNESS_LIMITS.editorTextMaxBytes + 1)
    await expect(readText(file)).resolves.toEqual({ status: 'too-large', size: FRESHNESS_LIMITS.editorTextMaxBytes + 1 })
  })

  it('a file exactly at the limit is read', async () => {
    const file = write('edge.md', 'x'.repeat(10))
    await expect(readText(file, { limit: 10 })).resolves.toMatchObject({ status: 'ok', text: 'x'.repeat(10) })
  })

  it('a NUL byte is binary', async () => {
    await expect(readText(write('nul.md', Buffer.from([0x61, 0x00, 0x62])))).resolves.toEqual({ status: 'binary' })
  })

  it('invalid UTF-8 is binary', async () => {
    await expect(readText(write('bad.md', Buffer.from([0x61, 0xc3, 0x28])))).resolves.toEqual({ status: 'binary' })
  })

  it.each([
    ['UTF-16 LE', [0xff, 0xfe, 0x61, 0x00]],
    ['UTF-16 BE', [0xfe, 0xff, 0x00, 0x61]],
    ['UTF-32 LE', [0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00]],
    ['UTF-32 BE', [0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x61]],
  ])('a %s byte-order mark is an unsupported encoding', async (_name, bytes) => {
    await expect(readText(write('wide.md', Buffer.from(bytes)))).resolves.toEqual({ status: 'unsupported-encoding' })
  })

  it('keeps a UTF-8 BOM as content: adding or removing it is a change', async () => {
    const withBom = await readText(write('bom.md', Buffer.from([0xef, 0xbb, 0xbf, 0x61])))
    const without = await readText(write('plain.md', 'a'))
    expect(withBom).toMatchObject({ status: 'ok', text: '﻿a' })
    if (withBom.status === 'ok' && without.status === 'ok') {
      expect(withBom.stamp.hash).not.toBe(without.stamp.hash)
    }
  })

  it('keeps CRLF as read and reports it; a switch to LF is a change', async () => {
    const crlf = await readText(write('crlf.md', 'a\r\nb\r\n'))
    const lf = await readText(write('lf.md', 'a\nb\n'))
    expect(crlf).toMatchObject({ status: 'ok', text: 'a\r\nb\r\n', eol: 'crlf' })
    expect(lf).toMatchObject({ status: 'ok', eol: 'lf' })
    if (crlf.status === 'ok' && lf.status === 'ok') expect(crlf.stamp.hash).not.toBe(lf.stamp.hash)
  })

  it('answers missing for a file that is not there', async () => {
    await expect(readText(path('gone.md'))).resolves.toEqual({ status: 'missing' })
  })

  it.each(['EACCES', 'EPERM', 'EBUSY'])('answers unreadable when the open fails with %s', async (code) => {
    await expect(readText('/p/a.md', { stamper: failingOpen(code) })).resolves.toEqual({ status: 'unreadable' })
  })

  it('answers unsupported for a FIFO (fstat says not a file), without reading', async () => {
    const handle = fakeHandle([{ isFile: () => false }])
    ;(handle as unknown as { read: () => never }).read = () => {
      throw new Error('a FIFO read would block')
    }
    const stamper = new FileStamper({ open: async () => handle })
    await expect(readText('/p/fifo', { stamper })).resolves.toEqual({ status: 'unsupported' })
  })

  it('answers unsupported for a folder', async () => {
    await expect(readText(dir)).resolves.toEqual({ status: 'unsupported' })
  })

  it('P3: answers busy when the size moves during the read', async () => {
    const content = Buffer.from('abc')
    const handle = fakeHandle([{ size: 3n }, { size: 4n }], content)
    await expect(readText('/p/a.md', { stamper: new FileStamper({ open: async () => handle }) })).resolves.toEqual({
      status: 'busy',
    })
  })

  it('P3: answers busy when more bytes are there than fstat counted', async () => {
    const handle = fakeHandle([{ size: 2n }], Buffer.from('abcd'))
    await expect(readText('/p/a.md', { stamper: new FileStamper({ open: async () => handle }) })).resolves.toEqual({
      status: 'busy',
    })
  })

  it('seeds the stamper’s hash cache, so the probe after a read does not read again', async () => {
    const stamper = new FileStamper()
    const file = write('seed.md', 'seeded')
    await readText(file, { stamper })
    expect(stamper.cacheSize).toBe(1)
  })
})

describe('classifyTextBytes / detectEol', () => {
  it('decodes valid UTF-8 including multi-byte characters', () => {
    expect(classifyTextBytes(Buffer.from('zażółć', 'utf8'))).toEqual({ kind: 'text', text: 'zażółć' })
  })

  it('takes the line ending of the first line break', () => {
    expect(detectEol('a\r\nb\nc')).toBe('crlf')
    expect(detectEol('a\nb\r\n')).toBe('lf')
    expect(detectEol('\nx')).toBe('lf')
    expect(detectEol('abc')).toBe('none')
  })
})
