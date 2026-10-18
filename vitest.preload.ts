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
      all: false,
      cleanOnRerun: true,
      // Floor = measured minus ~2 points (measured 2026-09-15: lines/statements
      // 64.33, functions 30, branches 97.5). `previewBridge.ts` is at 100 on
      // every axis; the remaining headroom is `index.ts` (54 % lines, 12.5 %
      // functions), so raise these again as that file gets covered.
      thresholds: { lines: 62, functions: 28, branches: 95, statements: 62 },
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
      '@preload': path.resolve(__dirname, 'src/preload'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
