// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
'use strict'
/* global module */

/**
 * Confine CommonJS module resolution to the app's own archive.
 *
 * Electron already keeps packaged-app lookups inside `process.resourcesPath`
 * (lib/common/reset-search-paths.ts), but that still lets `Resources/node_modules`
 * and `Resources/app.asar.unpacked/node_modules` answer a `require()` the archive
 * cannot satisfy – an optional dependency a package probes for, say. Those
 * folders are outside the integrity-checked archive, so a file planted there
 * would run as app code. This narrows every search path list to
 * `<...>/app.asar/` for a caller inside the resources folder.
 *
 * It is a no-op unless `filename` (the calling bundle's `__filename`) is
 * itself inside an `app.asar`, so development and tests are unaffected.
 *
 * electron.vite.config.ts inlines this file as the `intro` of every main-
 * process bundle (index, the git-status worker, the DOCX utility process), so
 * it runs before the bundle's first `require()` of a dependency. Each of those
 * is its own module system (a worker thread and a utility process do not
 * share the main thread's `Module`), which is why it runs in all three.
 *
 * Plain CommonJS on purpose: it is read as text by the build config and must
 * not depend on anything but the two modules it is handed.
 *
 * @param {typeof import('module')} Module Node's `module` builtin
 * @param {typeof import('path')} path Node's `path` builtin
 * @param {string} filename absolute path of the calling bundle
 * @returns {string | null} the archive root confined to, or null when not packaged
 */
function confineModuleSearchPaths(Module, path, filename) {
  const marker = `${path.sep}app.asar${path.sep}`
  const at = filename.indexOf(marker)
  if (at < 0) return null

  const asarRoot = filename.slice(0, at + marker.length - 1)
  if (Module.__erfanaConfinedTo === asarRoot) return asarRoot

  const caseless = path.sep === '\\'
  const norm = (p) => (caseless ? p.toLowerCase() : p)
  const archivePrefix = norm(asarRoot + path.sep)
  const resourcesPrefix = norm(path.dirname(asarRoot) + path.sep)

  const original = Module._nodeModulePaths
  Module._nodeModulePaths = function erfanaNodeModulePaths(from) {
    const paths = original.call(this, from)
    // Leave callers outside the app alone, exactly like Electron's own filter.
    if (!norm(path.resolve(from) + path.sep).startsWith(resourcesPrefix)) return paths
    return paths.filter((candidate) => norm(candidate).startsWith(archivePrefix))
  }
  // NODE_PATH, ~/.node_modules and ~/.node_libraries: never a packaged app's source.
  if (Array.isArray(Module.globalPaths)) Module.globalPaths.length = 0

  Module.__erfanaConfinedTo = asarRoot
  return asarRoot
}

module.exports = { confineModuleSearchPaths }
