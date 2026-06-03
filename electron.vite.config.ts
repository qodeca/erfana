import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts')
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
    plugins: [react()]
  }
})
