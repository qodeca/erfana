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
      // The explicit `include` counts an included file that no test loads, at
      // 0 %, so an untested module lowers the totals instead of vanishing from
      // them (vitest 4 removed `all: true`, which did this before).
      cleanOnRerun: true,
      thresholds: {
        // Project-wide floors: the measured value rounded down, minus one point.
        // Re-measured 2026-10-25 after the vitest 3 → 5 upgrade, whose v8
        // provider maps coverage through the AST and counts more branches: the
        // same code read lines/statements 86.78, functions 91.09, branches
        // 90.89 on vitest 3 and reads lines 85.94, statements 85.11, functions
        // 86.24, branches 79.7 now. A change in how coverage is measured, not a
        // drop in what is tested (owner decision). Raise them as coverage
        // grows; never lower one to make a change pass.
        lines: 84,
        functions: 85,
        branches: 78,
        statements: 84,
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
        // measured 99.39/100/98.66/99.39; branches 95.65 on vitest 5 (2026-10-25)
        'src/renderer/src/services/preview/previewDragFreeze.ts': { lines: 97, functions: 98, branches: 94, statements: 97 },
        // measured 99.22/100/94.89/99.22
        'src/renderer/src/services/preview/previewTabMove.ts': { lines: 97, functions: 98, branches: 92, statements: 97 },
        // HTML Preview comments, renderer side (docs/designs/html-preview-comments.md
        // §12.5: React comment components ≥ 90). These draw text any editor of the
        // file wrote, gate every write on the dirty-source guard, and own the focus
        // and occluder hand-offs over the native view. Pinned ~2 points under the
        // value measured when they landed (2026-10-26); never raise one above what
        // the Coverage job actually measures.
        // measured 100/96.87/96.25/99.09 (windowed list, 2026-10-26)
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentDrawer.tsx': { lines: 98, functions: 93, branches: 95, statements: 96 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentParts.tsx': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/97.22/98.33 (lines/functions/branches/statements)
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentThread.tsx': { lines: 98, functions: 98, branches: 95, statements: 98 },
        // measured 100/100/96.29/100 – split out of CommentThread.tsx (max-lines)
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentMessage.tsx': { lines: 98, functions: 98, branches: 95, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentLive.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentToolbarTools.tsx': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/95.83/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentWindow.tsx': { lines: 98, functions: 98, branches: 93, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/IdentityStep.tsx': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/96.36/98.5
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/NewCommentView.tsx': { lines: 98, functions: 98, branches: 94, statements: 96 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/PreviewCommentsLayer.tsx': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/97.22/98.07
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/ThreadsView.tsx': { lines: 98, functions: 98, branches: 95, statements: 96 },
        // measured 100/96.07/91.22/98.86
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/usePreviewComments.ts': { lines: 98, functions: 94, branches: 89, statements: 96 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentCopy.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/95.16/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentFormat.ts': { lines: 98, functions: 98, branches: 93, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentPlacement.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/89.65/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentRows.ts': { lines: 98, functions: 98, branches: 87, statements: 98 },
        // measured 100/100/93.1/100
        'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/commentSchemas.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/92.1/98.03
        'src/renderer/src/components/Settings/sections/CommentsSection.tsx': { lines: 98, functions: 98, branches: 90, statements: 96 },
        // measured 100/100/100/100
        'src/renderer/src/stores/usePreviewCommentStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/services/preview/commentGateway.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/hooks/useCommentDirtyGuard.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/renderer/src/hooks/useUnsavedSourcesFeed.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
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
