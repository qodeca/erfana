// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wait utilities for E2E tests.
 *
 * Provides race-condition-safe helpers for waiting on IPC operations
 * by observing UI state changes triggered by async operations.
 */

import { expect, Locator } from '@playwright/test'

/**
 * Wait for an IPC operation to complete by observing a UI state change.
 *
 * Uses Promise.all pattern to prevent race conditions – the wait starts
 * BEFORE the trigger executes, so fast completions are caught.
 *
 * **Limitation**: Does not handle state transitions (e.g., visible → hidden → visible).
 * If the locator is already in `expectedState` before the trigger fires, the wait
 * resolves immediately. A future `waitForStateTransition` variant could address this.
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

/**
 * Assert that a visible element stays visible for `forMs`, so a brief flash
 * cannot satisfy `toBeVisible()`.
 *
 * Polls the locator (not one element handle, so a React re-render that swaps
 * the node is fine). Once a sample sees it hidden, the result stays failed
 * even if it comes back – a flip to hidden and back is the regression.
 */
export async function expectToStayVisible(locator: Locator, forMs = 500): Promise<void> {
  const start = Date.now()
  let hiddenAfterMs: number | null = null
  await expect
    .poll(
      async () => {
        if (hiddenAfterMs === null && !(await locator.isVisible())) {
          hiddenAfterMs = Date.now() - start
        }
        if (hiddenAfterMs !== null) return `hidden after ${hiddenAfterMs} ms`
        return Date.now() - start >= forMs ? 'stayed visible' : 'watching'
      },
      { message: `should stay visible for ${forMs} ms`, intervals: [50], timeout: forMs + 2_000 }
    )
    .toBe('stayed visible')
}
