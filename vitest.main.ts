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
