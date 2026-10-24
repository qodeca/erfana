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
      // 2026-10-23 with `all: true`: lines/statements 75.03, functions 54.05,
      // branches 98.77). Every other file is at 100 % lines; the remaining
      // headroom is `index.ts` (201 of 358 lines, 14 of 99 functions), so raise
      // these again as that file gets covered. The margin is small: one
      // untested bridge function costs about half a point of `functions`, so a
      // new bridge method needs a preload test. Never lower one to make a
      // change pass.
      thresholds: { lines: 74, functions: 53, branches: 97, statements: 74 },
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
        '**/*.types.ts'
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
