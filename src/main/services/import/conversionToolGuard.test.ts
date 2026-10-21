// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * conversionToolGuard (#250): replay LiteParse's LibreOffice lookup and judge
 * the binary it would run.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { join } from 'path'
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
      path: '/work/repo/bin/libreoffice'
    })
  })

  it('is unsafe for a hit from a "." or empty PATH entry', () => {
    for (const pathValue of ['.:/usr/bin', ':/usr/bin']) {
      const env = posixEnv(pathValue, ['/usr/bin/which', '/cwd/soffice'])
      expect(resolveLibreOffice([], { env, realpath: id }).state).toBe('unsafe')
    }
  })

  it('is unsafe for a hit in a shared temp folder', () => {
    const env = posixEnv('/var/tmp/bin:/usr/bin', ['/usr/bin/which', '/var/tmp/bin/soffice'])
    expect(resolveLibreOffice([], { env, realpath: id }).state).toBe('unsafe')
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
    expect(resolveLibreOffice([], { env, realpath }).state).toBe('unsafe')
  })

  it('compares the project case-insensitively on macOS', () => {
    const env = posixEnv('/Users/me/Repo/bin:/usr/bin', ['/usr/bin/which', '/Users/me/Repo/bin/soffice'], 'darwin')
    expect(resolveLibreOffice(['/users/me/repo'], { env, realpath: id }).state).toBe('unsafe')
  })

  it('rejects hits in a project opened through a symlink (root compared by its real path too)', () => {
    // Outside the temp folders, so only the project rule can refuse.
    const base = join(process.cwd(), '.local', 'vitest-symlink-project')
    mkdirSync(base, { recursive: true })
    const real = mkdtempSync(join(base, 'real-'))
    const link = join(base, `link-${process.pid}`)
    mkdirSync(join(real, 'bin'))
    symlinkSync(real, link)
    try {
      const realBin = join(realpathSync.native(real), 'bin')
      const env = posixEnv(`${realBin}:/usr/bin`, ['/usr/bin/which', join(realBin, 'soffice')], process.platform)
      expect(resolveLibreOffice([link], { env, realpath: id }).state).toBe('unsafe')
    } finally {
      rmSync(link, { force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  it('works against the real file system: a planted soffice in a temp PATH folder is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erf-path-'))
    const planted = join(dir, 'soffice')
    writeFileSync(planted, '#!/bin/sh\nexit 0\n')
    chmodSync(planted, 0o755)
    try {
      const env: PathLookupEnv = { platform: process.platform, pathValue: `${dir}:/usr/bin`, cwd: '/' }
      if (process.platform === 'win32') return
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

  it('fails closed when a which-style lookup and an .exe-only lookup disagree', () => {
    // soffice.com ahead of soffice.exe in the same folder: `which` prints the .com.
    const env = winEnv('C:\\Tools;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\LO\\soffice.com', 'C:\\LO\\soffice.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toMatchObject({ state: 'unsafe', name: 'soffice' })
    // soffice.cmd in an earlier folder than soffice.exe.
    const env2 = winEnv('C:\\Tools;C:\\Early;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\Early\\soffice.cmd', 'C:\\LO\\soffice.exe'])
    expect(resolveLibreOffice([], { env: env2, realpath: id })).toMatchObject({ state: 'unsafe', name: 'soffice' })
  })

  it('agrees when both lookups land on the same .exe', () => {
    const env = winEnv('C:\\Tools;C:\\LO', ['C:\\Tools\\which.exe', 'C:\\LO\\soffice.exe'])
    expect(resolveLibreOffice([], { env, realpath: id })).toEqual({ state: 'found', path: 'C:\\LO\\soffice.exe' })
  })

  it('compares the project case-insensitively with backslash paths', () => {
    const env = winEnv('C:\\Tools;C:\\Work\\Repo\\bin', ['C:\\Tools\\which.exe', 'C:\\Work\\Repo\\bin\\soffice.exe'])
    expect(resolveLibreOffice(['c:\\work\\repo'], { env, realpath: id }).state).toBe('unsafe')
  })

  it('skips UNC PATH entries without touching them', () => {
    const touched: string[] = []
    const env: PathLookupEnv = {
      ...winEnv('\\\\evil\\share;C:\\Tools', []),
      isExecutableFile: (p) => {
        touched.push(p)
        return p.toLowerCase() === 'c:\\tools\\which.exe'
      }
    }
    resolveLibreOffice([], { env, realpath: id })
    expect(touched.some((p) => p.startsWith('\\\\'))).toBe(false)
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
    expect(findUntrustedConversionTool('DOCX', ROOTS, { env, realpath: id })).toEqual({ name: 'soffice', path: '/work/repo/soffice' })
  })

  it('passes a trusted or absent LibreOffice', () => {
    expect(findUntrustedConversionTool('xlsx', ROOTS, { env: posixEnv('/usr/bin', ['/usr/bin/which', '/usr/bin/soffice']), realpath: id })).toBeNull()
    expect(findUntrustedConversionTool('xlsx', ROOTS, { env: posixEnv('/usr/bin', ['/usr/bin/which']), realpath: id })).toBeNull()
  })
})
