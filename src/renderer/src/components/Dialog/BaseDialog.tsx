// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import { useOccluder } from '../../hooks/useOccluder'
import './Dialog.css'

// Small delay to ensure dialog is fully rendered before focusing
// This prevents focus from being lost during the portal mounting animation
const FOCUS_DELAY_MS = 10

// How long after the dialog opens a re-armed `initialFocusKey` pass may still
// promote focus to the preferred target.
//
// The trade this buys: a FAST camera (or any control that enables within the
// first moment) still gets the intended Capture focus, because the promotion
// lands while the dialog is visually still settling and the user cannot yet
// have formed an intent. A SLOW one never yanks focus, because after 1.5s the
// user has read the dialog and may already be about to press Enter on Cancel —
// retargeting that keystroke is worse than leaving focus on the fallback.
//
// 1.5s is chosen against the ~1s "the UI is still responding to me" threshold
// with headroom for a typical getUserMedia() start; it is not derived from a
// measurement, and moving it is a UX decision, not a bug fix.
//
// KNOWN TRADE-OFF, pending assistive-technology verification: a promotion that
// lands 400ms+ after open can truncate a screen reader's dialog announcement,
// and can land between the keydown and keyup of a Space press on the fallback
// button (the keyup then goes to the promoted control). A shorter window
// (~250ms) would avoid both but would also lose the promotion for any camera
// that takes longer than that to start — which is most of them. 1.5s is a
// deliberate product decision, not an oversight; it is flagged here so manual
// AT testing can confirm or refute the concern before anyone "fixes" it.
const FOCUS_PROMOTION_WINDOW_MS = 1500

// Focusable elements, excluding disabled controls. A disabled control cannot
// take focus, so including it made `focusableElements[0]` a dead target and
// made the Tab trap's first/last boundaries wrong. Matches the idiom of the
// two per-dialog traps this file absorbed (DocumentImportDialog,
// TranscriptionDialog), extended with the two selectors this dialog already
// carried ([href], textarea) — a superset, so no dialog loses a boundary.
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), ' +
  'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// ---------------------------------------------------------------------------
// Open-dialog stack
// ---------------------------------------------------------------------------
//
// Every keyboard behaviour below listens on `document`, so a dialog cannot tell
// "focus escaped to the page" from "focus is in a dialog stacked ON TOP of me"
// by looking at `document.activeElement` alone — both read as "outside me".
// Without an explicit stack the background dialog wins, because its listener
// was registered first, and the result is a hard keyboard trap: Tab on the top
// dialog is preventDefault()ed by the background trap, focus is dragged into
// the background dialog, the top dialog's own trap pulls it back to ITS first
// control, and Tab can therefore never advance. The concrete shipping case is
// Cmd+Q during a transcription — the quit ConfirmDialog mounts on top of the
// still-open TranscriptionDialog and neither Quit nor Cancel can be reached by
// keyboard.
//
// The stack holds EVERY open BaseDialog, not only the trapping ones, because
// the dialog that lands on top is frequently a plain ConfirmDialog that never
// opted into `trapFocus`. Registering only trapping dialogs would leave exactly
// the case above unfixed.
//
// ORDERING CONTRACT: the frontmost dialog is the one with the HIGHEST
// `zIndex`, and registration order breaks a tie. Painted order is what the user
// sees and therefore what "the keystroke belongs to the dialog on top" has to
// mean, so it is compared directly rather than inferred from open order.
//
// Registration order alone (the first shape of this stack) agreed with paint
// order everywhere reachable today — DialogContext hands out increasing
// z-indices from 10001, the app-root dialogs are pinned at 10000, and dialogs
// register as they open — but it is an assumption about every future caller,
// not a fact about this module. The case it silently mis-answers: a
// permanently-mounted app-root dialog with `trapFocus` (TranscriptionDialog,
// DocumentImportDialog; zIndex 10000) whose `isOpen` cycles false → true while
// a DialogManager dialog at 10001+ is already up registers LAST, claims
// topmost, and reinstates the very app-wide keyboard trap this stack exists to
// prevent. Comparing z-index removes the assumption instead of documenting it.
//
// Entries pair the per-instance container ref with the `zIndex` that instance
// is rendering at. The ref is stable for the lifetime of a component instance
// (so registration is idempotent under StrictMode's setup/cleanup/setup
// double-invocation) and self-healing, since `isTopmost` skips entries whose
// element is gone — a registration leaked by a component that never ran its
// cleanup cannot wedge every later dialog.
interface OpenDialogEntry {
  ref: React.RefObject<HTMLDivElement>
  zIndex: number
}

