// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `writeTextChecked` (#478 plan step S3; L1, N1, N3, N4): the autosave check
 * runs before the rename, before each rename retry and before an in-place
 * write, and the `written` stamp matches the next probe on every write route.
 *
 * Real temp files; only `rename` is wrapped, so a test can make it fail (and
 * land an "outside" write at that moment) – the retry and fallback routes
 * cannot be reached on demand otherwise.
 */
import { linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RenameFn = (from: string, to: string) => Promise<void>

const renameHook = vi.hoisted(() => ({ next: [] as ((real: RenameFn, from: string, to: string) => Promise<void>)[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn((from: string, to: string) => {
      const hook = renameHook.next.shift()
      return hook ? hook(actual.rename, from, to) : actual.rename(from, to)
    }),
  }
})
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { FileStamp } from '../../../shared/freshness/freshnessTypes'
import { isSameStat } from '../../../shared/freshness/stamp'
import { FileStamper, sha256Hex } from './fileStamp'
import { readText } from './textRead'
import { writeTextChecked } from './textWrite'

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

/** A rename that lands an outside write on the target, then fails with `code`. */
function outsideWriteThenFail(target: string, outside: string, code: string) {
  return async (): Promise<void> => {
    writeFileSync(target, outside)
    throw errno(code)
  }
}

describe('writeTextChecked', () => {
  let dir: string
  let file: string
  let stamper: FileStamper

  async function stampOf(path: string): Promise<FileStamp> {
    const reply = await readText(path, { stamper })
    if (reply.status !== 'ok') throw new Error(`setup: read ${reply.status}`)
    return reply.stamp
  }

  async function expectNextProbeSame(path: string, written: FileStamp): Promise<void> {
    const probe = await new FileStamper().stamp(path)
    if (probe.status !== 'ok') throw new Error(`probe ${probe.status}`)
    expect(isSameStat(probe.stamp, written), 'stat of the final path').toBe(true)
    expect(probe.stamp.hash).toBe(written.hash)
  }

  const tempFilesLeft = (): string[] => readdirSync(dir).filter((name) => name.startsWith('.erfana-tmp-'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-textwrite-'))
    file = join(dir, 'a.md')
    writeFileSync(file, 'disk version 1')
    stamper = new FileStamper()
    renameHook.next = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('L1: an outside write is never overwritten by autosave', () => {
    it('detects a write that landed before the check', async () => {
      const expected = await stampOf(file)
      writeFileSync(file, 'outside write, longer')

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('changed-on-disk')
      // A size mismatch decides without a hash
      expect(reply.stamp?.size).toBe('outside write, longer'.length)
      expect(readFileSync(file, 'utf8')).toBe('outside write, longer')
      expect(tempFilesLeft()).toEqual([])
    })

    it('detects a write that landed during a rename retry (N3)', async () => {
      const expected = await stampOf(file)
      renameHook.next.push(outsideWriteThenFail(file, 'outside during retry', 'EPERM'))

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('changed-on-disk')
      expect(readFileSync(file, 'utf8')).toBe('outside during retry')
      expect(tempFilesLeft()).toEqual([])
    })

    it('detects a write that landed before the in-place fallback (N3)', async () => {
      const expected = await stampOf(file)
      renameHook.next.push(outsideWriteThenFail(file, 'outside before fallback', 'EXDEV'))

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('changed-on-disk')
      expect(readFileSync(file, 'utf8')).toBe('outside before fallback')
      expect(tempFilesLeft()).toEqual([])
    })

    it('detects a write before the in-place write of a hard-linked target', async () => {
      linkSync(file, join(dir, 'other-name.md'))
      const expected = await stampOf(file)
      writeFileSync(file, 'outside write via link')

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('changed-on-disk')
      expect(readFileSync(file, 'utf8')).toBe('outside write via link')
    })

    it('a file deleted before the check is not recreated', async () => {
      const expected = await stampOf(file)
      rmSync(file)

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply).toEqual({ status: 'changed-on-disk', stamp: null })
      expect(readdirSync(dir)).toEqual([])
    })
  })

  describe('N3: stat first, hash only on a mismatch', () => {
    it('accepts an unchanged file without hashing it', async () => {
      const expected = await stampOf(file)
      const hash = vi.spyOn(stamper, 'stamp')

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('written')
      expect(hash).not.toHaveBeenCalled()
      expect(readFileSync(file, 'utf8')).toBe('my buffer')
    })

    it('accepts a touch-only change (same bytes, new mtime) after hashing it', async () => {
      const expected = await stampOf(file)
      utimesSync(file, 1_800_000_000, 1_800_000_000)
      const hash = vi.spyOn(stamper, 'stamp')

      const reply = await writeTextChecked(file, 'my buffer', { expectedStamp: expected, stamper })

      expect(reply.status).toBe('written')
      expect(hash).toHaveBeenCalledTimes(1)
    })
  })

  describe('N1/N4: the written stamp matches the next probe on every route', () => {
    it('normal rename', async () => {
      const reply = await writeTextChecked(file, 'saved', { expectedStamp: await stampOf(file), stamper })
      if (reply.status !== 'written') throw new Error(reply.status)
      await expectNextProbeSame(file, reply.stamp)
    })

    it('hard-linked target (written in place)', async () => {
      linkSync(file, join(dir, 'other-name.md'))
      const reply = await writeTextChecked(file, 'saved via link', { expectedStamp: await stampOf(file), stamper })
      if (reply.status !== 'written') throw new Error(reply.status)
      await expectNextProbeSame(file, reply.stamp)
      expect(readFileSync(join(dir, 'other-name.md'), 'utf8')).toBe('saved via link')
    })

    it('symlink target (written in place)', async (ctx) => {
      const link = join(dir, 'link.md')
      try {
        symlinkSync(file, link)
      } catch (error) {
        // Windows without Developer Mode or the symlink privilege
        if ((error as NodeJS.ErrnoException).code === 'EPERM') ctx.skip()
        throw error
      }
      const reply = await writeTextChecked(link, 'saved via symlink', { expectedStamp: await stampOf(link), stamper })
      if (reply.status !== 'written') throw new Error(reply.status)
      await expectNextProbeSame(link, reply.stamp)
      expect(readFileSync(file, 'utf8')).toBe('saved via symlink')
    })

    it('a rename that fails over to the in-place write', async () => {
      renameHook.next.push(async () => {
        throw errno('EXDEV')
      })
      const reply = await writeTextChecked(file, 'saved in place', { expectedStamp: await stampOf(file), stamper })
      if (reply.status !== 'written') throw new Error(reply.status)
      await expectNextProbeSame(file, reply.stamp)
      expect(tempFilesLeft()).toEqual([])
    })

    it('the hash is SHA-256 of the exact bytes written, BOM and CRLF kept', async () => {
      const content = '﻿# Title\r\nline\r\n'
      const reply = await writeTextChecked(file, content, { stamper })
      if (reply.status !== 'written') throw new Error(reply.status)
      const onDisk = readFileSync(file)
      expect(onDisk.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
      expect(reply.stamp.hash).toBe(sha256Hex(onDisk))
      expect(reply.stamp.hash).toBe(sha256Hex(Buffer.from(content, 'utf8')))
    })
  })

  describe('F7: without an expected stamp the write is unconditional', () => {
    it('overwrites a file changed on disk (explicit save, Save-to-restore, save in conflict)', async () => {
      writeFileSync(file, 'outside write')
      const reply = await writeTextChecked(file, 'explicit save', { stamper })
      expect(reply.status).toBe('written')
      expect(readFileSync(file, 'utf8')).toBe('explicit save')
    })

    it('creates a missing file', async () => {
      const fresh = join(dir, 'new.md')
      const reply = await writeTextChecked(fresh, 'restored', { stamper })
      expect(reply.status).toBe('written')
      expect(readFileSync(fresh, 'utf8')).toBe('restored')
    })
  })
})
