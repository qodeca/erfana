// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared locator utilities for E2E tests.
 *
 * Provides reusable element location helpers used by POM classes
 * and the backward-compatible adapter layer.
 */

import { Page, Locator, expect } from '@playwright/test'
import { getPathHash } from '../../src/renderer/src/constants/testids'

export function byTestId(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"]`)
}

export function byDynamicTestId(page: Page, prefix: string, filePath: string): Locator {
  const hash = getPathHash(filePath)
  return page.locator(`[data-testid="${prefix}-${hash}"]`)
}

export async function waitForTestId(
  page: Page,
  testId: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 5000 } = options
  await expect(byTestId(page, testId)).toBeVisible({ timeout })
}

export async function waitForTestIdHidden(
  page: Page,
  testId: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 5000 } = options
  await expect(byTestId(page, testId)).not.toBeVisible({ timeout })
}
