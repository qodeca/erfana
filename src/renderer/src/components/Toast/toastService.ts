// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { ToastAction } from './ToastContext'

export type GlobalToastPayload = {
  title: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
  duration?: number
  /**
   * Optional action button (Issue #74, UX-001). A toast carrying an `action`
   * is forced to `duration: 0` by {@link ToastProvider}, so it stays until the
   * user acts or dismisses. The callback is invoked in-process (the CustomEvent
   * detail is never serialised), so passing a function here is safe.
   */
  action?: ToastAction
}

const TOAST_EVENT = 'app:toast'

export function showGlobalToast(payload: GlobalToastPayload) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: payload }))
}

export function subscribeGlobalToasts(handler: (p: GlobalToastPayload) => void) {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<GlobalToastPayload>
    handler(ce.detail)
  }
  window.addEventListener(TOAST_EVENT, listener as EventListener)
  return () => window.removeEventListener(TOAST_EVENT, listener as EventListener)
}

