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
      // This is REQUIRED for @llamaindex/liteparse which depends on native modules
      // (Sharp, @hyzyla/pdfium, tesseract.js-core). Do not set externalizeDeps: false here.
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
          imageExport: resolve('src/preload/imageExport.ts')
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
    plugins: [react()]
  }
})
