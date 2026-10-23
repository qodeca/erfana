// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { createRequire } from 'module'
import path from 'path'
import url from 'url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { confineModuleSearchPaths } = require('./confineModulePaths.cjs') as {
  confineModuleSearchPaths: (
    Module: FakeModule,
    p: typeof path.posix | typeof path.win32,
    filename: string,
    entryModule?: { paths?: string[] },
    url?: typeof import('url')
  ) => string | null
}

type ResolveHook = (
  specifier: string,
  context: { parentURL?: string },
  next: (s: string, c: { parentURL?: string }) => { url: string }
) => { url: string }

interface FakeModule {
  _nodeModulePaths: (from: string) => string[]
  globalPaths: string[]
  __erfanaConfinedTo?: string
  registerHooks?: (hooks: { resolve: ResolveHook }) => void
  hooks?: { resolve: ResolveHook }
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

  it("narrows the entry bundle's own module.paths, computed before the intro ran", () => {
    const M = fakeModule(path.posix)
    const entry = { paths: M._nodeModulePaths(`${MAC_RES}/app.asar/out/main`) }
    expect(entry.paths).toContain(`${MAC_RES}/node_modules`)
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/index.js`, entry)
    expect(entry.paths).toEqual([
      `${MAC_RES}/app.asar/out/main/node_modules`,
      `${MAC_RES}/app.asar/out/node_modules`,
      `${MAC_RES}/app.asar/node_modules`
    ])
    // A second bundle (same Module) still gets its own paths narrowed.
    const second = { paths: [`${MAC_RES}/app.asar/node_modules`, `${MAC_RES}/node_modules`] }
    confineModuleSearchPaths(M, path.posix, `${MAC_RES}/app.asar/out/main/chunks/x.js`, second)
    expect(second.paths).toEqual([`${MAC_RES}/app.asar/node_modules`])
  })

  describe('resolve hook (covers ESM import and require)', () => {
    // Native path flavour: the hook converts file URLs with the host's url module.
    const RES = path.resolve(path.sep, 'Applications', 'Erfana.app', 'Contents', 'Resources')
    const install = (): ResolveHook => {
      const M = fakeModule(path)
      M.registerHooks = (hooks): void => {
        M.hooks = hooks
      }
      confineModuleSearchPaths(M, path, path.join(RES, 'app.asar', 'out', 'main', 'index.js'), undefined, url)
      if (!M.hooks) throw new Error('hook not registered')
      return M.hooks.resolve
    }
    const parentURL = url.pathToFileURL(path.join(RES, 'app.asar', 'out', 'main', 'index.js')).href

    it('refuses a resolution outside app.asar for a caller inside the app', () => {
      const resolve = install()
      for (const target of [
        path.join(RES, 'node_modules', 'evil', 'index.mjs'),
        path.join(RES, 'app.asar.unpacked', 'node_modules', 'evil', 'index.js'),
        path.resolve(path.sep, 'Applications', 'node_modules', 'evil', 'index.js')
      ]) {
        expect(() =>
          resolve('evil', { parentURL }, () => ({ url: url.pathToFileURL(target).href }))
        ).toThrow(/resolves outside app\.asar/)
      }
    })

    it('allows the archive, builtins and callers outside the app', () => {
      const resolve = install()
      const inside = url.pathToFileURL(path.join(RES, 'app.asar', 'node_modules', 'zod', 'index.js')).href
      expect(resolve('zod', { parentURL }, () => ({ url: inside })).url).toBe(inside)
      expect(resolve('fs', { parentURL }, () => ({ url: 'node:fs' })).url).toBe('node:fs')
      const outsideParent = url.pathToFileURL(path.resolve(path.sep, 'Users', 'me', 'tool', 'index.js')).href
      const outside = url.pathToFileURL(path.resolve(path.sep, 'Users', 'me', 'tool', 'node_modules', 'x', 'index.js')).href
      expect(resolve('x', { parentURL: outsideParent }, () => ({ url: outside })).url).toBe(outside)
      expect(resolve('x', {}, () => ({ url: outside })).url).toBe(outside)
    })

    it('sets ERR_MODULE_NOT_FOUND on the refusal', () => {
      const resolve = install()
      try {
        resolve('evil', { parentURL }, () => ({ url: url.pathToFileURL(path.join(RES, 'node_modules', 'evil.js')).href }))
      } catch (e) {
        expect((e as NodeJS.ErrnoException).code).toBe('ERR_MODULE_NOT_FOUND')
        return
      }
      throw new Error('expected a throw')
    })
  })
})
