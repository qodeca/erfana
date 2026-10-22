// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { createRequire } from 'module'
import path from 'path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { confineModuleSearchPaths } = require('./confineModulePaths.cjs') as {
  confineModuleSearchPaths: (
    Module: FakeModule,
    p: typeof path.posix | typeof path.win32,
    filename: string
  ) => string | null
}

interface FakeModule {
  _nodeModulePaths: (from: string) => string[]
  globalPaths: string[]
  __erfanaConfinedTo?: string
}

/** Node's own walk-up algorithm, for the given path flavour. */
function fakeModule(p: typeof path.posix | typeof path.win32): FakeModule {
  return {
    _nodeModulePaths(from: string): string[] {
      const out: string[] = []
      let dir = p.resolve(from)
      for (;;) {
        if (p.basename(dir) !== 'node_modules') out.push(p.join(dir, 'node_modules'))
        const up = p.dirname(dir)
        if (up === dir) break
        dir = up
      }
      return out
    },
    globalPaths: ['/home/u/.node_modules', '/home/u/.node_libraries']
  }
}

const MAC_RES = '/Applications/Erfana.app/Contents/Resources'

describe('confineModuleSearchPaths', () => {
  it('keeps only search paths inside app.asar for a caller in the archive (macOS layout)', () => {
    const M = fakeModule(path.posix)
    const root = confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/index.js`)
    expect(root).toBe(`${MAC_RES}/app.asar`)

    // The unconfined list would include Resources/node_modules, Contents/node_modules, … /node_modules.
    expect(M._nodeModulePaths(`${MAC_RES}/app.asar/node_modules/isomorphic-git`)).toEqual([
      `${MAC_RES}/app.asar/node_modules/isomorphic-git/node_modules`,
      `${MAC_RES}/app.asar/node_modules`
    ])
    expect(M._nodeModulePaths(`${MAC_RES}/app.asar/out/main`)).toEqual([
      `${MAC_RES}/app.asar/out/main/node_modules`,
      `${MAC_RES}/app.asar/out/node_modules`,
      `${MAC_RES}/app.asar/node_modules`
    ])
    expect(M.globalPaths).toEqual([])
  })

  it('confines a caller in app.asar.unpacked to the archive too', () => {
    const M = fakeModule(path.posix)
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/index.js`)
    const paths = M._nodeModulePaths(`${MAC_RES}/app.asar.unpacked/node_modules/node-pty/lib`)
    expect(paths).toEqual([])
    expect(paths.some((p) => p.includes('app.asar.unpacked'))).toBe(false)
  })

  it('leaves callers outside the app alone', () => {
    const M = fakeModule(path.posix)
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/index.js`)
    expect(M._nodeModulePaths('/Users/me/project/lib')).toContain('/Users/me/project/node_modules')
  })

  it('matches Windows paths case-insensitively', () => {
    const M = fakeModule(path.win32)
    const res = 'C:\\Program Files\\Erfana\\resources'
    const root = confineModuleSearchPaths(M, path.win32, `${res}\\app.asar\\out\\main\\index.js`)
    expect(root).toBe(`${res}\\app.asar`)
    expect(M._nodeModulePaths('c:\\program files\\erfana\\resources\\app.asar\\out\\main')).toEqual([
      'c:\\program files\\erfana\\resources\\app.asar\\out\\main\\node_modules',
      'c:\\program files\\erfana\\resources\\app.asar\\out\\node_modules',
      'c:\\program files\\erfana\\resources\\app.asar\\node_modules'
    ])
  })

  it('is a no-op outside a packaged archive (development, tests)', () => {
    const M = fakeModule(path.posix)
    const before = M._nodeModulePaths
    expect(confineModuleSearchPaths(M, path.posix, '/repo/out/main/index.js')).toBeNull()
    expect(M._nodeModulePaths).toBe(before)
    expect(M.globalPaths).toHaveLength(2)
    // A name that only contains the text is not an archive.
    expect(confineModuleSearchPaths(M, path.posix, '/repo/my-app.asar-notes/index.js')).toBeNull()
  })

  it('installs once per archive, so a second bundle does not wrap the filter again', () => {
    const M = fakeModule(path.posix)
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/index.js`)
    const wrapped = M._nodeModulePaths
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/chunks/x.js`)
    expect(M._nodeModulePaths).toBe(wrapped)
  })
})
