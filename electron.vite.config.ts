// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin, Rollup } from 'vite'
import react from '@vitejs/plugin-react'

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
 * Monaco vendors its own DOMPurify (pinned in its package, currently 3.2.7) that
 * the `dompurify` override in package.json cannot reach, and no Monaco release
 * carries a patched copy. Point that vendored import at the npm `dompurify`
 * (pinned by the override) so the renderer ships a single, patched copy. Both
 * modules have a default export of the DOMPurify instance, so no shim is needed.
 */
function useNpmDompurifyForMonaco(): Plugin {
  const vendoredImport = /(^|[\\/])dompurify[\\/]dompurify\.js$/
  return {
    name: 'erfana:monaco-npm-dompurify',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !vendoredImport.test(source)) return null
      if (!/[\\/]monaco-editor[\\/]/.test(importer)) return null
      return this.resolve('dompurify', importer, { ...options, skipSelf: true })
    }
  }
}

/** Minimum DOMPurify version the renderer may ship (fixes GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr). */
const MIN_DOMPURIFY = [3, 4, 17]

/**
 * Fail the renderer build if it ships more than one DOMPurify copy, or one
 * older than MIN_DOMPURIFY. Both devDependencies that bundle it (Mermaid and
 * Monaco) are invisible to `npm audit --omit=dev`, so the bundle is checked.
 */
function assertSingleDompurify(): Plugin {
  return {
    name: 'erfana:single-dompurify',
    apply: 'build',
    writeBundle(_options, bundle): void {
      const versions: string[] = []
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const m of output.code.matchAll(/@license DOMPurify (\d+\.\d+\.\d+)/g)) {
          versions.push(m[1])
        }
      }
      if (versions.length !== 1) {
        throw new Error(
          `Expected exactly one DOMPurify copy in the renderer bundle, found ${versions.length}: ${versions.join(', ') || 'none'}.`
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
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts'),
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
    plugins: [useNpmDompurifyForMonaco(), react(), assertSingleDompurify()]
  }
})
