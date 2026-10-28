// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin, Rollup } from 'vite'
import react from '@vitejs/plugin-react'
import { monacoOwnDompurify, monacoOwnDompurifyEsbuild } from './electron.vite.monaco-dompurify'

// App version is read from package.json at build time and inlined into the
// renderer as `__APP_VERSION__` (no runtime IPC). Used by the window title.
const appVersion: string = JSON.parse(
  readFileSync(resolve('package.json'), 'utf-8')
).version

/**
 * Fail the build the moment the preload output stops being self-contained.
 *
 * A sandboxed preload script is handed to Electron as a standalone file: it
 * has no module resolver, so a relative `require('./chunks/…')` throws at load
 * time. When two preload entries import the same module as a value, Rollup
 * hoists it into a shared chunk and BOTH entries gain exactly that require —
 * `window.api` never appears and every built and packaged app opens on the
 * root error screen. Unit tests never look at the bundle, so this guard does
 * (#73; the shared module was `shared/ipc/image-export-channels.ts`).
 *
 * When this fires, the fix is to stop sharing the module — inline the handful
 * of values the second entry needs, or import it with `import type`, which is
 * erased and cannot create a chunk. See `src/preload/imageExport.ts`. Relaxing
 * this check is not a fix.
 */
function assertSelfContainedPreloads(): Plugin {
  return {
    name: 'erfana:preload-self-contained',
    apply: 'build',
    writeBundle(_options, bundle): void {
      const outputs = Object.values(bundle)

      const sharedChunks = outputs
        .filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
        .filter((chunk) => !chunk.isEntry)
        .map((chunk) => chunk.fileName)
      if (sharedChunks.length > 0) {
        throw new Error(
          `Preload build emitted shared chunk(s) a sandboxed preload cannot require: ${sharedChunks.join(', ')}. ` +
            'Two preload entries import the same module as a value — inline the values or use `import type`.'
        )
      }

      const withRelativeRequire = outputs
        .filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
        .filter((chunk) => /require\((['"])\.{1,2}\//.test(chunk.code))
        .map((chunk) => chunk.fileName)
      if (withRelativeRequire.length > 0) {
        throw new Error(
          `Preload entr(ies) contain a relative require() that fails under sandbox: ${withRelativeRequire.join(', ')}. ` +
            'Every preload entry must be a single self-contained file.'
        )
      }
    }
  }
}

/**
 * Source of the module-path confinement every main-process bundle runs first
 * (src/main/bootstrap/confineModulePaths.cjs). Inlined as Rollup's `intro`,
 * which lands ahead of the bundle's own `require()` calls, so not even the
 * first dependency is resolved with the wider default search path.
 */
// A property name the minifier keeps, so the check below can find the intro.
export const CONFINE_MODULE_PATHS_MARKER = '__erfanaConfinedTo'
// The bundle's real `module` is passed in as `m` BEFORE the local `module`
// shim shadows it, so the confinement can also narrow the entry's own
// `module.paths` (computed by Node before any code in the file ran).
const confineModulePathsIntro = [
  ';(function(m){',
  'var module={exports:{}};var exports=module.exports;',
  readFileSync(resolve('src/main/bootstrap/confineModulePaths.cjs'), 'utf-8').replace(/^'use strict'$/m, ''),
  ';module.exports.confineModuleSearchPaths(require("module"),require("path"),__filename,m,require("url"));',
  '})(module);'
].join('\n')

/**
 * Fail the build when a main-process entry does not confine its module search
 * paths BEFORE its first `require()` of a dependency. Rollup's `intro` is
 * documented to land first; this proves it on every build (local, CI's Build
 * job, the release legs), so a bundler change cannot silently reorder it.
 */
function assertModulePathsConfinedFirst(): Plugin {
  const BUILTIN_REQUIRE = /^(electron|module|path|url|node:.+)$/
  return {
    name: 'erfana:main-module-paths-confined',
    apply: 'build',
    // generateBundle sees the final (minified) chunk text before it is written.
    // This checks TEXT order only – the intro string sits before the first
    // dependency `require(` in the file – which is what Rollup's `intro`
    // guarantees; the packaged probe in the spike report checks the runtime effect.
    generateBundle(_options, bundle): void {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue
        const marker = output.code.indexOf(CONFINE_MODULE_PATHS_MARKER)
        const firstDependency = [...output.code.matchAll(/require\((['"])([^'"]+)\1\)/g)].find(
          (m) => !BUILTIN_REQUIRE.test(m[2])
        )
        if (marker < 0 || (firstDependency?.index !== undefined && firstDependency.index < marker)) {
          throw new Error(
            `Main-process entry ${output.fileName} does not confine its module search paths before its first ` +
              `dependency require (src/main/bootstrap/confineModulePaths.cjs). Relaxing this check is not a fix.`
          )
        }
      }
    }
  }
}

/**
 * Minimum DOMPurify version the renderer may ship. It fixes GHSA-p98j-92pf-mc4p,
 * GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr and GHSA-c6gr-qvv4-5v3f.
 */
const MIN_DOMPURIFY = [3, 4, 17]

/**
 * Fail the renderer build if it ships more than one DOMPurify code copy, or one
 * older than MIN_DOMPURIFY. Mermaid and Monaco both bundle it and, as
 * devDependencies, are invisible to `npm audit --omit=dev`, so the output is
 * checked. Runs in generateBundle so bad output is never written. Two markers
 * are counted (the licence banner and the `data-tt-policy-suffix` constant) and
 * must agree, in case a minifier strips the banner. Monaco's instance is built
 * from the same code (see electron.vite.monaco-dompurify.ts), so one copy remains.
 */
function assertSingleDompurify(): Plugin {
  return {
    name: 'erfana:single-dompurify',
    apply: 'build',
    generateBundle(_options, bundle): void {
      const versions: string[] = []
      let markers = 0
      for (const output of Object.values(bundle)) {
        const code =
          output.type === 'chunk'
            ? output.code
            : output.fileName.endsWith('.js') && typeof output.source === 'string'
              ? output.source
              : ''
        for (const m of code.matchAll(/@license DOMPurify (\d+\.\d+\.\d+)/g)) versions.push(m[1])
        markers += code.split('data-tt-policy-suffix').length - 1
      }
      if (versions.length !== 1 || markers !== versions.length) {
        throw new Error(
          `Expected exactly one DOMPurify copy in the renderer bundle, found ${versions.length} banner(s) (${versions.join(', ') || 'none'}) and ${markers} code marker(s).`
        )
      }
      const parts = versions[0].split('.').map(Number)
      const tooOld = parts.some((n, i) => {
        const earlier = parts.slice(0, i).every((p, j) => p === MIN_DOMPURIFY[j])
        return earlier && n < MIN_DOMPURIFY[i]
      })
      if (tooOld) {
        throw new Error(`Bundled DOMPurify ${versions[0]} is older than ${MIN_DOMPURIFY.join('.')}.`)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [assertModulePathsConfinedFirst()],
    build: {
      rollupOptions: {
        output: {
          // Runs before every main-process bundle's first require() – see above.
          intro: confineModulePathsIntro
        },
        input: {
          index: resolve('src/main/index.ts'),
          'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts'),
          // HTML Preview comments: the persistent parse worker (design §19 R3-12).
          'comment-parse.worker': resolve('src/main/services/preview/comments/commentParseWorker.ts'),
          // HTML Preview auto-refresh: the link scan worker, so no page is scanned on main (#124 audit).
          'preview-link-scan.worker': resolve('src/main/services/preview/previewLinkScanWorker.ts'),
          // DOCX conversion runs in a killable utilityProcess child (#1 lens-review).
          'docx/docx-convert.process': resolve('src/main/services/docx/docx-convert.process.ts')
        }
      },
      // externalizeDeps defaults to true for main process (electron-vite convention).
      // This is REQUIRED for @llamaindex/liteparse, whose platform-specific
      // native NAPI binary (@llamaindex/liteparse-<platform>) must stay external.
      // Do not set externalizeDeps: false here.
      minify: true // Vite 6 SSR default changed to false; explicit true halves bundle (429→207 kB)
    }
  },
  preload: {
    // Runs on every `electron-vite build` — local, CI's Build job, the e2e
    // build step and the packaged release builds alike, so no wiring can drift.
    plugins: [assertSelfContainedPreloads()],
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // Multi-entry preload (#164 lens-review F[6]): the main editor window
        // loads `index.js`, while each per-display area-select overlay window
        // loads `screenshotOverlay.js`. Splitting the surface area keeps the
        // overlay-only IPC verbs out of the main renderer's bridge.
        input: {
          index: resolve('src/preload/index.ts'),
          screenshotOverlay: resolve('src/preload/screenshotOverlay.ts'),
          imageExport: resolve('src/preload/imageExport.ts'),
          // The sealed HTML-preview page (#74 / sd-074b §5.1). Exposes nothing;
          // it only reports link clicks to main. Like the other secondary
          // entries it must stay self-contained — see the guard above.
          previewPage: resolve('src/preload/previewPage.ts')
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        // Multi-entry renderer (#73). `index.html` is the app window;
        // `imageExport.html` is the hidden rasterize harness, which needs its
        // OWN page rather than a hash route on the app entry: `src/main.tsx`
        // statically imports `App`, so a hash route would evaluate the entire
        // app module graph — and expose `window.api` — inside a window whose
        // whole purpose is to decode untrusted image bytes.
        //
        // Declaring `input` at all is new here, so BOTH entries must be
        // verified in a packaged build, not just in dev.
        input: {
          index: resolve('src/renderer/index.html'),
          imageExport: resolve('src/renderer/imageExport.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    optimizeDeps: {
      esbuildOptions: { plugins: [monacoOwnDompurifyEsbuild()] }
    },
    plugins: [monacoOwnDompurify(), react(), assertSingleDompurify()]
  }
})
