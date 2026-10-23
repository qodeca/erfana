// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import { useToast, Toast } from './ToastContext'
import { TEST_IDS } from '../../constants/testids'
import { useOccluder } from '../../hooks/useOccluder'
import { readPreviewRects, usePreviewViewportStore } from '../../stores/usePreviewViewportStore'
import { placeToastContainer, type ToastPlacement } from './toastPlacement'
import { useToastDwellTimer } from './toastDwell'
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

/**
 * The translate currently applied to the container, in CSS pixels.
 *
 * Parsed from the inline style because this component is its only writer, and
 * because it is the state actually on screen — which a remembered value need
 * not be. Anything unparseable reads as no offset, so the worst case is the
 * behaviour this replaces rather than a wrong correction.
 */
function appliedTranslate(el: HTMLElement): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform)
  if (match === null) {
    return { x: 0, y: 0 }
  }
  const x = Number.parseFloat(match[1])
  const y = Number.parseFloat(match[2])
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
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
    //
    // But `getBoundingClientRect` reports the box AFTER this element's own
    // transform, and `placeToastContainer` returns an ABSOLUTE offset from the
    // untransformed CSS anchor. Feeding it the displaced box made the placement
    // eat itself: the second recompute saw a stack already clear of every
    // preview, returned `AT_REST`, dropped the transform, and put the toasts
    // back on top of the native view — reporting `clear`, so the occluder
    // fallback never fired either. It failed OPEN, for the consent prompt.
    //
    // So subtract whatever is applied to get back to the anchor. Read from the
    // DOM rather than remembered in a ref: two recomputes can run before React
    // commits (the store notifies outside React), and a remembered value would
    // describe a frame that is not on screen yet.
    const rect = el.getBoundingClientRect()
    const applied = appliedTranslate(el)
    setPlacement(
      placeToastContainer(
        {
          left: rect.left - applied.x,
          top: rect.top - applied.y,
          width: rect.width,
          height: rect.height
        },
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
  // Latched on ARRIVAL, keyed by id — not derived from the stack on every
  // render. Deriving it meant that dismissing the newest toast re-evaluated
  // both strings to the PREVIOUS toast's text and wrote it into an
  // `aria-atomic` region, which assistive tech announces as a new status. With
  // three toasts, dismissing them one by one read the stack backwards.
  const announcedIds = useRef(new Set<string>())
  const [announced, setAnnounced] = useState({ polite: '', alert: '' })

  useEffect(() => {
    const newest = toasts.length > 0 ? toasts[toasts.length - 1] : null
    if (newest === null || announcedIds.current.has(newest.id)) {
      return
    }
    // Pruned to the live ids so the set cannot grow for the session's lifetime;
    // ids are unique, so a dismissed toast can never return to be re-announced.
    announcedIds.current = new Set(toasts.map((toast) => toast.id))
    const text = toastAnnouncement(newest)
    setAnnounced(
      newest.type === 'error' ? { polite: '', alert: text } : { polite: text, alert: '' }
    )
  }, [toasts])

  const politeText = announced.polite
  const alertText = announced.alert

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
  const rootRef = useRef<HTMLDivElement>(null)
  // `duration` was already resolved by the provider (errors persist, warnings
  // are floored). The countdown pauses while the pointer or focus is on the
  // toast, so a reader is never cut off mid-sentence (WCAG 2.2.1).
  const { paused, onFocus: pauseOnFocus, ...dwellHandlers } = useToastDwellTimer(
    toast.duration ?? 0,
    onClose,
    rootRef
  )

  // Where focus was before it entered the toast, so a dismissal hands it back
  // instead of dropping it on <body>. Recorded on ENTRY only; moving between
  // the toast's own buttons keeps the original. (Ported from #340.)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const handleFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const from = event.relatedTarget
    if (!(from instanceof Node && event.currentTarget.contains(from))) {
      returnFocusTo.current = from instanceof HTMLElement ? from : null
    }
    pauseOnFocus()
  }

  // Close from the Close button, the action, or Escape. Focus goes back only if
  // it was inside the toast (a mouse click on Close focuses Close first) and
  // the element it came from still exists.
  const dismissRef = useRef<() => void>(() => {})
  const dismiss = (): void => {
    const hadFocus = rootRef.current?.contains(document.activeElement) ?? false
    const back = returnFocusTo.current
    onClose()
    if (hadFocus && back?.isConnected) back.focus()
  }
  useLayoutEffect(() => {
    dismissRef.current = dismiss
  })

  // Escape on a focused toast closes the toast and nothing else. The dialogs
  // and menus take Escape in ONE capture-phase listener on `document`
  // (overlayStack.ts), which runs before any handler on this element could, so
  // a React onKeyDown with stopPropagation would be too late: the dialog
  // underneath would close too (finding [28]). A capture listener on `window`
  // runs first, and stopping the event there keeps it from the document.
  // Toasts are not modal, so they are deliberately not on the overlay stack.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.repeat) return
      const root = rootRef.current
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return
      event.stopPropagation()
      event.preventDefault()
      dismissRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // No live role on the visual item: announcements are owned by the two hidden
  // live regions (see ToastNotification). An ACTIONABLE toast (e.g. approve a
  // blocked host) becomes a labelled `group` so assistive tech can navigate to it
  // and reach its action button, which otherwise sits unnamed at the DOM's end.
  return (
    <div
      ref={rootRef}
      className={`toast toast-${toast.type}`}
      data-testid={`${TEST_IDS.TOAST}-${toast.type}`}
      data-paused={paused ? 'true' : undefined}
      {...dwellHandlers}
      onFocus={handleFocus}
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
              dismiss()
            }}
            data-testid={TEST_IDS.TOAST_BTN_ACTION}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        className="toast-close"
        onClick={dismiss}
        aria-label="Close"
        data-testid={TEST_IDS.TOAST_BTN_DISMISS}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
