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
  lookupOnPath,
  untrustedReason,
  classifiedUntrustedFolders,
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
    ['empty entry', ':/usr/bin', '/cwd/soffice'],
    ['"." entry', '.:/usr/bin', '/cwd/soffice'],
    ['relative entry', 'bin:/usr/bin', '/cwd/bin/soffice']
  ])('marks a hit from an %s as relative', (_name, pathValue, planted) => {
    const [first] = findOnPathEntries('soffice', env('linux', pathValue, [planted, '/usr/bin/soffice']))
    expect(first).toEqual({ path: planted, fromRelativeEntry: true })
  })

  it('tries PATHEXT on Windows, including quoted entries', () => {
    const hits = findOnPathEntries(
      'soffice',
      env('win32', '"C:\\Tools";C:\\IM', ['C:\\Tools\\soffice.exe', 'C:\\IM\\soffice.EXE'], { pathext: '.COM;.EXE' })
    )
    expect(hits[0]).toEqual({ path: 'C:\\Tools\\soffice.exe', fromRelativeEntry: false })
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

describe('findOnPathEntries – Rust style (#250)', () => {
  const base = { platform: 'win32' as const, pathext: '.COM;.EXE;.BAT;.CMD', cwd: 'C:\\cwd' }

  it('tries <name>.exe only, and searches the prefix folders before PATH', () => {
    const files = new Set(['C:\\Repo\\which.bat', 'C:\\App\\which.exe'])
    const env = { ...base, pathValue: 'C:\\Repo', rustPrefixDirs: ['C:\\App'], isExecutableFile: (p: string) => files.has(p) }
    expect(findOnPathEntries('which', env, 'rust').map((h) => h.path)).toEqual(['C:\\App\\which.exe'])
    expect(findOnPathEntries('which', env, 'pathext')[0].path).toBe('C:\\Repo\\which.bat')
  })

  it('is the plain walk on POSIX', () => {
    const env = { platform: 'linux' as const, pathValue: '/usr/bin', cwd: '/', isExecutableFile: (p: string) => p === '/usr/bin/which' }
    expect(findOnPathEntries('which', env, 'rust')).toEqual([{ path: '/usr/bin/which', fromRelativeEntry: false }])
  })
})

describe('findOnPathEntries – UNC entries (#250)', () => {
  it('skips a UNC entry before any file-system call', () => {
    const touched: string[] = []
    const env = {
      platform: 'win32' as const,
      pathValue: '\\\\host\\share;//host/share;C:\\Tools',
      pathext: '.EXE',
      cwd: 'C:\\cwd',
      isExecutableFile: (p: string) => {
        touched.push(p)
        return false
      }
    }
    findOnPathEntries('soffice', env)
    expect(touched).toEqual(['C:\\Tools\\soffice.exe'])
  })

  it('reports the first UNC entry met before the first local hit, or anywhere when there is none', () => {
    const base = { platform: 'win32' as const, pathext: '.EXE', cwd: 'C:\\cwd' }
    const has = (p: string): boolean => p === 'C:\\LO\\soffice.exe'
    expect(lookupOnPath('soffice', { ...base, pathValue: '\\\\srv\\share;C:\\LO', isExecutableFile: has }).uncEntry).toBe('\\\\srv\\share')
    expect(lookupOnPath('soffice', { ...base, pathValue: 'C:\\Tools;\\\\srv\\share', isExecutableFile: () => false }).uncEntry).toBe('\\\\srv\\share')
    expect(lookupOnPath('soffice', { ...base, pathValue: 'C:\\LO;\\\\srv\\share', isExecutableFile: has }).uncEntry).toBeNull()
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
    expect(isUncPath('\\\\host\\share\\soffice.exe')).toBe(true)
    expect(isUncPath('//host/share/soffice')).toBe(true)
    expect(isTrustedHit(hit('\\\\host\\share\\soffice.exe'), [], 'win32', (p) => p)).toBe(false)
  })

  it('fails closed when the real path cannot be resolved or throws', () => {
    expect(isTrustedHit(hit('/usr/bin/soffice'), [], 'linux', () => null)).toBe(false)
    expect(
      isTrustedHit(hit('/usr/bin/soffice'), [], 'linux', () => {
        throw new Error('ELOOP')
      })
    ).toBe(false)
  })

  it('is case-insensitive on Windows and macOS, case-sensitive on Linux', () => {
    expect(isTrustedHit(hit('C:\\Work\\Repo\\soffice.exe'), ['c:\\work\\repo'], 'win32', (p) => p)).toBe(false)
    expect(isTrustedHit(hit('/Users/me/Repo/soffice'), ['/users/me/repo'], 'darwin', (p) => p)).toBe(false)
    expect(isTrustedHit(hit('/home/me/Repo/soffice'), ['/home/me/repo'], 'linux', (p) => p)).toBe(true)
  })
})

describe('untrustedReason', () => {
  const hit = (path: string, fromRelativeEntry = false) => ({ path, fromRelativeEntry })

  it('names why a hit is refused', () => {
    const folders = classifiedUntrustedFolders(['/work/repo'], 'linux')
    expect(untrustedReason(hit('/usr/bin/soffice'), folders, 'linux', (p) => p)).toBeNull()
    expect(untrustedReason(hit('/work/repo/soffice'), folders, 'linux', (p) => p)).toBe('project')
    expect(untrustedReason(hit('/var/tmp/soffice'), folders, 'linux', (p) => p)).toBe('temp')
    expect(untrustedReason(hit('/cwd/soffice', true), folders, 'linux', (p) => p)).toBe('relative')
    expect(untrustedReason(hit('/usr/bin/soffice'), folders, 'linux', () => null)).toBe('unresolvable')
    expect(untrustedReason(hit('C:\\x\\soffice.exe'), [], 'win32', () => '\\\\host\\share\\soffice.exe')).toBe('network')
  })
})

describe('untrustedFolders', () => {
  it('always includes the temp folder and drops empty roots', () => {
    const folders = untrustedFolders([null, undefined, '/work/repo'])
    expect(folders).toContain(tmpdir())
    expect(folders).toContain('/work/repo')
  })

  it('includes the shared temp folders', () => {
    expect(untrustedFolders([], 'linux')).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/var/tmp']))
    expect(untrustedFolders([], 'darwin')).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/var/tmp']))
    expect(untrustedFolders([], 'win32').some((f) => /\\Temp$/i.test(f))).toBe(true)
  })

  it('a hit in /var/tmp is untrusted', () => {
    expect(isTrustedHit({ path: '/var/tmp/soffice', fromRelativeEntry: false }, untrustedFolders([], 'linux'), 'linux', (p) => p)).toBe(false)
  })
})
