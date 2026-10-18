// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeCrashFallbackLine } from './crashFallbackLog'

describe('writeCrashFallbackLine', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-crash-fallback-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends one tagged line per call, synchronously', () => {
    expect(writeCrashFallbackLine('[crash] one', new Error('boom'), dir)).toBe(true)
    expect(writeCrashFallbackLine('[crash] two', 'plain text', dir)).toBe(true)

    const lines = readFileSync(join(dir, 'crash.log'), 'utf-8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[crash\] one Error: boom$/)
    expect(lines[1]).toContain('[crash] two plain text')
  })

  it('keeps a multi-line error on a single bounded line', () => {
    writeCrashFallbackLine('[crash] x', new Error(`a\nb\r\n${'z'.repeat(5_000)}`), dir)
    const text = readFileSync(join(dir, 'crash.log'), 'utf-8')
    expect(text.trimEnd().split('\n')).toHaveLength(1)
    expect(text).toContain('[truncated]')
    expect(text.length).toBeLessThan(2_300)
  })

  it('never throws when the directory cannot be written', () => {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'a file where a directory is needed')
    expect(writeCrashFallbackLine('[crash] x', new Error('boom'), join(blocker, 'logs'))).toBe(false)
  })
})