const openDialogStack: OpenDialogEntry[] = []

/** Move `ref` to the top of the stack at `zIndex`, without ever duplicating it. */
function registerOpenDialog(ref: React.RefObject<HTMLDivElement>, zIndex: number): void {
  unregisterOpenDialog(ref)
  openDialogStack.push({ ref, zIndex })
}

/** Remove `ref` from the stack. No-op when it is not registered. */
function unregisterOpenDialog(ref: React.RefObject<HTMLDivElement>): void {
  const index = openDialogStack.findIndex((entry) => entry.ref === ref)
  if (index !== -1) {
    openDialogStack.splice(index, 1)
  }
}

/**
 * Whether `ref` is the frontmost open dialog — highest `zIndex` wins, and the
 * most recently registered of an equal-`zIndex` group wins the tie.
 *
 * Detached entries are skipped rather than trusted: React removes a portal
 * subtree in the mutation phase but runs the passive cleanup that unregisters
 * it later, so there is a real window in which a dead dialog still sits on the
 * stack. A dialog registered while nothing else is connected is topmost by
 * definition.
 */
function isTopmostDialog(ref: React.RefObject<HTMLDivElement>): boolean {
  let top: OpenDialogEntry | null = null
  for (const entry of openDialogStack) {
    const element = entry.ref.current
    if (element === null || !element.isConnected) continue
    // `>=`, not `>`: within one z-index the LAST registration is frontmost,
    // which is the behaviour equal-z-index stacks had before z-index was
    // compared at all.
    if (top === null || entry.zIndex >= top.zIndex) top = entry
  }
  return top === null || top.ref === ref
}

