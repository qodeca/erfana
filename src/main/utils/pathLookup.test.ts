// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathLookup (#250): in-process PATH walk and the trust check for tool hits.
 */
import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findOnPathEntries,
  isTrustedHit,
  isUncPath,
  untrustedFolders,
  MAX_PATH_HITS,
  type PathLookupEnv
} from './pathLookup'

function env(platform: NodeJS.Platform, pathValue: string, files: string[], extra: Partial<PathLookupEnv> = {}): PathLookupEnv {
  const set = new Set(files)
  return { platform, pathValue, cwd: platform === 'win32' ? 'C:\\cwd' : '/cwd', isExecutableFile: (p) => set.has(p), ...extra }
}

describe('findOnPathEntries', () => {
  it('walks POSIX PATH in order', () => {
    const hits = findOnPathEntries('soffice', env('linux', '/a:/b', ['/b/soffice', '/a/soffice']))
    expect(hits.map((h) => h.path)).toEqual(['/a/soffice', '/b/soffice'])
    expect(hits.every((h) => !h.fromRelativeEntry)).toBe(true)
  })

  it.each([
    ['empty entry', ':/usr/bin', '/cwd/magick'],
    ['"." entry', '.:/usr/bin', '/cwd/magick'],
    ['relative entry', 'bin:/usr/bin', '/cwd/bin/magick']
  ])('marks a hit from an %s as relative', (_name, pathValue, planted) => {
    const [first] = findOnPathEntries('magick', env('linux', pathValue, [planted, '/usr/bin/magick']))
    expect(first).toEqual({ path: planted, fromRelativeEntry: true })
  })

  it('tries PATHEXT on Windows, including quoted entries', () => {
    const hits = findOnPathEntries(
      'magick',
      env('win32', '"C:\\Tools";C:\\IM', ['C:\\Tools\\magick.exe', 'C:\\IM\\magick.EXE'], { pathext: '.COM;.EXE' })
    )
    expect(hits[0]).toEqual({ path: 'C:\\Tools\\magick.exe', fromRelativeEntry: false })
  })

  it('caps the hits', () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `/d${i}`)
    const hits = findOnPathEntries('soffice', env('linux', dirs.join(':'), dirs.map((d) => `${d}/soffice`)))
    expect(hits).toHaveLength(MAX_PATH_HITS)
  })

  it('returns nothing when the tool is absent', () => {
    expect(findOnPathEntries('soffice', env('linux', '/a:/b', []))).toEqual([])
  })
})

describe('isTrustedHit', () => {
  const hit = (path: string, fromRelativeEntry = false) => ({ path, fromRelativeEntry })

  it('trusts an ordinary absolute hit', () => {
    expect(isTrustedHit(hit('/usr/bin/soffice'), ['/work/repo'], 'linux', (p) => p)).toBe(true)
  })

  it('never trusts a relative-entry hit', () => {
    expect(isTrustedHit(hit('/cwd/soffice', true), [], 'linux', (p) => p)).toBe(false)
  })

  it('rejects a hit inside an untrusted folder, by path or by real path', () => {
    expect(isTrustedHit(hit('/work/repo/bin/soffice'), ['/work/repo'], 'linux', (p) => p)).toBe(false)
    expect(isTrustedHit(hit('/usr/local/bin/soffice'), ['/work/repo'], 'linux', () => '/work/repo/x/soffice')).toBe(false)
  })

  it('rejects an absolute /tmp hit – what "." means for a lookup run from the temp folder', () => {
    const folders = untrustedFolders([])
    expect(isTrustedHit(hit(join(tmpdir(), 'soffice')), folders, process.platform)).toBe(false)
  })

  it('rejects UNC hits in both spellings', () => {
    expect(isUncPath('\\\\host\\share\\magick.exe')).toBe(true)
    expect(isUncPath('//host/share/magick')).toBe(true)
    expect(isTrustedHit(hit('\\\\host\\share\\magick.exe'), [], 'win32', (p) => p)).toBe(false)
  })

  it('is case-insensitive on Windows and macOS, case-sensitive on Linux', () => {
    expect(isTrustedHit(hit('C:\\Work\\Repo\\soffice.exe'), ['c:\\work\\repo'], 'win32', (p) => p)).toBe(false)
    expect(isTrustedHit(hit('/Users/me/Repo/soffice'), ['/users/me/repo'], 'darwin', (p) => p)).toBe(false)
    expect(isTrustedHit(hit('/home/me/Repo/soffice'), ['/home/me/repo'], 'linux', (p) => p)).toBe(true)
  })
})

describe('untrustedFolders', () => {
  it('always includes the temp folder and drops empty roots', () => {
    const folders = untrustedFolders([null, undefined, '/work/repo'])
    expect(folders).toContain(tmpdir())
    expect(folders).toContain('/work/repo')
  })
})
