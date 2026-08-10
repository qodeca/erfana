// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// App version is read from package.json at build time and inlined into the
// renderer as `__APP_VERSION__` (no runtime IPC). Used by the window title.
const appVersion: string = JSON.parse(
  readFileSync(resolve('package.json'), 'utf-8')
).version

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts'),
          // SD-019 (#19) native-dependency spike: emits out/main/sqlite-smoke.worker.js,
          // loaded by nativeDepsSmoke.ts via join(__dirname, ...) like the git worker.
          'sqlite-smoke.worker': resolve('src/main/services/workers/sqlite-smoke.worker.ts'),
          // DOCX conversion runs in a killable utilityProcess child (#1 lens-review).
          'docx/docx-convert.process': resolve('src/main/services/docx/docx-convert.process.ts')
        },
        output: {
          // Keep split chunks flat in out/main/ (not out/main/chunks/) so a
          // dynamically-imported module's __dirname is out/main — the same
          // directory as the worker entries it loads via join(__dirname, …).
          // Required for nativeDepsSmoke.ts (a dynamic-import chunk) to resolve
          // out/main/sqlite-smoke.worker.js. See SD-019 §5.
          chunkFileNames: '[name]-[hash].js'
        }
      },
      // externalizeDeps defaults to true for main process (electron-vite convention).
      // This is REQUIRED for @llamaindex/liteparse which depends on native modules
      // (Sharp, @hyzyla/pdfium, tesseract.js-core). Do not set externalizeDeps: false here.
      minify: true // Vite 6 SSR default changed to false; explicit true halves bundle (429→207 kB)
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // Multi-entry preload (#164 lens-review F[6]): the main editor window
        // loads `index.js`, while each per-display area-select overlay window
        // loads `screenshotOverlay.js`. Splitting the surface area keeps the
        // overlay-only IPC verbs out of the main renderer's bridge.
        input: {
          index: resolve('src/preload/index.ts'),
          screenshotOverlay: resolve('src/preload/screenshotOverlay.ts')
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
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
