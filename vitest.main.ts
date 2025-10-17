import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    include: ['src/main/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'out', 'e2e', 'tests/fixtures'],
    globals: true,
    reporters: 'default',
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
    reportsDirectory: 'coverage/main',
    thresholds: { lines: 10, functions: 10, branches: 5, statements: 10 },
    exclude: [
      'node_modules/**',
      'out/**',
      'dist/**',
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
