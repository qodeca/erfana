// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    name: 'preload',
    // Worker cap (issue #171); only read when this file is the root `--config`.
    maxWorkers,
    environment: 'jsdom',
    include: ['src/preload/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    setupFiles: ['tests/setup/setupTests.preload.ts'],
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage/preload',
      include: ['src/preload/**/*.{ts,tsx}'],
      // Count an included file that no test loads, at 0 %, so an untested
      // module lowers the totals instead of vanishing from them.
      all: true,
      cleanOnRerun: true,
      // Floor = the measured value rounded down, minus one point (measured
      // 2026-10-23 with `all: true`: lines/statements 72.19, functions 53.07,
      // branches 98.4). Every other file is at 100 % lines; the remaining
      // headroom is `index.ts` (200 of 356 lines), so raise these again as that
      // file gets covered. Never lower one to make a change pass.
      thresholds: { lines: 71, functions: 52, branches: 97, statements: 71 },
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
        // Type-only: declarations and the compile-time contract proofs.
        '**/*.d.ts',
        '**/*.types.ts',
        // Entry point of the sealed preview page: it adds its listeners as soon
        // as it loads. previewPage.contract.test.ts pins its source rather than
        // loading it, and the HTML-preview e2e specs run it.
        'src/preload/previewPage.ts'
      ],
    },
  },
  resolve: {
    alias: {
      '@preload': path.resolve(__dirname, 'src/preload'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
