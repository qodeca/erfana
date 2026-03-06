import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

// Load .env file so E2E tests can access API keys (e.g., OPENAI_API_KEY)
dotenv.config()

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
})
