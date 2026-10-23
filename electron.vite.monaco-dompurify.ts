// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Plugin } from 'vite'
import type { Plugin as EsbuildPlugin } from 'esbuild'

/**
 * Monaco vendors its own DOMPurify (pinned in its package, 3.2.7 in 0.55.1)
 * that the `dompurify` override in package.json cannot reach, and no Monaco
 * release carries a patched copy. The fixes missing from 3.2.7 include
 * GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7,
 * GHSA-mrv2-3pqr-j5jr and GHSA-c6gr-qvv4-5v3f.
 *
 * So the vendored import is redirected to a virtual module that builds Monaco
 * its OWN instance from the npm code: `purify(window)`. One copy of the code
 * ships, but Monaco's `removeAllHooks()` can no longer wipe Mermaid's hooks,
 * and Mermaid's hooks no longer leak into Monaco's output.
 */
export const MONACO_DOMPURIFY_VIRTUAL_ID = '\0erfana:monaco-dompurify'

export const MONACO_DOMPURIFY_SOURCE = "import purify from 'dompurify'\nexport default purify(window)\n"

const VENDORED_IMPORT = /(^|[\\/])dompurify[\\/]dompurify\.js$/
const MONACO_PATH = /[\\/]monaco-editor[\\/]/

/** True for Monaco's own import of its vendored DOMPurify (Windows or POSIX paths). */
export function isMonacoVendoredDompurify(source: string, importer: string | undefined): boolean {
  return !!importer && VENDORED_IMPORT.test(source) && MONACO_PATH.test(importer)
}

/** Vite plugin for builds and the test runner. */
export function monacoOwnDompurify(): Plugin {
  return {
    name: 'erfana:monaco-own-dompurify',
    enforce: 'pre',
    resolveId(source, importer) {
      return isMonacoVendoredDompurify(source, importer) ? MONACO_DOMPURIFY_VIRTUAL_ID : null
    },
    load(id) {
      return id === MONACO_DOMPURIFY_VIRTUAL_ID ? MONACO_DOMPURIFY_SOURCE : null
    }
  }
}

/**
 * The dev server pre-bundles monaco-editor with esbuild and skips Vite plugins,
 * so `npm run dev` would keep the vendored copy. Same redirect for that step.
 * Chosen over excluding monaco-editor from pre-bundling, which would make the
 * dev server serve its thousands of ESM files one by one.
 */
export function monacoOwnDompurifyEsbuild(): EsbuildPlugin {
  const namespace = 'erfana-monaco-dompurify'
  return {
    name: 'erfana:monaco-own-dompurify',
    setup(build) {
      build.onResolve({ filter: VENDORED_IMPORT }, (args) =>
        isMonacoVendoredDompurify(args.path, args.importer) ? { path: args.path, namespace } : null
      )
      build.onLoad({ filter: /.*/, namespace }, () => ({
        contents: MONACO_DOMPURIFY_SOURCE,
        loader: 'js',
        resolveDir: process.cwd()
      }))
    }
  }
}
