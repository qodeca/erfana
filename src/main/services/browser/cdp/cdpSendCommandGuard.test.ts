// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 025-NFR-001 bullet 2 and solution design § 5: the DevTools-protocol methods
 * Erfana sends come from a fixed allow-list in code. That holds only if no
 * code path reaches `webContents.debugger.sendCommand` except through
 * `BrowserCdpSession.send`. This test reads every main-process source file
 * and fails on any other caller.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CDP_DIR = path.dirname(fileURLToPath(import.meta.url))
const MAIN_DIR = path.resolve(CDP_DIR, '../../..')
const TEST_SUPPORT = new Set(['__tests__', '__test__', '__test-helpers__', '__test-utils__', 'test-utils', '__fixtures__'])

/** Production source files under `dir` (tests and test support left out). */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!TEST_SUPPORT.has(entry.name)) out.push(...sources(full))
    } else if (entry.isFile() && /\.(m?[jt]sx?)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const rel = (file: string): string => path.relative(MAIN_DIR, file).split(path.sep).join('/')

describe('CDP sendCommand guard (025-NFR-001, S23)', () => {
  it('finds the main-process sources it guards', () => {
    const files = sources(MAIN_DIR).map(rel)
    expect(files).toContain('services/browser/cdp/BrowserCdpSession.ts')
    expect(files.length).toBeGreaterThan(100)
  })

  it('no main-process source outside cdp/ mentions sendCommand', () => {
    const offenders = sources(MAIN_DIR)
      .filter(f => !f.startsWith(CDP_DIR + path.sep))
      .filter(f => readFileSync(f, 'utf8').includes('sendCommand'))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('inside cdp/, only BrowserCdpSession calls sendCommand, once (cdpTypes declares it)', () => {
    const calls = sources(CDP_DIR).flatMap(f => {
      const count = readFileSync(f, 'utf8').match(/\bsendCommand\s*\(/g)?.length ?? 0
      return count > 0 ? [[rel(f), count]] : []
    })
    expect(calls).toEqual([
      ['services/browser/cdp/BrowserCdpSession.ts', 1],
      ['services/browser/cdp/cdpTypes.ts', 1]
    ])
  })

  it('no main-process source reaches the debugger object directly outside cdp/', () => {
    const offenders = sources(MAIN_DIR)
      .filter(f => !f.startsWith(CDP_DIR + path.sep))
      .filter(f => /\.debugger\b|\[\s*['"`]debugger['"`]\s*\]/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })
})
