// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    name: 'main',
    // Worker cap (issue #171); only read when this file is the root `--config`.
    maxWorkers,
    environment: 'node',
    include: ['src/main/**/*.test.{ts,tsx}', 'src/shared/**/*.test.{ts,tsx}', 'scripts/**/*.test.{js,mjs,ts}'],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    setupFiles: ['tests/setup/setupTests.main.ts'],
    reporters: 'default',
    // Coverage MUST live under `test.coverage` — a top-level `coverage` key is
    // ignored by vitest, which is where the per-file floors below sat inert until
    // issue #55 F4 moved them here so the thresholds actually fire.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage/main',
      // `scripts/**` is instrumented so the packaging-integrity guards in
      // scripts/fuses.js (issue #43 / #55) carry a real per-file floor (F4).
      // `src/shared/**` is instrumented here because the shared tests run in
      // this project; it includes the #124 browser-launch IPC payload validator
      // (`src/shared/ipc/browser-schema.ts`), which carries a per-file floor below.
      include: ['src/main/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}'],
      // An explicit `include` counts an included file that no test loads, at
      // 0 %, so an untested module lowers the totals instead of vanishing from
      // them (vitest 4 removed `all: true`, which did this before). vitest adds
      // such a file only when the run did not already cover it, so
      // scripts/fuses.js (loaded by scripts/fuses.test.mjs) still reports one
      // row at its real coverage under `--project main`. The checks.yml
      // Coverage job keeps scoping to `--project main` (#55, F4).
      cleanOnRerun: true,
      thresholds: {
        // Project-wide floors: the measured value rounded down, minus one point.
        // Re-measured 2026-10-25 after the vitest 3 → 5 upgrade, whose v8
        // provider maps coverage through the AST instead of v8-to-istanbul and
        // counts more branches: the same code read lines/statements 91.42,
        // functions 93.18, branches 91.37 on vitest 3 and reads lines 90.28,
        // statements 89.19, functions 89.58, branches 82.85 now. A change in
        // how coverage is measured, not a drop in what is tested (owner
        // decision). Raise them as coverage grows; never lower one to make a
        // change pass.
        lines: 89,
        functions: 88,
        branches: 81,
        statements: 88,
        // Trust-chain modules (Phase 4 whisper download verification —
        // minisign-signed manifest, hostname-allowlisted streaming SHA-256
        // downloader, safe zip/tar extraction) carry user-facing security
        // weight. Any regression in their coverage is a real risk — the
        // 90% per-file floor here ratchets the bar above the project-wide
        // 10% aggregate. Fires only under `--coverage` (npm run test:cov);
        // does not affect the regular test:ci run.
        // See: docs/windows/whisper-trust-chain.md, ADRs 0001–0004
        // The two branch floors below 90 were re-measured on vitest 5's
        // AST-based branch count (2026-10-25: secureDownloader 89.13,
        // zipArchive 86.48); every other axis still meets 90.
        'src/main/utils/verifyManifest.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/main/utils/secureDownloader.ts': { lines: 90, functions: 90, branches: 88, statements: 90 },
        'src/main/utils/zipArchive.ts': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/main/utils/tarArchive.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // Packaging-integrity guards + Electron fuses (issue #43 / #55). This is
        // a build-time hook, so its afterPack orchestration body and the test-only
        // rename path are not unit-reachable; the floor is set to what the
        // 165-test suite meets today (F4) and should ratchet up if that changes.
        // Branches re-measured on vitest 5's AST-based count (2026-10-25: 77.35).
        'scripts/fuses.js': { lines: 86, functions: 88, branches: 76, statements: 86 },
        // Shared model-id parser + context-window capability registry (#41). It is
        // the SINGLE source of truth behind both the meter's window size and the
        // model label, and a coverage gap here means an unexercised capability row
        // or grammar branch — the exact defect class #41 fixed. Declared as a
        // per-file floor rather than a manually-checked target (design F24 / §12);
        // measured at 100% statements / 98% branches when this entry landed.
        // See: docs/designs/41-model-capability-registry.md §9.5
        'src/main/services/claudeStatus/modelId.ts': { lines: 95, functions: 95, branches: 95, statements: 95 },
        // Renderer / child-process crash + window-hang trail (#60). When the
        // renderer dies the window goes blank and no renderer-side boundary can
        // record it — these handlers are the only evidence the next incident
        // gets, so a silent coverage regression here is a diagnostics outage.
        // The module is small and fully unit-reachable; measured at 100% when
        // this entry landed. See: docs/designs/design-issue-60.md §2.6, §5
        'src/main/utils/rendererCrashHandlers.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // Multi-page HTML preview (#124). These modules decide what the preview
        // BrowserView is allowed to load and where it may navigate — frame/scheme
        // gating, request filtering, URL normalisation, page and tab scope — plus
        // the external-browser launch path, which hands a URL to the OS. A silent
        // coverage regression here is a security regression, so each floor is
        // pinned ~2 points under the value measured when this entry landed
        // (see the QG-8 review, finding TQ2). Never raise a floor above what the
        // Coverage job actually measures.
        // measured 100/100/96.55/100
        'src/main/services/preview/previewFrameGuard.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 96.99/100/93.75/96.99
        'src/main/services/preview/PreviewRequestFilter.ts': { lines: 94, functions: 98, branches: 91, statements: 94 },
        // measured 100/100/100/100
        'src/main/services/preview/previewUrl.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewPageScope.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewFrameSources.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewPageNavigator.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/96/100
        'src/main/services/preview/previewViewNavigation.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewTabHistory.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewStillFrameFreshness.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browserLaunch/browserLauncher.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browserLaunch/BrowserLaunchService.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/ipc/browser-schema.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Offline link and wording check (#138). It reads contributor-controlled
        // Markdown in the local gate, and its path walk is what keeps a link from
        // probing or reading files outside the repository, so it carries the
        // trust-chain floor (spec: 90). measured 99.52/100/94.65/99.52.
        // See: docs/features/138-user-guide.md § 3.4
        'scripts/check-links.mjs': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // HTML Preview comments – format core (docs/designs/html-preview-comments.md
        // § 12.5). These modules write into the user's own .html files: the
        // serializer, escaping, splice and its verification decide whether a
        // comment can turn into live markup or corrupt a byte outside its block
        // (threat S13, decision 24). Each floor is pinned 2 points under the value
        // measured when this entry landed (2026-10-26); never raise one above
        // what the Coverage job measures.
        // measured 100/100/100/100
        'src/shared/htmlComments/format.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/parse.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/splice.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/anchor.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/conflictMarkers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/encoding.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/instrument.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/htmlIndex.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/frameworkMarkers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/thread.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
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
        'vitest.*.ts',
        'electron.vite.config.ts',
        // Type-only: declarations and interface modules compile to nothing. A
        // type-only `types.ts` elsewhere reports 0 of 0 lines and moves no
        // total; it is not excluded by name, because some `types.ts` files
        // hold runtime code (src/main/services/import/types.ts).
        '**/*.d.ts',
        '**/*.types.ts',
        'src/main/interfaces/**',
        // Script entry points: each runs its command as soon as it is loaded, so
        // importing one would run it. They run as their own process (an npm
        // script, or a child process in their test). Scripts that export their
        // logic stay counted, tested or not – the build hooks included.
        'scripts/add-spdx-headers.mjs',
        'scripts/check-spdx-headers.mjs',
        'scripts/design-sync.mjs',
        'scripts/prebuild.mjs',
        'scripts/run-mcp.js',
        'scripts/test-cov.mjs',
        // Imported natively by eslint.config.mjs, so every test that runs ESLint
        // in-process (eslint-*.test.mjs) loads a second copy outside vitest's
        // transform, and v8 maps that copy onto the transformed source: the
        // report shows each function twice, half of them unrun. Its behaviour
        // is tested in scripts/check-max-lines.test.mjs.
        'scripts/lib/max-lines-baseline.mjs'
      ],
    },
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
