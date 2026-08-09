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
      include: ['src/main/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}'],
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
