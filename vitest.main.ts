// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    // `scripts/**`, deliberately broad. #21 briefly narrowed this to
    // `scripts/spikes/**` on the false premise that `scripts/fuses.test.mjs`
    // and `scripts/ensure-media-binaries.test.mjs` had never been collected.
    // They had: `git show origin/develop:vitest.main.ts` line 10 carries this
    // same broad glob, and narrowing it silently removed 34 assertions
    // (fuses 29, media-binaries 5) covering Electron fuse verification,
    // node-pty spawn-helper chmod, foreign-prebuild pruning and media-binary
    // SHA-256 checks from the branch-protection-required `test` job.
    // `scripts/**` already covers `scripts/spikes/**`, so the #21 spike
    // harness is collected by this pattern too — no separate entry needed.
    include: [
      'src/main/**/*.test.{ts,tsx}',
      'src/shared/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{js,mjs,ts}'
    ],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    setupFiles: ['tests/setup/setupTests.main.ts'],
    reporters: 'default',
  },
  coverage: {
    provider: 'v8',
    reporter: ['text-summary', 'lcov', 'html'],
    reportsDirectory: 'coverage/main',
    include: ['src/main/**/*.{ts,tsx}'],
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
      // Shared model-id parser + context-window capability registry (#41). It is
      // the SINGLE source of truth behind both the meter's window size and the
      // model label, and a coverage gap here means an unexercised capability row
      // or grammar branch — the exact defect class #41 fixed. Declared as a
      // per-file floor rather than a manually-checked target (design F24 / §12);
      // measured at 100% statements / 98% branches when this entry landed.
      // NOTE: like the four entries above, this block sits under a top-level
      // `coverage` key, which vitest does not read (coverage options belong under
      // `test.coverage`) — so these floors are documentation until that
      // pre-existing placement is fixed. Moving them today fails on the
      // verifyManifest / secureDownloader / zipArchive entries, not on this one.
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
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
