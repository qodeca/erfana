// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
export type GlobalToastPayload = {
  title: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
  duration?: number
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

