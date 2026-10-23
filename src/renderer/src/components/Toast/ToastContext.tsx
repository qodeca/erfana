// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react'
import { subscribeGlobalToasts } from './toastService'

/** Default auto-dismiss time for success, info and warning toasts. */
export const DEFAULT_TOAST_DURATION_MS = 3000

/**
 * The auto-dismiss timer of one toast. Paused, it keeps the time still left, so
 * resuming gives the reader the rest of it rather than starting over or ending
 * at once (WCAG 2.2.1 Timing Adjustable).
 */
interface DismissTimer {
  handle: ReturnType<typeof setTimeout> | null
  remainingMs: number
  startedAt: number
  paused: boolean
}

/** The toast element whose id is `id`, if it is on screen. */
function toastElement(id: string): Element | null {
  return document.querySelector(`[data-toast-id="${CSS.escape(id)}"]`)
}

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
  /** Stop a toast's auto-dismiss timer, keeping the time left (hover or focus). */
  pauseToast: (id: string) => void
  /** Restart a paused timer with the time left. */
  resumeToast: (id: string) => void
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

  const timers = useRef(new Map<string, DismissTimer>())

  const removeToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer?.handle) clearTimeout(timer.handle)
    timers.current.delete(id)
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const arm = useCallback(
    (id: string, ms: number) => {
      const timer = timers.current.get(id)
      if (!timer) return
      timer.paused = false
      timer.remainingMs = ms
      timer.startedAt = Date.now()
      timer.handle = setTimeout(() => {
        timer.handle = null
        // Never pull a toast out from under the keyboard: one that holds focus
        // stays, paused with no time left, and goes when focus leaves it.
        if (toastElement(id)?.contains(document.activeElement)) {
          timer.paused = true
          timer.remainingMs = 0
          return
        }
        removeToast(id)
      }, ms)
    },
    [removeToast]
  )

  const showToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random()}`
      const newToast: Toast = {
        ...toast,
        id,
        // Manual dismiss only (`duration: 0`) for an actionable toast – the user
        // needs unbounded time to read the host and decide (design §5(c), item
        // 64) – and for an error, which must not vanish before it is read (WCAG
        // 2.2.1). Success, info and warning keep their timing.
        duration: toast.action || toast.type === 'error' ? 0 : (toast.duration ?? DEFAULT_TOAST_DURATION_MS)
      }

      setToasts((prev) => [...prev, newToast])

      if (newToast.duration && newToast.duration > 0) {
        timers.current.set(id, { handle: null, remainingMs: newToast.duration, startedAt: 0, paused: false })
        arm(id, newToast.duration)
      }
    },
    [arm]
  )

  const pauseToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (!timer || timer.paused) return
    if (timer.handle) clearTimeout(timer.handle)
    timer.handle = null
    timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt))
    timer.paused = true
  }, [])

  const resumeToast = useCallback(
    (id: string) => {
      const timer = timers.current.get(id)
      if (!timer || !timer.paused) return
      arm(id, timer.remainingMs)
    },
    [arm]
  )

  // A provider that unmounts must not leave timers that set state afterwards.
  useEffect(() => {
    const live = timers.current
    return () => {
      for (const timer of live.values()) if (timer.handle) clearTimeout(timer.handle)
      live.clear()
    }
  }, [])

  // Subscribe to global toast events so non-React modules can trigger toasts
  useEffect(() => {
    const unsubscribe = subscribeGlobalToasts((payload) => {
      showToast(payload)
    })
    return () => unsubscribe()
  }, [showToast])

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast, pauseToast, resumeToast }}>
      {children}
    </ToastContext.Provider>
  )
}
