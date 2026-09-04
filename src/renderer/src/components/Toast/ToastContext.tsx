// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import { subscribeGlobalToasts } from './toastService'

/**
 * An optional actionable button rendered inside a toast (design §5(c), item 64).
 *
 * Used by the HTML-preview "unapproved host" flow to offer an **Approve**
 * action. A toast carrying an `action` is forced to `duration: 0` (manual
 * dismiss) — a 3s auto-dismiss window is not enough time to read the host and
 * decide to approve it.
 */
export interface ToastAction {
  /** Button text, e.g. `"Approve"`. */
  label: string
  /** Invoked when the user activates the action; the toast is dismissed after. */
  onClick: () => void
}

export interface Toast {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
  duration?: number
  /** Optional action button; presence forces `duration: 0` (manual dismiss). */
  action?: ToastAction
}

interface ToastContextType {
  toasts: Toast[]
  showToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  // The 'toast' occluder is registered by `ToastNotification`, NOT here: it is
  // conditional on the stack failing to find a position clear of the live
  // preview, and only the renderer knows the geometry. Registering it here for
  // every toast is what used to hide a preview the toast never covered.

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`
    const newToast: Toast = {
      ...toast,
      id,
      // An actionable toast is manual-dismiss only: force `duration: 0` so the
      // auto-dismiss timer below never fires and the user has unbounded time to
      // read the host and click the action (design §5(c), item 64).
      duration: toast.action ? 0 : (toast.duration ?? 3000)
    }

    setToasts((prev) => [...prev, newToast])

    // Auto-remove after duration - use setToasts directly to avoid stale closure
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, newToast.duration)
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  // Subscribe to global toast events so non-React modules can trigger toasts
  useEffect(() => {
    const unsubscribe = subscribeGlobalToasts((payload) => {
      showToast(payload)
    })
    return () => unsubscribe()
  }, [showToast])

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}
