// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-path confinement of a served local folder (spec 025, 025-FR-005
 * rule 1; ADR 0012 decision 8) with Windows path rules, on every platform.
 *
 * The real-folder tests (`localConfinedFile.test.ts`) skip their link cases on
 * Windows, so the required unit lane never sees `openConfinedFile` compare
 * Windows paths (test review round 2). Here `node:path` is `path.win32` and
 * the file system is a small fake whose `realpath` answers as NTFS would after
 * following a junction, so the module's own compare runs on drive letters,
 * backslashes and case variants: a target on another drive, a case-variant or
 * U+212A KELVIN SIGN sibling of the folder, and a refused segment reached
 * through a junction are each refused; a file inside is served.
 *
 * What this cannot show is NTFS itself (junction creation, 8.3 short names):
 * the fake's `realpath` stands in for it. Split from
 * `localConfinedFile.test.ts` because the module mocks hoist.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual.win32, default: actual.win32 }
})

/** The fake volume: each requested path's real path (a junction resolves elsewhere) and whether it is a file. */
const volume = vi.hoisted(() => new Map<string, { readonly real: string; readonly file: boolean }>())

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const entry = (path: string): { readonly real: string; readonly file: boolean } => {
    const found = volume.get(path)
    if (found === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return found
  }
  // One inode per real path, so the name and the opened handle agree.
  const ids = (real: string): { dev: bigint; ino: bigint } => ({ dev: 1n, ino: BigInt([...real].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7)) })
  const statOf = (path: string) => {
    const { real, file } = entry(path)
    return { ...ids(real), size: 3n, isFile: () => file }
  }
  return {
    ...actual,
    realpath: async (path: string) => entry(path).real,
    stat: async (path: string) => statOf(path),
    lstat: async (path: string) => statOf(path),
    open: async (path: string) => {
      const stats = statOf(path)
      return { stat: async () => stats, close: vi.fn(async () => undefined) }
    }
  }
})

import { openConfinedFile } from './localConfinedFile'

const ROOT = 'C:\\work\\projk'
const never = (): boolean => false

/** A folder, a file or a junction-reached file on the fake volume. */
function put(path: string, real: string = path, file = true): void {
  volume.set(path, { real, file })
}

put(ROOT, ROOT, false)
put('C:\\work\\projk\\pages', 'C:\\work\\projk\\pages', false)
put('C:\\work\\projk\\index.html')
put('C:\\work\\projk\\pages\\a.html')
// Junctions inside the folder, and where NTFS resolves them.
put('C:\\work\\projk\\to-d.html', 'D:\\work\\projk\\index.html')
put('C:\\work\\projk\\to-case.html', 'C:\\work\\PROJK2\\index.html')
put('C:\\work\\projk\\to-kelvin.html', 'C:\\work\\proj\u212A\\index.html')
put('C:\\work\\projk\\to-git.html', 'C:\\work\\projk\\.git\\config')
put('C:\\work\\projk\\to-asar.html', 'C:\\work\\projk\\app.ASAR\\index.html')
// A junction folder that leads to another drive: the parent check refuses it.
put('C:\\work\\projk\\d-dir', 'D:\\elsewhere', false)
put('C:\\work\\projk\\d-dir\\x.html', 'D:\\elsewhere\\x.html')

describe('openConfinedFile with Windows paths (025-FR-005 rule 1)', () => {
  it('serves a file inside the folder, with its real path', async () => {
    const result = await openConfinedFile(ROOT, ['pages', 'a.html'], never)
    expect(result).toMatchObject({ ok: true, realPath: 'C:\\work\\projk\\pages\\a.html', ext: '.html' })
  })

  it.each([
    ['another drive', 'to-d.html'],
    ['a case-variant sibling folder', 'to-case.html'],
    ['a U+212A KELVIN SIGN sibling, which a case fold would call the folder itself', 'to-kelvin.html'],
    ['a dot-prefixed segment', 'to-git.html'],
    ['an .asar segment, in any case', 'to-asar.html']
  ])('refuses a junction that resolves to %s (403)', async (_what, name) => {
    expect(await openConfinedFile(ROOT, [name], never)).toEqual({ ok: false, status: 403 })
  })

  it('refuses a file under a junction folder on another drive at the parent check (403)', async () => {
    expect(await openConfinedFile(ROOT, ['d-dir', 'x.html'], never)).toEqual({ ok: false, status: 403 })
  })

  it('compares the folder exactly: the same folder named with a lower-case drive letter is not the folder', async () => {
    // `realRoot` must be a realpath result, which keeps NTFS's own case; a differently cased root never matches.
    put('c:\\work\\projk\\index.html', 'C:\\work\\projk\\index.html')
    put('c:\\work\\projk', 'C:\\work\\projk', false)
    expect(await openConfinedFile('c:\\work\\projk', ['index.html'], never)).toEqual({ ok: false, status: 403 })
  })
})
