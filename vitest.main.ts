// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    name: 'main',
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
      // `src/shared/ipc/browser-schema.ts` is instrumented explicitly (not the
      // whole of src/shared) so the #124 browser-launch IPC payload validator can
      // carry a per-file floor below; the shared tests that exercise it already
      // run in this project.
      include: ['src/main/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}', 'src/shared/ipc/browser-schema.ts'],
      // `all: false` is load-bearing for the required Coverage job's determinism:
      // with `all: true`, an included-but-untested file (any script the main
      // suite does not execute) emits a synthetic 0%-baseline row, which for
      // scripts/fuses.js would collide with its real ~88% row and let the
      // per-file threshold match the 0% row — a spurious required-job failure.
      // Keeping this false means only files a test actually executes are
      // reported, so scripts/fuses.js appears exactly once. The checks.yml
      // Coverage job additionally scopes to `--project main` (issue #55, F4).
      all: false,
      cleanOnRerun: true,
      thresholds: {
        lines: 10,
        functions: 10,
        branches: 5,
        statements: 10,
        // Trust-chain modules (Phase 4 whisper download verification —
        // minisign-signed manifest, hostname-allowlisted streaming SHA-256
        // downloader, safe zip/tar extraction) carry user-facing security
        // weight. Any regression in their coverage is a real risk — the
        // 90% per-file floor here ratchets the bar above the project-wide
        // 10% aggregate. Fires only under `--coverage` (npm run test:cov);
        // does not affect the regular test:ci run.
        // See: docs/windows/whisper-trust-chain.md, ADRs 0001–0004
        'src/main/utils/verifyManifest.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/main/utils/secureDownloader.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/main/utils/zipArchive.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/main/utils/tarArchive.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // Packaging-integrity guards + Electron fuses (issue #43 / #55). This is
        // a build-time hook, so its afterPack orchestration body and the test-only
        // rename path are not unit-reachable; the floor is set to what the
        // 165-test suite meets today (F4) and should ratchet up if that changes.
        'scripts/fuses.js': { lines: 86, functions: 88, branches: 93, statements: 86 },
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
        // this entry landed. See: docs/design/design-issue-60.md §2.6, §5
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
        // trust-chain floor (spec: 90). measured 99.52/100/94.58/99.52.
        // See: docs/features/138-user-guide.md § 3.4
        'scripts/check-links.mjs': { lines: 90, functions: 90, branches: 90, statements: 90 },
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
        'vitest.*.ts',
        'electron.vite.config.ts'
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
