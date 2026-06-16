// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  // Mirror the renderer build's `define` (electron.vite.config.ts) so components
  // that read the inlined app version resolve to a stable value under test.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    name: 'renderer',
    environment: 'jsdom',
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    setupFiles: ['tests/setup/setupTests.renderer.ts'],
    css: true,
    reporters: 'default',
  },
  coverage: {
    provider: 'v8',
    reporter: ['text-summary', 'lcov', 'html'],
    reportsDirectory: 'coverage/renderer',
    include: ['src/renderer/src/**/*.{ts,tsx}'],
    all: false,
    cleanOnRerun: true,
    thresholds: { lines: 10, functions: 10, branches: 5, statements: 10 },
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
      'electron.vite.config.ts',
      'src/renderer/index.html'
    ],
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
