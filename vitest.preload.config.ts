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
      // The explicit `include` counts an included file that no test loads, at
      // 0 %, so an untested module lowers the totals instead of vanishing from
      // them (vitest 4 removed `all: true`, which did this before).
      cleanOnRerun: true,
      // Floor = the measured value rounded down, minus one point. Re-measured
      // 2026-10-25 after the vitest 3 → 5 upgrade, whose v8 provider maps
      // coverage through the AST and counts `index.ts` (the bulk of this
      // project) very differently: lines 98.97, statements 99.03, functions 98.96,
      // branches 98.33 (vitest 3 read 75.03 / 75.03 / 54.05 / 98.77). The
      // margin is small: one untested bridge function costs about half a point
      // of `functions`, so a new bridge method needs a preload test. Never
      // lower one to make a change pass.
      thresholds: { lines: 97, functions: 97, branches: 97, statements: 98 },
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
