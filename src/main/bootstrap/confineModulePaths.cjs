// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
'use strict'
/* global module */

/**
 * Confine module resolution to the app's own archive.
 *
 * Electron already keeps packaged-app CommonJS lookups inside
 * `process.resourcesPath` (lib/common/reset-search-paths.ts, which also keeps
 * `NODE_PATH` and the home-folder global paths out), but that still lets
 * `Resources/node_modules` and `Resources/app.asar.unpacked/node_modules`
 * answer a `require()` the archive cannot satisfy – an optional dependency a
 * package probes for, say. ESM `import()` goes through Node's ESM resolver,
 * which Electron does not filter at all. Those folders – and anything beside
 * the app – are outside the integrity-checked archive, so a file planted there
 * would run as app code.
 *
 * For a caller inside the resources folder this:
 *   1. narrows every CommonJS search path list to `<...>/app.asar/`
 *      (`Module._nodeModulePaths`), including the calling bundle's own
 *      `module.paths`, which Node computed before this ran;
 *   2. registers a synchronous resolve hook (`module.registerHooks`, Node 24)
 *      that refuses any `require` or `import` resolution landing outside
 *      `app.asar/` – the layer that covers ESM.
 * It also empties `Module.globalPaths`; Electron already does that for a
 * packaged app, so this is belt and braces, not the fix.
 *
 * A no-op unless `filename` (the calling bundle's `__filename`) is inside an
 * `app.asar`, so development and tests are unaffected.
 *
 * electron.vite.config.ts inlines this file as the `intro` of every main-
 * process bundle (index, the git-status worker, the DOCX utility process), so
 * it runs before the bundle's first `require()` of a dependency. Each of those
 * is its own module system (a worker thread and a utility process do not
 * share the main thread's `Module`), which is why it runs in all three.
 *
 * Plain CommonJS on purpose: it is read as text by the build config and must
 * not depend on anything but the modules it is handed.
 *
 * @param {typeof import('module')} Module Node's `module` builtin
 * @param {typeof import('path')} path Node's `path` builtin
 * @param {string} filename absolute path of the calling bundle
 * @param {{ paths?: string[] }} [entryModule] the calling bundle's own `module`
 * @param {typeof import('url')} [url] Node's `url` builtin (enables the resolve hook)
 * @returns {string | null} the archive root confined to, or null when not packaged
 */
function confineModuleSearchPaths(Module, path, filename, entryModule, url) {
  const marker = `${path.sep}app.asar${path.sep}`
  const at = filename.indexOf(marker)
  if (at < 0) return null

  const asarRoot = filename.slice(0, at + marker.length - 1)
  const caseless = path.sep === '\\'
  const norm = (p) => (caseless ? p.toLowerCase() : p)
  const archivePrefix = norm(asarRoot + path.sep)
  const resourcesPrefix = norm(path.dirname(asarRoot) + path.sep)
  const insideArchive = (p) => norm(p).startsWith(archivePrefix)

  // The calling bundle's own module was created before this ran, so its
  // `paths` still holds the wide list (verified: a bare require from the entry
  // searched Resources/node_modules). Narrow it on every call.
  if (entryModule && Array.isArray(entryModule.paths)) {
    entryModule.paths = entryModule.paths.filter(insideArchive)
  }

  if (Module.__erfanaConfinedTo === asarRoot) return asarRoot

  const original = Module._nodeModulePaths
  Module._nodeModulePaths = function erfanaNodeModulePaths(from) {
    const paths = original.call(this, from)
    // Leave callers outside the app alone, exactly like Electron's own filter.
    if (!norm(path.resolve(from) + path.sep).startsWith(resourcesPrefix)) return paths
    return paths.filter(insideArchive)
  }
  if (Array.isArray(Module.globalPaths)) Module.globalPaths.length = 0

  if (url && typeof Module.registerHooks === 'function') {
    Module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context)
        const parent = context && context.parentURL
        if (typeof parent !== 'string' || !parent.startsWith('file:')) return result
        if (!result || typeof result.url !== 'string' || !result.url.startsWith('file:')) return result
        let parentPath
        let targetPath
        try {
          parentPath = url.fileURLToPath(parent)
          targetPath = url.fileURLToPath(result.url)
        } catch {
          return result
        }
        if (!norm(parentPath).startsWith(resourcesPrefix)) return result
        if (insideArchive(targetPath)) return result
        const err = new Error(
          `Cannot find module '${specifier}': it resolves outside app.asar (${targetPath}), which a packaged ` +
            'Erfana never loads code from.'
        )
        err.code = 'ERR_MODULE_NOT_FOUND'
        throw err
      }
    })
  }

  Module.__erfanaConfinedTo = asarRoot
  return asarRoot
}

module.exports = { confineModuleSearchPaths }
