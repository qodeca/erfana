/**
 * Main process test setup
 *
 * Cleans up the test log directory after all tests complete.
 * LoggingService uses a temp directory when VITEST is set to avoid
 * polluting production logs with expected test errors.
 */
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll } from 'vitest'
import { installFlakeGuard } from './flakeGuard'

// Surface intermittent unhandled rejections / uncaught exceptions firing
// after teardown (e.g. async `worker_threads` cleanup races, leaked
// `setTimeout` from production code). See `flakeGuard.ts` for rationale.
installFlakeGuard('main')

afterAll(async () => {
  try {
    await rm(join(tmpdir(), 'erfana-test-logs'), { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors - directory may not exist
  }
})
