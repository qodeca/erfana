// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Dialog service for imperative API (non-React code)
// Follows the same pattern as toastService.ts

import type { DialogType, DialogConfig } from './types'

export interface GlobalDialogPayload {
  type: DialogType
  config: DialogConfig
}

const DIALOG_EVENT = 'app:dialog'

/**
 * Show a dialog from non-React code
 * Dispatches a custom event that DialogContext listens to
 *
 * @example
 * ```typescript
 * import { showGlobalDialog } from './dialogService'
 *
 * showGlobalDialog({
 *   type: 'confirm',
 *   config: {
 *     title: 'Delete File',
 *     message: 'Are you sure?',
 *     danger: true
 *   }
 * })
 * ```
 */
export function showGlobalDialog(payload: GlobalDialogPayload): void {
  window.dispatchEvent(new CustomEvent(DIALOG_EVENT, { detail: payload }))
}

/**
 * Subscribe to global dialog events
 * Used by DialogContext to listen for dialog requests from non-React code
 *
 * @param handler - Callback function to handle dialog events
 * @returns Unsubscribe function
 */
export function subscribeGlobalDialogs(
  handler: (payload: GlobalDialogPayload) => void
): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<GlobalDialogPayload>
    handler(ce.detail)
  }

  window.addEventListener(DIALOG_EVENT, listener as EventListener)

  return () => {
    window.removeEventListener(DIALOG_EVENT, listener as EventListener)
  }
}
