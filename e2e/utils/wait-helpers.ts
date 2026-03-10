/**
 * Wait utilities for E2E tests.
 *
 * Provides race-condition-safe helpers for waiting on IPC operations
 * by observing UI state changes triggered by async operations.
 */

import { Locator } from '@playwright/test'

/**
 * Wait for an IPC operation to complete by observing a UI state change.
 *
 * Uses Promise.all pattern to prevent race conditions – the wait starts
 * BEFORE the trigger executes, so fast completions are caught.
 *
 * @example
 * ```typescript
 * // Wait for file save (title bar loses modified indicator)
 * await waitForIpcComplete({
 *   locator: byTestId(page, 'title-bar'),
 *   expectedState: 'visible',
 *   trigger: () => keyboard.save()
 * })
 * ```
 */
export async function waitForIpcComplete(options: {
  locator: Locator
  expectedState: 'visible' | 'hidden' | 'attached' | 'detached'
  trigger: () => Promise<void>
  timeout?: number
}): Promise<void> {
  const { locator, expectedState, trigger, timeout = 10000 } = options

  await Promise.all([
    locator.waitFor({ state: expectedState, timeout }),
    trigger()
  ])
}
