import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

// Load .env file so E2E tests can access API keys (e.g., OPENAI_API_KEY)
dotenv.config()

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
      testIgnore: '**/visual-regression*',
    },
    {
      name: 'visual',
      testMatch: '**/visual-regression.e2e.ts',
      retries: 0, // Visual diffs must be investigated, not retried (spec 019-FR-003)
      snapshotDir: './e2e/screenshots',
      snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}',
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
        },
      },
    },
  ],
})
