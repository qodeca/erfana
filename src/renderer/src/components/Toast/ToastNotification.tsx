// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import { useToast, Toast } from './ToastContext'
import { TEST_IDS } from '../../constants/testids'
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
      <div className="toast-container" data-testid={TEST_IDS.TOAST_CONTAINER}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = ICON_MAP[toast.type]

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClose()
    }
  }

  // No live role on the visual item: announcements are owned by the two hidden
  // live regions (see ToastNotification). The item stays a normal focusable
  // element so its Close button is reachable by assistive tech.
  return (
    <div className={`toast toast-${toast.type}`} data-testid={`${TEST_IDS.TOAST}-${toast.type}`}>
      <div className="toast-icon">
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message" data-testid={TEST_IDS.TOAST_MESSAGE}>{toast.message}</div>
      </div>
      <button
        className="toast-close"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Close"
        data-testid={TEST_IDS.TOAST_BTN_DISMISS}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
