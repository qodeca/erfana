// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { monacoOwnDompurify } from './electron.vite.monaco-dompurify'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  plugins: [monacoOwnDompurify(), react()],
  // Mirror the renderer build's `define` (electron.vite.config.ts) so components
  // that read the inlined app version resolve to a stable value under test.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    name: 'renderer',
    // Worker cap (issue #171); only read when this file is the root `--config`.
    maxWorkers,
    environment: 'jsdom',
    // Monaco's own files must go through the Vite plugin that redirects its
    // vendored DOMPurify (electron.vite.monaco-dompurify.ts); vitest skips
    // node_modules otherwise.
    server: { deps: { inline: [/monaco-editor/] } },
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    setupFiles: ['tests/setup/setupTests.renderer.ts'],
    css: true,
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage/renderer',
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      // Count an included file that no test loads, at 0 %, so an untested
      // module lowers the totals instead of vanishing from them.
      all: true,
      cleanOnRerun: true,
      thresholds: {
        // Project-wide floors: the measured value rounded down, minus one point.
        // Measured 2026-10-23 with `all: true`: lines/statements 86.78,
        // functions 91.09, branches 90.89. Raise them as coverage grows; never
        // lower one to make a change pass.
        lines: 85,
        functions: 90,
        branches: 89,
        statements: 85,
        // Multi-page HTML preview (#124), renderer side. These modules own the
        // geometry and lifecycle the native BrowserView is slaved to — bounds,
        // clipping, drag freeze and tab moves — where a regression shows up as a
        // preview painted over the wrong part of the window, or left visible on a
        // hidden tab. Each floor is pinned ~2 points under the value measured when
        // this entry landed (QG-8 review, finding TQ2); never raise a floor above
        // what the Coverage job actually measures.
        // measured 100/100/98.82/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/previewClip.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 99.39/100/98.66/99.39
        'src/renderer/src/services/preview/previewDragFreeze.ts': { lines: 97, functions: 98, branches: 96, statements: 97 },
        // measured 99.22/100/94.89/99.22
        'src/renderer/src/services/preview/previewTabMove.ts': { lines: 97, functions: 98, branches: 92, statements: 97 },
      },
      exclude: [
        'node_modules/**',
        'out/**',
        '**/out/**',
        '**/dist/**',
        '**/release/**',
        '**/coverage/**',
        '**/temp/**',
        '**/*.test.*',
        '**/__tests__/**',
        '**/__test__/**',
        '**/__test-helpers__/**',
        '**/__fixtures__/**',
        '**/__test-utils__/**',
        '**/test-utils/**',
        'src/renderer/src/utils/testHelpers.ts',
        'vitest.*.ts',
        'electron.vite.config.ts',
        'src/renderer/index.html',
        // Type-only: declarations and interface modules compile to nothing. A
        // type-only `types.ts` elsewhere reports 0 of 0 lines and moves no total.
        '**/*.d.ts',
        '**/*.types.ts',
        'src/renderer/src/interfaces/**',
        // The app entry mounts React as soon as it loads. Its tests read the
        // source rather than loading it (main.*.test.ts), and every e2e run
        // starts it.
        'src/renderer/src/main.tsx',
        // The image-export rasterize harness (#73) runs only inside a hidden
        // Chromium page: it needs createImageBitmap, OffscreenCanvas and a real
        // image decoder, none of which jsdom provides, so no renderer unit test
        // can execute a line of it. Covered by the e2e suite and the manual
        // checklist instead; the same justification is stated in-file at the top
        // of harness.ts.
        'src/renderer/src/imageExport/harness.ts'
      ],
    },
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
