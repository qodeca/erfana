// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * conversionToolGuard (#250): replay LiteParse's LibreOffice lookup and judge
 * the binary it would run.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { delimiter, join } from 'path'
import { tmpdir } from 'os'
import { findUntrustedConversionTool, resolveLibreOffice } from './conversionToolGuard'
import type { PathLookupEnv } from '../../utils/pathLookup'

const id = (p: string): string => p

function posixEnv(pathValue: string, files: string[], platform: NodeJS.Platform = 'linux'): PathLookupEnv {
  const set = new Set(files)
  return { platform, pathValue, cwd: '/cwd', isExecutableFile: (p) => set.has(p) }
}

function winEnv(pathValue: string, files: string[], pathext = '.COM;.EXE;.BAT;.CMD'): PathLookupEnv {
  const set = new Set(files.map((f) => f.toLowerCase()))
  return {
    platform: 'win32',
    pathValue,
    pathext,
    cwd: 'C:\\cwd',
    rustPrefixDirs: ['C:\\Program Files\\Erfana', 'C:\\Windows\\System32', 'C:\\Windows'],
    isExecutableFile: (p) => set.has(p.toLowerCase())
  }
}

const ROOTS = ['/work/repo']

describe('resolveLibreOffice – POSIX', () => {
  it('uses the first name `which` finds, in LiteParse order', () => {
    const env = posixEnv('/usr/bin', ['/usr/bin/which', '/usr/bin/libreoffice', '/usr/bin/soffice'])
    expect(resolveLibreOffice(ROOTS, { env, realpath: id })).toEqual({ state: 'found', path: '/usr/bin/libreoffice' })
  })

  it('is unsafe when that first hit is in the project – a later trusted name does not rescue it', () => {
    const env = posixEnv('/work/repo/bin:/usr/bin', ['/usr/bin/which', '/work/repo/bin/libreoffice', '/usr/bin/soffice'])
    expect(resolveLibreOffice(ROOTS, { env, realpath: id })).toEqual({
      state: 'unsafe',
      name: 'libreoffice',
      path: '/work/repo/bin/libreoffice',
      reason: 'project'
    })
  })

  it('is unsafe for a hit from a "." or empty PATH entry', () => {
    for (const pathValue of ['.:/usr/bin', ':/usr/bin']) {
      const env = posixEnv(pathValue, ['/usr/bin/which', '/cwd/soffice'])
      expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', reason: 'relative' })
    }
  })

  it('is unsafe for a hit in a shared temp folder', () => {
    const env = posixEnv('/var/tmp/bin:/usr/bin', ['/usr/bin/which', '/var/tmp/bin/soffice'])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', reason: 'temp' })
  })

  it.each(['which', 'powershell'])('is unsafe when the bare-name helper `%s` resolves into the project', (helper) => {
    const env = posixEnv('/work/repo:/usr/bin', [`/work/repo/${helper}`, '/usr/bin/which', '/usr/bin/soffice'])
    expect(resolveLibreOffice(ROOTS, { env, realpath: id })).toMatchObject({ state: 'unsafe', name: helper })
  })

  it('without `which`, skips PATH names and uses the fixed macOS bundle', () => {
    const bundle = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    const env = posixEnv('/work/repo', ['/work/repo/soffice', bundle], 'darwin')
    expect(resolveLibreOffice(ROOTS, { env, realpath: id })).toEqual({ state: 'found', path: bundle })
  })

  it('is missing when nothing resolves (Linux has no fixed path)', () => {
    expect(resolveLibreOffice([], { env: posixEnv('/usr/bin', ['/usr/bin/which']), realpath: id })).toEqual({ state: 'missing' })
  })

  it('fails closed when the real path of a hit cannot be resolved', () => {
    const env = posixEnv('/usr/bin', ['/usr/bin/which', '/usr/bin/soffice'])
    const realpath = (p: string): string | null => (p === '/usr/bin/soffice' ? null : p)
    expect(resolveLibreOffice([], { env, realpath })).toMatchObject({ state: 'unsafe', reason: 'unresolvable' })
  })

  it('compares the project case-insensitively on macOS', () => {
    const env = posixEnv('/Users/me/Repo/bin:/usr/bin', ['/usr/bin/which', '/Users/me/Repo/bin/soffice'], 'darwin')
    expect(resolveLibreOffice(['/users/me/repo'], { env, realpath: id }).state).toBe('unsafe')
  })

  it('rejects hits in a project opened through a symlink (root compared by its real path too)', () => {
    // Real folders and a real link (a junction on Windows, which needs no
    // privilege), so the root's real path comes from the host. The PATH and the
    // files are built for the host platform, so this runs on every OS.
    const host = process.platform
    const exe = (name: string): string => (host === 'win32' ? `${name}.exe` : name)
    const sysDir = host === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin'
    // Outside the temp folders, so only the project rule can refuse.
    const base = join(process.cwd(), '.local', 'vitest-symlink-project')
    mkdirSync(base, { recursive: true })
    const real = mkdtempSync(join(base, 'real-'))
    const link = join(base, `link-${process.pid}`)
    mkdirSync(join(real, 'bin'))
    symlinkSync(real, link, 'junction')
    try {
      const realBin = join(realpathSync.native(real), 'bin')
      const files = new Set([join(sysDir, exe('which')), join(sysDir, exe('powershell')), join(realBin, exe('soffice'))])
      const env: PathLookupEnv = {
        platform: host,
        pathValue: [realBin, sysDir].join(delimiter),
        pathext: '.EXE',
        cwd: base,
        rustPrefixDirs: host === 'win32' ? [sysDir] : [],
        isExecutableFile: (p) => files.has(p)
      }
      expect(resolveLibreOffice([link], { env, realpath: id })).toMatchObject({ state: 'unsafe', reason: 'project' })
    } finally {
      rmSync(link, { recursive: false, force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  it('works against the real file system: a planted soffice in a temp PATH folder is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erf-path-'))
    const planted = join(dir, 'soffice')
    writeFileSync(planted, '#!/bin/sh\nexit 0\n')
    chmodSync(planted, 0o755)
    try {
      // POSIX only: it relies on the host's real /usr/bin/which and on the
      // executable bit, neither of which exists on Windows. The Windows lookup
      // is covered by the injected-file-system cases below.
      if (process.platform === 'win32') return
      const env: PathLookupEnv = { platform: process.platform, pathValue: `${dir}:/usr/bin`, cwd: '/' }
      expect(resolveLibreOffice([], { env })).toMatchObject({ state: 'unsafe', name: 'soffice' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveLibreOffice – Windows', () => {
  const PF = 'C:\\Program Files\\Libreoffice\\program\\soffice.exe'

  it('uses only LiteParse’s literal Program Files path when there is no `which`', () => {
    const env = winEnv('C:\\Tools', [PF])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'found', path: PF })
  })

  it('does not accept the x86 folder LiteParse never looks in', () => {
    const env = winEnv('C:\\Tools', ['C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'missing' })
  })

  it('checks helpers as Rust starts them: <name>.exe only, app folder and System32 first', () => {
    // A which.bat in the project is not what Rust runs – but a which.exe is.
    const bat = winEnv('C:\\Repo;C:\\Tools', ['C:\\Repo\\which.bat', PF])
    expect(resolveLibreOffice(['C:\\Repo'], { env: bat, realpath: id })).toEqual({ state: 'found', path: PF })
    const exe = winEnv('C:\\Repo;C:\\Tools', ['C:\\Repo\\which.exe', PF])
    expect(resolveLibreOffice(['C:\\Repo'], { env: exe, realpath: id })).toMatchObject({ state: 'unsafe', name: 'which' })
    // powershell.exe in System32 wins over one planted on PATH.
    const ps = winEnv('C:\\Repo', ['C:\\Windows\\System32\\powershell.exe', 'C:\\Repo\\powershell.exe', PF])
    expect(resolveLibreOffice(['C:\\Repo'], { env: ps, realpath: id }).state).toBe('found')
  })

  it('a normal install – soffice.com next to soffice.exe in one trusted folder – is found, as the .exe', () => {
    // LibreOffice's program folder ships both; `which` prints the .com (PATHEXT
    // order), Rust would start the .exe. Same folder, trusted: no disagreement.
    const LO = 'C:\\Program Files\\LibreOffice\\program'
    const env = winEnv(`C:\\Tools;${LO}`, ['C:\\Tools\\which.exe', `${LO}\\soffice.com`, `${LO}\\soffice.exe`])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'found', path: `${LO}\\soffice.exe` })
  })

  it('is unsafe when the two lookups land in different folders', () => {
    // soffice.cmd in an earlier folder than soffice.exe.
    const env = winEnv('C:\\Tools;C:\\Early;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\Early\\soffice.cmd', 'C:\\LO\\soffice.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'soffice', reason: 'ambiguous' })
  })

  it('is unsafe when only one lookup finds a copy', () => {
    const env = winEnv('C:\\Tools;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\LO\\soffice.com'])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'soffice', reason: 'ambiguous' })
  })

  it('is unsafe, with that copy’s reason, when the shared folder is untrusted', () => {
    const env = winEnv('C:\\Tools;C:\\Repo\\bin', ['C:\\Tools\\which.exe', 'C:\\Repo\\bin\\soffice.com', 'C:\\Repo\\bin\\soffice.exe'])
    expect(resolveLibreOffice(['C:\\Repo'], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'soffice', reason: 'project' })
  })

  it('agrees when both lookups land on the same .exe', () => {
    const env = winEnv('C:\\Tools;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\LO\\soffice.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'found', path: 'C:\\LO\\soffice.exe' })
  })

  it('compares the project case-insensitively with backslash paths', () => {
    const env = winEnv('C:\\Tools;C:\\Work\\Repo\\bin', ['C:\\Tools\\which.exe', 'C:\\Work\\Repo\\bin\\soffice.exe'])
    expect(resolveLibreOffice(['c:\\work\\repo'], { env, realpath: id })).toMatchObject({ state: 'unsafe', reason: 'project' })
  })

  it('a UNC entry ahead of a helper is unsafe (network share), without touching the share', () => {
    const touched: string[] = []
    const env: PathLookupEnv = {
      ...winEnv('\\\\evil\\share;C:\\Tools', []),
      isExecutableFile: (p) => {
        touched.push(p)
        return p.toLowerCase() === 'c:\\tools\\which.exe'
      }
    }
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'which', reason: 'network' })
    expect(touched.some((p) => p.startsWith('\\\\'))).toBe(false)
  })

  it('a UNC entry before the first local LibreOffice is unsafe (network share), without any stat of it', () => {
    // PATH=\\srv\share;C:\LO – which/Rust would search the share first.
    const touched: string[] = []
    const files = new Set([
      'c:\\windows\\system32\\which.exe',
      'c:\\windows\\system32\\powershell.exe',
      'c:\\lo\\soffice.exe'
    ])
    const env: PathLookupEnv = {
      ...winEnv('\\\\srv\\share;C:\\LO', []),
      isExecutableFile: (p) => {
        touched.push(p)
        return files.has(p.toLowerCase())
      }
    }
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({
      state: 'unsafe',
      name: 'libreoffice-fresh',
      reason: 'network',
      path: '\\\\srv\\share'
    })
    expect(touched.some((p) => p.startsWith('\\\\'))).toBe(false)
  })

  it('a UNC entry with no local hit at all is unsafe: the share is where the lookup would end up', () => {
    const env = winEnv('C:\\Tools;\\\\srv\\share', ['C:\\Windows\\System32\\which.exe', 'C:\\Windows\\System32\\powershell.exe', PF])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'libreoffice-fresh', reason: 'network' })
  })

  it('a UNC entry where a helper is not found locally is unsafe: Rust would search the share for it', () => {
    const env = winEnv('C:\\Tools;\\\\srv\\share', ['C:\\Windows\\System32\\which.exe', PF])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'powershell', reason: 'network' })
  })

  it('a UNC entry after the local hit is searched by nobody, so the local copy is found', () => {
    const env = winEnv('C:\\LO;\\\\srv\\share', ['C:\\Windows\\System32\\which.exe', 'C:\\Windows\\System32\\powershell.exe', 'C:\\LO\\libreoffice-fresh.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'found', path: 'C:\\LO\\libreoffice-fresh.exe' })
  })
})

describe('findUntrustedConversionTool', () => {
  it('ignores PDF and images – LiteParse reads them itself', () => {
    const env = posixEnv('/work/repo', ['/work/repo/which', '/work/repo/soffice'])
    expect(findUntrustedConversionTool('pdf', ROOTS, { env, realpath: id })).toBeNull()
    expect(findUntrustedConversionTool('png', ROOTS, { env, realpath: id })).toBeNull()
  })

  it('names the untrusted tool for an Office format', () => {
    const env = posixEnv('/usr/bin:/work/repo', ['/usr/bin/which', '/work/repo/soffice'])
    expect(findUntrustedConversionTool('DOCX', ROOTS, { env, realpath: id })).toEqual({
      name: 'soffice',
      path: '/work/repo/soffice',
      reason: 'project'
    })
  })

  it('passes a trusted or absent LibreOffice', () => {
    expect(findUntrustedConversionTool('xlsx', ROOTS, { env: posixEnv('/usr/bin', ['/usr/bin/which', '/usr/bin/soffice']), realpath: id })).toBeNull()
    expect(findUntrustedConversionTool('xlsx', ROOTS, { env: posixEnv('/usr/bin', ['/usr/bin/which']), realpath: id })).toBeNull()
  })
})
