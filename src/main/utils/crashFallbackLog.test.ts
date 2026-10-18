// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  writeCrashFallbackLine,
  CRASH_FALLBACK_MAX_BYTES,
  CRASH_FALLBACK_TAG_INTERVAL_MS
} from './crashFallbackLog'

describe('writeCrashFallbackLine', () => {
  let dir: string

  beforeEach(() => {
    // a fresh directory per test also gives fresh per-tag rate-limit state
    dir = mkdtempSync(join(tmpdir(), 'erfana-crash-fallback-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  const read = (): string => readFileSync(join(dir, 'crash.log'), 'utf-8')

  it('appends one tagged line per tag, synchronously', () => {
    expect(writeCrashFallbackLine('[crash] one', new Error('boom'), dir)).toBe(true)
    expect(writeCrashFallbackLine('[crash] two', 'plain text', dir)).toBe(true)

    const lines = read().trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[crash\] one Error: boom$/)
    expect(lines[1]).toContain('[crash] two plain text')
  })

  it('keeps a multi-line error on a single bounded line', () => {
    writeCrashFallbackLine('[crash] x', new Error(`a\nb\r\n${'z'.repeat(5_000)}`), dir)
    const text = read()
    expect(text.trimEnd().split('\n')).toHaveLength(1)
    expect(text).toContain('[truncated]')
    expect(text.length).toBeLessThan(2_300)
  })

  it('never throws when the directory cannot be written', () => {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'a file where a directory is needed')
    expect(writeCrashFallbackLine('[crash] x', new Error('boom'), join(blocker, 'logs'))).toBe(false)
  })

  describe('redaction', () => {
    it('removes quoted errno paths', () => {
      const error = Object.assign(
        new Error("EACCES: permission denied, open '/Users/alice/.erfana/settings.json'"),
        { code: 'EACCES', syscall: 'open' }
      )
      writeCrashFallbackLine('[crash] r', error, dir)
      expect(read()).not.toContain('alice')
      expect(read()).toContain('[redacted-path]')
    })

    it('removes unquoted absolute paths, POSIX and Windows', () => {
      writeCrashFallbackLine(
        '[crash] a',
        new Error('Failed to create settings directory at /Users/alice/.erfana: EACCES'),
        dir
      )
      writeCrashFallbackLine(
        '[crash] b',
        new Error('cannot read C:\\Users\\bob\\Documents\\settings.json now'),
        dir
      )
      const text = read()
      expect(text).not.toContain('alice')
      expect(text).not.toContain('bob')
      expect(text).toContain('[redacted]/.erfana')
      expect(text).toContain('[redacted]/settings.json')
    })

    it('keeps ordinary prose and short paths', () => {
      writeCrashFallbackLine('[crash] p', new Error('either and/or /tmp failed'), dir)
      expect(read()).toContain('either and/or /tmp failed')
    })
  })

  describe('per-tag rate limit', () => {
    it('writes one line per tag per interval and reports the skipped count after', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

      for (let i = 0; i < 50; i++) {
        expect(writeCrashFallbackLine('[crash] loop', new Error('again'), dir)).toBe(true)
      }
      expect(read().trimEnd().split('\n')).toHaveLength(1)

      vi.advanceTimersByTime(CRASH_FALLBACK_TAG_INTERVAL_MS)
      writeCrashFallbackLine('[crash] loop', new Error('again'), dir)

      const lines = read().trimEnd().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain('(+49 skipped)')
    })

    it('does not let one tag silence another', () => {
      writeCrashFallbackLine('[crash] a', new Error('x'), dir)
      writeCrashFallbackLine('[crash] b', new Error('y'), dir)
      expect(read().trimEnd().split('\n')).toHaveLength(2)
    })
  })

  describe('size cap', () => {
    it('moves a full crash.log aside and starts a fresh one', () => {
      writeFileSync(join(dir, 'crash.log'), 'x'.repeat(CRASH_FALLBACK_MAX_BYTES))

      writeCrashFallbackLine('[crash] big', new Error('after the cap'), dir)

      expect(readFileSync(join(dir, 'crash.1.log'), 'utf-8')).toHaveLength(CRASH_FALLBACK_MAX_BYTES)
      expect(read()).toContain('after the cap')
      expect(read().length).toBeLessThan(1_000)
    })

    it('does not rotate a file under the cap', () => {
      writeFileSync(join(dir, 'crash.log'), 'small\n')
      writeCrashFallbackLine('[crash] small', new Error('e'), dir)
      expect(existsSync(join(dir, 'crash.1.log'))).toBe(false)
    })
  })
})