export interface BaseDialogProps {
  isOpen: boolean
  onClose: () => void
  zIndex: number
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  className?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  /**
   * Element to focus when the dialog opens, instead of the first focusable in
   * DOM order. Ignored when the ref is empty, detached, disabled, or points
   * OUTSIDE the dialog subtree — in which case the default first-focusable
   * behaviour applies unchanged.
   *
   * The containment check is not defensive tidiness: focusing an element
   * outside an `aria-modal` dialog defeats the modality outright, and with
   * `trapFocus` on it also produces visible ping-pong, because the very next
   * Tab is intercepted and yanks focus back inside.
   *
   * Pass a STABLE ref object. It sits in the focus effect's dependency array,
   * so an inline `{ current: el }` rebuilt on every render re-arms the pass
   * every render, reschedules the timer before it can fire, and focus never
   * lands at all — the same failure mode {@link BaseDialogProps.initialFocusKey}
   * documents for non-primitive keys. `useRef` gives you this for free.
   *
   * @see {@link BaseDialogProps.initialFocusKey} when the target is disabled
   * at open time and becomes enabled asynchronously.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /**
   * Re-arms initial-focus resolution whenever this value changes.
   *
   * `initialFocusRef` is resolved once, `FOCUS_DELAY_MS` after the dialog
   * opens. A dialog whose preferred target is still `disabled` at that instant
   * (CameraDialog's Capture button, disabled until the camera stream starts)
   * would otherwise keep the fallback target forever. Pass the value that
   * flips when the preferred control becomes enabled — e.g. `canCapture` — and
   * the resolution runs again.
   *
   * The re-run never steals focus: it is a no-op unless the preferred target
   * is now focusable, focus is still where BaseDialog itself put it (or on
   * `<body>`, where Chromium leaves it after disabling a focused control), AND
   * less than {@link FOCUS_PROMOTION_WINDOW_MS} has elapsed since the dialog
   * opened. All three must hold.
   *
   * Compared with `Object.is`, so pass a PRIMITIVE: a value rebuilt on every
   * render (an object or array literal, an inline arrow) would re-arm the pass
   * on every render, reschedule the timer before it ever fires, and focus would
   * never land at all.
   *
   * @default undefined - resolve initial focus once, as before
   */
  initialFocusKey?: unknown
  /**
   * Where the `trapFocus` focusout rescue should send focus, instead of the
   * first focusable control in DOM order.
   *
   * First-in-DOM-order is the wrong default for a dialog whose recovery
   * control sits at the END: CameraDialog's first focusable after a camera
   * disconnect is the device `<select>` at the top of the dialog, where the
   * user's next arrow key silently switches camera and restarts the stream,
   * while the control the situation actually calls for — Refresh — is in the
   * footer.
   *
   * Ignored (falling back to first-focusable) when the ref is empty, detached,
   * disabled, or outside the dialog, so a control that is only rendered in the
   * error state can be pointed at unconditionally.
   *
   * @default undefined - rescue focus to the first focusable control
   */
  focusRescueRef?: React.RefObject<HTMLElement | null>
  /**
   * Cycle Tab / Shift+Tab within the dialog. Opt-in: BaseDialog historically
   * only auto-focused, and turning cycling on globally would change keyboard
   * behaviour for every shipping dialog at once.
   *
   * The trap also RECOVERS focus that has already escaped: when
   * `document.activeElement` is outside the dialog (`<body>` after a backdrop
   * mousedown, or after Chromium blurs a control as it becomes disabled), Tab
   * is intercepted and focus returns to the first focusable control instead of
   * walking into the page behind the dialog. A dialog with no focusable
   * control at all leaves the keystroke to the browser rather than swallowing
   * it.
   *
   * It also recovers focus WITHOUT a keystroke: when a control loses focus
   * because it has just become `disabled`, focus is moved back into the dialog
   * (to {@link BaseDialogProps.focusRescueRef} when given). See the `focusout`
   * effect for the exact guards, including the teardown case and why an
   * UNMOUNTED control is deliberately not rescued.
   *
   * Both behaviours are suppressed while another dialog is stacked on top of
   * this one — see the open-dialog stack above.
   *
   * @default false
   */
  trapFocus?: boolean
  children: ReactNode
}

/**
 * BaseDialog - Shared dialog component with common functionality
 *
 * Features:
 * - Portal rendering to #portal-root (consistent across all dialogs)
 * - Backdrop/overlay with configurable click-to-close
 * - Keyboard handling (Escape key)
 * - Focus trap for accessibility
 * - Z-index management via props
 * - Fade-in animation
 */
