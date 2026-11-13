// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast locators.
 *
 * `ToastNotification` suffixes its testid with the toast type
 * (`toast-success`, `toast-error`, …), so `TEST_IDS.TOAST` on its own never
 * matches an element. Every spec that waits on a toast needs the same
 * knowledge, so it lives here once.
 *
 * `e2e/utils/image-export-helpers.ts` carries its own narrower `ANY_TOAST`
 * (success and error only, which is all the export grid can raise). It is left
 * as it is on purpose — rewriting a working, heavily-exercised helper is not
 * worth the churn — but new specs should use this module.
 *
 * @see src/renderer/src/components/Toast/ToastNotification.tsx
 */

import type { Page, Locator } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'

/** The four types `ToastContext` can raise. */
export const TOAST_TYPES = ['info', 'success', 'error', 'warning'] as const

export type ToastType = (typeof TOAST_TYPES)[number]

/** CSS selector list matching a toast of any type. */
export const ANY_TOAST_SELECTOR = TOAST_TYPES.map(
  (type) => `[data-testid="${TEST_IDS.TOAST}-${type}"]`
).join(', ')

/** Every toast currently on screen, of any type. */
export function anyToast(page: Page): Locator {
  return page.locator(ANY_TOAST_SELECTOR)
}

/** Toasts of one specific type. */
export function toastOfType(page: Page, type: ToastType): Locator {
  return page.locator(`[data-testid="${TEST_IDS.TOAST}-${type}"]`)
}

/**
 * A toast of any type whose body contains `text`.
 *
 * Matching on the visible message is deliberate: it is what the user reads,
 * and it survives a change of toast type.
 */
export function toastWithText(page: Page, text: string): Locator {
  return anyToast(page).filter({ hasText: text })
}

type Box = { x: number; y: number; width: number; height: number }

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Dismiss every toast that covers `target`, so a click on `target` lands.
 *
 * Toasts sit at the bottom left, over the activity bar's Settings button, and a
 * toast pauses while the pointer rests on it – so a click that Playwright aims
 * at a covered button parks the pointer on the toast and waits for ever. Seen
 * in a full macOS VM run (2026-11-10): "Project Opened" covered Settings.
 * Toasts elsewhere stay, for the specs that read them.
 */
export async function dismissToastsOver(page: Page, target: Locator): Promise<void> {
  const targetBox = await target.boundingBox()
  if (!targetBox) return
  const toasts = anyToast(page)
  for (let i = (await toasts.count()) - 1; i >= 0; i--) {
    const toast = toasts.nth(i)
    const box = await toast.boundingBox().catch(() => null)
    if (!box || !overlaps(box, targetBox)) continue
    await toast.getByTestId(TEST_IDS.TOAST_BTN_DISMISS).click()
    await toast.waitFor({ state: 'detached' })
  }
}
