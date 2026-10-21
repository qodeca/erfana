// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * conversionToolGuard (#250): refuse a conversion when the binary LiteParse
 * would resolve by name is untrusted.
 */
import { describe, it, expect } from 'vitest'
import { findUntrustedConversionTool } from './conversionToolGuard'
import type { PathLookupEnv } from '../../utils/pathLookup'

function posixEnv(pathValue: string, files: string[]): PathLookupEnv {
  const set = new Set(files)
  return { platform: 'linux', pathValue, cwd: '/cwd', isExecutableFile: (p) => set.has(p) }
}

const id = (p: string): string => p
const ROOTS = ['/work/repo']

describe('findUntrustedConversionTool', () => {
  it('ignores formats that need no external tool', () => {
    expect(findUntrustedConversionTool('pdf', ROOTS, posixEnv('/work/repo', ['/work/repo/soffice']), id)).toBeNull()
  })

  it('passes when the first LibreOffice name found is trusted', () => {
    const env = posixEnv('/usr/bin:/work/repo', ['/usr/bin/which', '/usr/bin/soffice', '/work/repo/soffice'])
    expect(findUntrustedConversionTool('docx', ROOTS, env, id)).toBeNull()
  })

  it('refuses when the first hit for the name LiteParse would use is in the project', () => {
    const env = posixEnv('/work/repo/bin:/usr/bin', ['/usr/bin/which', '/work/repo/bin/soffice', '/usr/bin/soffice'])
    expect(findUntrustedConversionTool('docx', ROOTS, env, id)).toEqual({ name: 'soffice', path: '/work/repo/bin/soffice' })
  })

  it('follows LiteParse order: an earlier name wins even if a later one is trusted', () => {
    const env = posixEnv('/usr/bin:/work/repo', ['/usr/bin/which', '/work/repo/libreoffice', '/usr/bin/soffice'])
    expect(findUntrustedConversionTool('xlsx', ROOTS, env, id)?.name).toBe('libreoffice')
  })

  it('refuses a hit from a "." PATH entry', () => {
    const env = posixEnv('.:/usr/bin', ['/usr/bin/which', '/cwd/soffice'])
    expect(findUntrustedConversionTool('odt', [], env, id)).toEqual({ name: 'soffice', path: '/cwd/soffice' })
  })

  it('checks the bare-name `which` helper LiteParse spawns', () => {
    const env = posixEnv('/work/repo:/usr/bin', ['/work/repo/which', '/usr/bin/which', '/usr/bin/soffice'])
    expect(findUntrustedConversionTool('docx', ROOTS, env, id)?.name).toBe('which')
  })

  it('checks magick/convert for image formats', () => {
    const env = posixEnv('/work/repo:/usr/bin', ['/usr/bin/which', '/work/repo/magick'])
    expect(findUntrustedConversionTool('png', ROOTS, env, id)).toEqual({ name: 'magick', path: '/work/repo/magick' })
  })

  it('passes when no tool is on PATH (the conversion fails on its own)', () => {
    expect(findUntrustedConversionTool('docx', ROOTS, posixEnv('/usr/bin', ['/usr/bin/which']), id)).toBeNull()
  })

  it('on Windows checks powershell and never `convert`', () => {
    const set = new Set(['C:\\Repo\\powershell.exe', 'C:\\Windows\\System32\\convert.exe'])
    const env: PathLookupEnv = {
      platform: 'win32',
      pathValue: 'C:\\Repo;C:\\Windows\\System32',
      pathext: '.EXE',
      isExecutableFile: (p) => set.has(p)
    }
    expect(findUntrustedConversionTool('docx', ['C:\\repo'], env, id)?.name).toBe('powershell')
    set.delete('C:\\Repo\\powershell.exe')
    expect(findUntrustedConversionTool('png', ['C:\\repo'], env, id)).toBeNull()
  })
})
