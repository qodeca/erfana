// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import { useToast, Toast } from './ToastContext'
import { TEST_IDS } from '../../constants/testids'
import { useOccluder } from '../../hooks/useOccluder'
import { readPreviewRects, usePreviewViewportStore } from '../../stores/usePreviewViewportStore'
import { placeToastContainer, type ToastPlacement } from './toastPlacement'
import './Toast.css'

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info
}

/** Compose the announced text for a toast (title + message). */
function toastAnnouncement(toast: Toast): string {
  return toast.message ? `${toast.title}: ${toast.message}` : toast.title
}

export function ToastNotification() {
  const { toasts, removeToast } = useToast()

  // A previewed page runs in a native view the OS paints ABOVE all sibling DOM,
  // so a toast that overlaps one is invisible AND unclickable — a click lands on
  // the untrusted page instead. Erfana used to hide every preview whenever any
  // toast appeared; that is safe but blanks a page the user is reading, and an
  // actionable toast never auto-dismisses, so the "Approve this host?" prompt
  // the preview itself raises hid every preview indefinitely.
  //
  // So the toast moves instead, and only falls back to hiding when there is
  // genuinely nowhere clear to put it. See `toastPlacement.ts`.
  const containerRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<ToastPlacement>({
    kind: 'clear',
    offsetX: 0,
    offsetY: 0
  })

  const recompute = useCallback(() => {
    const el = containerRef.current
    if (el === null) {
      setPlacement({ kind: 'clear', offsetX: 0, offsetY: 0 })
      return
    }
    // Measured HERE rather than read from a cache. `.toast-container` is
    // `position: fixed`, so a window resize MOVES it without changing its box
    // and no ResizeObserver fires — a stored rect would go stale exactly when
    // the layout changed under it.
    const rect = el.getBoundingClientRect()
    setPlacement(
      placeToastContainer(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        readPreviewRects(),
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [])

  // Recompute before paint whenever the stack changes, so a toast never shows
  // for a frame in the wrong place.
  useLayoutEffect(recompute, [recompute, toasts])

  useEffect(() => {
    const unsubscribe = usePreviewViewportStore.subscribe(recompute)
    window.addEventListener('resize', recompute)
    return () => {
      unsubscribe()
      window.removeEventListener('resize', recompute)
    }
  }, [recompute])

  // Register the occluder ONLY when the toast could not be placed clear. That is
  // what keeps this honest: the rule is "say you occlude when you actually do",
  // so the overlay guard needs no per-kind exemption, the panel's own
  // `isViewHidden` cannot drift away from the guard's answer, and a consent
  // toast added years from now inherits no silent carve-out.
  useOccluder('toast', toasts.length > 0 && placement.kind === 'blocked')

  // Decoupled live-region pattern (UX-003 / AC#4): TWO always-mounted,
  // visually-hidden live regions exist in the DOM with zero toasts so assistive
  // tech can observe later text injections (a region mounted together with its
  // text is unreliable — MDN). The visual container/items carry NO live role,
  // which avoids nested live regions (adding a toast would otherwise re-read the
  // whole stack) and the polite/assertive race.
  //
  // - `role="status"` (implicit aria-live="polite") for info/success/warning.
  // - `role="alert"` (implicit aria-live="assertive") for errors — do NOT add a
  //   redundant aria-live, role="alert" already implies assertive.
  //
  // The newest toast's text is written into the matching hidden region so the
  // screen reader announces it once. The visual toasts stay normal focusable
  // elements (NOT aria-hidden) so the Close button remains reachable by AT.
  const newest = toasts.length > 0 ? toasts[toasts.length - 1] : null
  const politeText = newest && newest.type !== 'error' ? toastAnnouncement(newest) : ''
  const alertText = newest && newest.type === 'error' ? toastAnnouncement(newest) : ''

  return (
    <>
      <div
        className="toast-sr-only"
        role="status"
        aria-atomic="true"
        data-testid={TEST_IDS.TOAST_LIVE_POLITE}
      >
        {politeText}
      </div>
      <div
        className="toast-sr-only"
        role="alert"
        aria-atomic="true"
        data-testid={TEST_IDS.TOAST_LIVE_ALERT}
      >
        {alertText}
      </div>
      <div
        ref={containerRef}
        className="toast-container"
        data-testid={TEST_IDS.TOAST_CONTAINER}
        style={
          placement.kind === 'clear' && (placement.offsetX !== 0 || placement.offsetY !== 0)
            ? { transform: `translate(${placement.offsetX}px, ${placement.offsetY}px)` }
            : undefined
        }
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = ICON_MAP[toast.type]

  // No live role on the visual item: announcements are owned by the two hidden
  // live regions (see ToastNotification). An ACTIONABLE toast (e.g. approve a
  // blocked host) becomes a labelled `group` so assistive tech can navigate to it
  // and reach its action button, which otherwise sits unnamed at the DOM's end.
  return (
    <div
      className={`toast toast-${toast.type}`}
      data-testid={`${TEST_IDS.TOAST}-${toast.type}`}
      role={toast.action ? 'group' : undefined}
      aria-label={toast.action ? toast.title : undefined}
    >
      <div className="toast-icon">
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message" data-testid={TEST_IDS.TOAST_MESSAGE}>{toast.message}</div>
        {toast.action && (
          <button
            className="toast-action"
            onClick={() => {
              // Run the action, then dismiss — an actionable toast is
              // manual-dismiss (duration 0), so it does not clear on its own.
              toast.action?.onClick()
              onClose()
            }}
            data-testid={TEST_IDS.TOAST_BTN_ACTION}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        className="toast-close"
        onClick={onClose}
        aria-label="Close"
        data-testid={TEST_IDS.TOAST_BTN_DISMISS}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
