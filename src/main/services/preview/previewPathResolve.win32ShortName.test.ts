// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows 8.3 short-name handling, against the REAL filesystem.
 *
 * `previewPathResolve` carries two layers against the short-name bypass: layer 1
 * refuses a `~[0-9]` URL segment (`isSafeSegment`), and step 8h re-resolves the
 * full candidate so a short spelling that slipped past the parent-only check is
 * still measured against the root. Both are win32-only, and until this file
 * nothing exercised them on a Windows host: the shared nav harness pins
 * `platform: 'darwin'`, and the platform-override tests pass a fake `platform`
 * argument rather than meeting a real 8.3 alias.
 *
 * These cases need a genuine OS-generated short name, so they cannot be faked on
 * macOS or Linux and are skipped there. `os.tmpdir()` supplies one for free on a
 * default Windows profile: it comes back as `C:\Users\<SHORT~1>\AppData\Local\Temp`,
 * and `fs.realpathSync` keeps that spelling while `fs.realpathSync.native` and
 * `fsPromises.realpath` expand it. That difference is the whole hazard, and it is
 * what broke six #124 suites on the first Windows CI run (PR #128).
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confinePath, isSafeSegment } from './previewPathResolve'

const onWin32 = process.platform === 'win32'

/**
 * A project root in both spellings, plus a file just outside it.
 *
 * `long` is the canonical form the production resolver works in
 * (`PreviewRootRegistry` resolves the root with `fsPromises.realpath`); `short`
 * is the same directory as the OS hands it out of `os.tmpdir()`.
 */
function makeProject(): { long: string; short: string; cleanup: () => void } {
  const shortBase = mkdtempSync(join(tmpdir(), 'erfana-w12-'))
  const short = realpathSync(shortBase)
  const long = realpathSync.native(shortBase)
  writeFileSync(join(long, 'page.html'), '<p>in</p>')
  writeFileSync(join(long, 'outside.html'), '<p>out</p>')
  return { long, short, cleanup: () => rmSync(shortBase, { recursive: true, force: true }) }
}

describe.skipIf(!onWin32)('previewPathResolve – real Windows 8.3 short names', () => {
  it('has a short tmpdir to test against, and the two realpath forms disagree', () => {
    const p = makeProject()
    try {
      // Guards the rest of the file: if a host ever hands out a long tmpdir, the
      // cases below would pass vacuously instead of exercising anything.
      expect(p.short).not.toBe(p.long)
      expect(p.short).toMatch(/~\d/)
    } finally {
      p.cleanup()
    }
  })

  it('accepts an in-root page named by the short spelling of the root (step 8h re-resolves)', async () => {
    const p = makeProject()
    try {
      const verdict = await confinePath(p.long, join(p.short, 'page.html'))
      expect(verdict).toMatchObject({ ok: true, rel: 'page.html' })
    } finally {
      p.cleanup()
    }
  })

  it('accepts the same page named by the long spelling', async () => {
    const p = makeProject()
    try {
      await expect(confinePath(p.long, join(p.long, 'page.html'))).resolves.toMatchObject({
        ok: true,
        rel: 'page.html'
      })
    } finally {
      p.cleanup()
    }
  })

  it('refuses a file outside the root reached through the short spelling', async () => {
    const p = makeProject()
    try {
      // `<root>/sub` does not exist; the candidate climbs back out of the root
      // through the SHORT parent. Without the 8h re-resolve this is the bypass.
      const outside = join(p.short, 'sub', '..', '..', 'erfana-w12-escape.html')
      const verdict = await confinePath(p.long, outside)
      expect(verdict.ok).toBe(false)
    } finally {
      p.cleanup()
    }
  })

  it('refuses a `~1` page name as a URL segment, and allows it off win32', () => {
    // Layer 1. The platform argument is threaded through precisely so both
    // branches stay testable from one host.
    expect(isSafeSegment('page~1.html', 'win32')).toBe(false)
    expect(isSafeSegment('PROGRA~1', 'win32')).toBe(false)
    expect(isSafeSegment('page~1.html', 'darwin')).toBe(true)
    // A tilde that is not a short-name alias stays legal on both.
    expect(isSafeSegment('draft~final.html', 'win32')).toBe(true)
  })
})
