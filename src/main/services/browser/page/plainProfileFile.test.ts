// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's plain list files (spec 025, ADR 0009 decision 7), on a real
 * temporary folder: untrusted input on read (missing, too large, malformed,
 * a link or a folder at the name all read as empty), a write that never
 * rejects and never writes through a link at the name.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('../../LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../../LoggingService'
import { readPlainList, writePlainList, type PlainListFile } from './plainProfileFile'

const itPosix = process.platform === 'win32' ? it.skip : it

const Entry = z.object({ url: z.string().min(1) }).strict()
type Entry = z.infer<typeof Entry>

let root: string
let file: PlainListFile<Entry>
let path: string

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-plain-')))
  mkdirSync(join(root, 'profile', 'Erfana'), { recursive: true })
  file = {
    canonical: root,
    segments: ['profile', 'Erfana', 'list.json'],
    entry: Entry,
    maxEntries: 3,
    maxBytes: 200,
    label: 'Test list'
  }
  path = join(root, 'profile', 'Erfana', 'list.json')
  vi.mocked(logger.warn).mockClear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function folderNames(): string[] {
  return readdirSync(join(root, 'profile', 'Erfana'))
}

describe('readPlainList', () => {
  it('reads the entries of a version-1 file', async () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        entries: [{ url: 'http://a.test/' }, { url: 'http://b.test/' }]
      })
    )
    expect(await readPlainList(file)).toEqual([
      { url: 'http://a.test/' },
      { url: 'http://b.test/' }
    ])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reads an empty list', async () => {
    writeFileSync(path, JSON.stringify({ version: 1, entries: [] }))
    expect(await readPlainList(file)).toEqual([])
  })

  it('starts empty, without a log line, when the file is missing', async () => {
    expect(await readPlainList(file)).toEqual([])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('ignores a file larger than the cap', async () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 1, entries: [{ url: `http://a.test/${'x'.repeat(300)}` }] })
    )
    expect(await readPlainList(file)).toEqual([])
  })

  it('reads a file exactly at the cap', async () => {
    const prefix = JSON.stringify({ version: 1, entries: [{ url: 'http://a.test/' }] })
    const padded = prefix.padEnd(file.maxBytes, ' ')
    expect(Buffer.byteLength(padded)).toBe(file.maxBytes)
    writeFileSync(path, padded)
    expect(await readPlainList(file)).toEqual([{ url: 'http://a.test/' }])
  })

  it.each([
    ['text that is not JSON', 'not json {'],
    ['an empty file', ''],
    [
      'a signed file (version 2 with hmac)',
      JSON.stringify({ version: 2, entries: [], hmac: 'aa' })
    ],
    ['an unknown top-level key', JSON.stringify({ version: 1, entries: [], extra: true })],
    ['an entry that fails its schema', JSON.stringify({ version: 1, entries: [{ url: '' }] })],
    [
      'an entry with an unknown key',
      JSON.stringify({ version: 1, entries: [{ url: 'http://a.test/', user: 'me' }] })
    ],
    [
      'more entries than the cap',
      JSON.stringify({
        version: 1,
        entries: ['a', 'b', 'c', 'd'].map(h => ({ url: `http://${h}/` }))
      })
    ],
    ['JSON null', 'null'],
    ['a bare array', '[]']
  ])('ignores and logs %s', async (_name, text) => {
    writeFileSync(path, text)
    expect(await readPlainList(file)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Test list: file malformed, ignored')
  })

  it('starts empty and logs when a folder sits at the name', async () => {
    mkdirSync(path)
    expect(await readPlainList(file)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'Test list: file unreadable, starting empty',
      expect.objectContaining({ error: expect.any(String) })
    )
  })

  itPosix('starts empty and never reads through a link at the name', async () => {
    const outside = join(root, 'outside.json')
    writeFileSync(
      outside,
      JSON.stringify({ version: 1, entries: [{ url: 'http://planted.test/' }] })
    )
    symlinkSync(outside, path)
    expect(await readPlainList(file)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'Test list: file unreadable, starting empty',
      expect.objectContaining({ error: expect.any(String) })
    )
  })
})

describe('writePlainList', () => {
  it('writes a version-1 file that reads back, leaving no temp file', async () => {
    await writePlainList(file, [{ url: 'http://a.test/' }])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      entries: [{ url: 'http://a.test/' }]
    })
    expect(await readPlainList(file)).toEqual([{ url: 'http://a.test/' }])
    expect(folderNames()).toEqual(['list.json'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('replaces an existing file whole, including with an empty list', async () => {
    await writePlainList(file, [{ url: 'http://a.test/' }, { url: 'http://b.test/' }])
    await writePlainList(file, [])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, entries: [] })
    expect(folderNames()).toEqual(['list.json'])
  })

  it('replaces a malformed file', async () => {
    writeFileSync(path, 'garbage')
    await writePlainList(file, [{ url: 'http://a.test/' }])
    expect(await readPlainList(file)).toEqual([{ url: 'http://a.test/' }])
  })

  it('logs, resolves and removes its temp file when the rename fails', async () => {
    // A non-empty folder at the name: the rename onto it fails on every platform.
    mkdirSync(path)
    writeFileSync(join(path, 'keep.txt'), 'keep')
    await expect(writePlainList(file, [{ url: 'http://a.test/' }])).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'Test list: file not written, kept in memory',
      expect.objectContaining({ error: expect.any(String) })
    )
    expect(folderNames()).toEqual(['list.json'])
    expect(readFileSync(join(path, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('resolves, logs and writes nothing when an entry fails its schema (it never rejects)', async () => {
    await expect(writePlainList(file, [{ url: '' }])).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Test list: file not written, kept in memory', expect.objectContaining({ error: expect.any(String) }))
    expect(folderNames()).toEqual([])
  })

  it('logs and resolves when the folder is missing', async () => {
    rmSync(join(root, 'profile'), { recursive: true })
    await expect(writePlainList(file, [{ url: 'http://a.test/' }])).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'Test list: file not written, kept in memory',
      expect.objectContaining({ error: expect.any(String) })
    )
    expect(existsSync(join(root, 'profile'))).toBe(false)
  })

  itPosix('replaces a link planted at the name instead of writing through it', async () => {
    const outside = join(root, 'outside.json')
    writeFileSync(outside, 'ORIGINAL')
    symlinkSync(outside, path)
    await writePlainList(file, [{ url: 'http://a.test/' }])
    expect(readFileSync(outside, 'utf8')).toBe('ORIGINAL')
    expect(await readPlainList(file)).toEqual([{ url: 'http://a.test/' }])
  })
})