export function BaseDialog({
  isOpen,
  onClose,
  zIndex,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = '',
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
  initialFocusKey,
  focusRescueRef,
  trapFocus = false,
  children
}: BaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  // The element BaseDialog itself last parked focus on for this open cycle, or
  // null before the first resolution. It is what makes a re-armed pass (see
  // `initialFocusKey`) able to tell "focus is still where we parked it" from
  // "the user has since moved it", which is the whole basis of the no-steal
  // guard below.
  //
  // BOTH focus authorities write it — the auto-focus pass and the focusout
  // rescue. They must agree, because they are answering the same question. When
  // only the auto-focus pass wrote it, a transient disable inside the promotion
  // window (exactly CameraDialog's camera hiccup) made the rescue move focus
  // without recording it, and the next promotion then read `active !== placed`,
  // misclassified BaseDialog's OWN rescue as a deliberate user move, and
  // suppressed the promotion the prop exists to deliver.
  const autoFocusedElement = useRef<HTMLElement | null>(null)
  // `Date.now()` of the current open cycle, or null while closed. Read only by
  // the re-armed focus pass, to time-box it (FOCUS_PROMOTION_WINDOW_MS).
  const openedAt = useRef<number | null>(null)
  // Re-entrancy latch for the focusout rescue: `focus()` can itself dispatch a
  // focusout, and without this the rescue could recurse.
  const isRescuingFocus = useRef(false)

  // Store the currently focused element when dialog opens
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement
    }
  }, [isOpen])

  // Stack membership. Registered for EVERY open dialog, trapping or not, so a
  // non-trapping dialog opened on top still suppresses the trap beneath it.
  //
  // `zIndex` is a dependency because it is half of the ordering key: a dialog
  // re-rendered at a new z-index must be re-ranked, or the stack would answer
  // "who is on top" from a stale paint order.
  useEffect(() => {
    if (!isOpen) return undefined

    registerOpenDialog(dialogRef, zIndex)
    return () => unregisterOpenDialog(dialogRef)
  }, [isOpen, zIndex])

  // Preview occluder (item 63, design §1.8 NEW-10). Every dialog composing on
  // BaseDialog occludes the live preview view while open. Deliberately a
  // SEPARATE hook keyed on `[kind, isOpen]` — NOT folded into the stack effect
  // above (deps `[isOpen, zIndex]`) and NOT into registerOpenDialog (which runs
  // a dedupe unregister→register). Either of those would toggle the count on a
  // z-index change; keying on `isOpen` alone means one open is exactly one push.
  useOccluder('dialog', isOpen)

  // Auto-focus: once per open, and again on every `initialFocusKey` change.
  //
  // The focusable list is computed INSIDE the timeout so it reflects any
  // re-render that COMMITS DURING THE DELAY — a mount-time state update, a
  // store subscription that fires on subscribe. That is the whole of the
  // benefit, and it is narrow: FOCUS_DELAY_MS is 10ms. It does NOT rescue a
  // control that enables on I/O (a camera or network start resolving hundreds
  // of ms later) — at the focus tick the DOM still shows that control
  // disabled, exactly as it was at effect time. `initialFocusKey` is the
  // mechanism for that case.
  useEffect(() => {
    if (!isOpen) {
      // A fresh open must resolve focus unconditionally again.
      autoFocusedElement.current = null
      openedAt.current = null
      return undefined
    }

    // Only the FIRST pass of an open cycle stamps the clock; the re-armed
    // passes (this effect also depends on `initialFocusKey`) must measure
    // against the moment the dialog opened, not against their own arrival.
    if (openedAt.current === null) {
      openedAt.current = Date.now()
    }

    const timer = setTimeout(() => {
      const dialog = dialogRef.current
      const preferred = initialFocusRef?.current ?? null
      // Containment is part of "focusable" here: an element outside the dialog
      // is not a legal initial-focus target for an `aria-modal` dialog, however
      // enabled and connected it is.
      const preferredIsFocusable = Boolean(
        preferred &&
          preferred.isConnected &&
          dialog !== null &&
          dialog.contains(preferred) &&
          !preferred.matches(':disabled')
      )
      const placed = autoFocusedElement.current

      // Re-armed pass (`initialFocusKey` changed). Three conditions, all
      // necessary: the promotion must have something to promote TO, it must
      // still be early enough in the open cycle for a focus move to read as
      // "the dialog is still settling" rather than as a yank, and it must not
      // take focus off a control the user tabbed to while the preferred target
      // was still disabled.
      if (placed !== null) {
        if (!preferredIsFocusable) return

        const openedAtMs = openedAt.current
        if (openedAtMs === null || Date.now() - openedAtMs >= FOCUS_PROMOTION_WINDOW_MS) return

        // `document.body` is where Chromium leaves focus after blurring a
        // control that just became disabled. In a `trapFocus` dialog the
        // focusout rescue normally gets there first and re-parks focus on a
        // live control (updating `placed`), so this arm mostly covers the
        // non-trapping dialogs; it is kept because it costs nothing and the
        // rescue has boundary cases (no focusable control at all) where focus
        // really does stay on `<body>`.
        const active = document.activeElement
        if (active !== null && active !== placed && active !== document.body) return
      }

      if (preferred && preferredIsFocusable) {
        preferred.focus()
        autoFocusedElement.current = preferred
        return
      }

      const fallback = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)[0]
      fallback?.focus()
      autoFocusedElement.current = fallback ?? null
    }, FOCUS_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isOpen, initialFocusRef, initialFocusKey])

  // Keyboard event handler
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    // Add listener with capture to ensure it runs before other handlers
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, closeOnEscape, onClose])

  // Tab-cycling trap. Opt-in via `trapFocus`. The list is recomputed on every
  // keystroke so controls that enable/disable mid-session move the boundaries
  // with them. Bubble phase, matching the two local traps this replaced
  // (DocumentImportDialog, TranscriptionDialog).
  useEffect(() => {
    if (!isOpen || !trapFocus) return undefined

    const handleFocusTrap = (e: KeyboardEvent): void => {
      const dialog = dialogRef.current
      if (e.key !== 'Tab' || !dialog) return

      // Another dialog is stacked on top: the keystroke belongs to IT. Without
      // this check the escaped-focus branch below reads "focus is in the top
      // dialog" as "focus escaped to the page" and drags it down here, which
      // makes the top dialog keyboard-unreachable. See the open-dialog stack.
      if (!isTopmostDialog(dialogRef)) return

      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      // Boundary: nothing to cycle between AND nothing to pull focus back to.
      // Handing the keystroke to the browser is the only non-throwing option --
      // preventDefault() here would swallow Tab with no target to move focus
      // to, which is worse than letting it leave a dialog the user can still
      // dismiss with Escape.
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      // Focus has ALREADY escaped the dialog: `<body>` after a backdrop
      // mousedown, or after Chromium blurs a control at the instant it becomes
      // disabled. Neither the first/last comparison below matches in that
      // state, so without this branch Tab is not intercepted at all and walks
      // into the page behind an `aria-modal` dialog.
      //
      // Re-entry always lands on `first`, Shift+Tab included: once focus is
      // outside there is no "previous element inside the dialog" to step back
      // to, and `first` is the same target BaseDialog auto-focuses on open.
      if (active === null || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleFocusTrap)
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [isOpen, trapFocus])

  // Keystroke-free focus recovery. Part of the `trapFocus` opt-in.
  //
  // Chromium blurs a focused control the instant it becomes `disabled` and
  // moves focus NOWHERE: `relatedTarget` is null and `document.activeElement`
  // falls to `<body>`, outside an `aria-modal` dialog, with no Tab to trigger
  // the keydown trap above. That — and ONLY that — is what this rescues.
  // CameraDialog is the shipping case: Capture is the auto-focused control and
  // `canCapture` goes false on a camera disconnect, and the mirror checkbox
  // disables on the same transition. Handled once here rather than with a
  // per-control `onBlur` in each dialog.
  //
  // NOT rescued: a control that is UNMOUNTED while focused (CameraDialog's
  // Refresh button, which is rendered only under `{error && …}` — `handleRefresh`
  // clears the error, so activating Refresh removes it rather than disabling
  // it; `disabled={isLoading}` never gets to apply). Measured behaviour in this
  // app's runtime (Electron 39.8.9 / Chromium 142, macOS): removing a focused
  // element DOES fire `blur` and a bubbling `focusout` with `relatedTarget:
  // null` and `document.activeElement` already on `<body>` — but Blink clears
  // focus BEFORE it detaches the node, so at dispatch time the target still
  // reports `isConnected: true` and `matches(':disabled') === false`. Both a
  // liveness test and a `:disabled` test therefore decline to rescue it, and
  // the `:disabled` predicate below is the honest spelling of that.
  //
  // Declining is also the behaviour we want. DocumentImportDialog and
  // TranscriptionDialog swap their entire footer on every state transition, so
  // an unmount-triggered rescue would fire on the ordinary "user pressed Enter
  // on Import" path and park focus on the `.dialog-btn-danger` Cancel button
  // that replaces it — a second reflexive Enter would then abort the operation
  // just started. Unmounts fall through to the Tab trap, which recovers focus
  // on the next keystroke without moving it under the user.
  //
  // Listener sits on the CONTAINER, not `document`, so it is scoped to this
  // dialog's subtree and dies with it.
  useEffect(() => {
    if (!isOpen || !trapFocus) return undefined

    const dialog = dialogRef.current
    if (!dialog) return undefined

    const handleFocusOut = (event: FocusEvent): void => {
      // Re-entrancy: the `focus()` below can itself dispatch a focusout.
      if (isRescuingFocus.current) return

      // Teardown. React removes the portal subtree in the mutation phase but
      // only detaches this listener when the passive effect cleanup runs, so
      // there is a real window in which a focusout can arrive against a
      // detached container. Grabbing focus then would also fight the
      // focus-restore effect below, which is putting focus back on whatever
      // opened the dialog.
      if (!dialog.isConnected) return

      // Another dialog is stacked on top: it owns focus now, and a control of
      // ours going disabled underneath it must not yank focus out of it.
      if (!isTopmostDialog(dialogRef)) return

      // A legitimate move to another control inside the dialog (Tab, a click).
      const next = event.relatedTarget as Node | null
      if (next !== null && dialog.contains(next)) return

      // The decisive guard, and the reason this does not fight the user: rescue
      // ONLY when the control that just lost focus did so because it became
      // DISABLED. That is the failure mode with no other recovery path —
      // Chromium blurs the control and moves focus nowhere, with no keystroke
      // for the Tab trap to hook. A control that is still enabled lost focus
      // because something deliberate happened (Tab, a click, the window
      // deactivating) and BaseDialog has no business overriding that; an
      // unmounted one is covered by the reasoning in the block comment above.
      // Generalises CameraDialog's old per-control
      // `relatedTarget === null && currentTarget.disabled` check to every
      // control in every trapping dialog.
      const lost = event.target
      if (!(lost instanceof Element) || !lost.matches(':disabled')) return

      const target = resolveRescueTarget(dialog)
      // Nothing to rescue focus TO. Same boundary as the Tab trap: better to
      // leave focus outside than to throw.
      if (target === null) return

      isRescuingFocus.current = true
      try {
        target.focus()
        // Single writer, single meaning: the promotion guard asks "is focus
        // still where BaseDialog put it?", and after a rescue the answer has to
        // be yes. See `autoFocusedElement`.
        autoFocusedElement.current = target
      } finally {
        isRescuingFocus.current = false
      }
    }

    /**
     * Where a rescue should send focus: the caller's nominated control when it
     * can actually take focus, otherwise the first focusable in DOM order.
     */
    function resolveRescueTarget(dialog: HTMLElement): HTMLElement | null {
      const preferred = focusRescueRef?.current ?? null
      if (
        preferred &&
        preferred.isConnected &&
        dialog.contains(preferred) &&
        !preferred.matches(':disabled')
      ) {
        return preferred
      }
      return dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    }

    dialog.addEventListener('focusout', handleFocusOut)
    return () => dialog.removeEventListener('focusout', handleFocusOut)
  }, [isOpen, trapFocus, focusRescueRef])

  // Restore focus when dialog closes
  useEffect(() => {
    if (!isOpen && previousActiveElement.current) {
      previousActiveElement.current.focus()
      previousActiveElement.current = null
    }
  }, [isOpen])

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) {
    logger.error('BaseDialog: #portal-root element not found')
    return null
  }

  const dialogContent = (
    <div
      className="dialog-overlay"
      style={{ zIndex }}
      onClick={handleBackdropClick}
      data-testid={TEST_IDS.DIALOG_OVERLAY}
    >
      <div
        ref={dialogRef}
        className={`dialog-container ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-testid={TEST_IDS.DIALOG_CONTAINER}
      >
        {children}
      </div>
    </div>
  )

  return createPortal(dialogContent, portalRoot)
}
