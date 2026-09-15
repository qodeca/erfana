// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewBanner (Issue #74, work item 71).
 *
 * The full-panel message shown in the two non-normal states:
 *
 * - **failed** — the render process is gone, the page is unresponsive, or the
 *   entry file was deleted; the primary action reloads the page.
 * - **limit-reached** — a preview is already open elsewhere; the primary action
 *   opens this file as source instead (design §1.4 X20/NEW-9).
 *
 * A single presentational component drives both: message + one primary button,
 * as a `role="alert"` live region so a screen reader announces the state.
 *
 * Issue #124 (part 3 §3.8) adds an optional RETURN button to the failed state:
 * the toolbar – and its Back button – is not rendered while the banner is, so a
 * same-tab move onto a broken page would otherwise leave no way back. When a
 * move caused the banner the return button comes first and takes focus;
 * otherwise it follows the primary action, unfocused.
 *
 * BUSY IS `aria-disabled`, NEVER `disabled`: Chromium blurs a control the
 * instant it gets `disabled`, which would drop a keyboard reader on `<body>`
 * in the middle of the action they just started.
 *
 * @module HtmlPreviewPanel/components/PreviewBanner
 */

import { useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'

/** The failed banner's second button: the way back to the page before a move. */
export interface PreviewBannerReturnAction {
  /** "Back to overview.html" (runs Back) or "Return to pricing.html" (runs Forward). */
  label: string
  /** Starts the move. Not called while {@link PreviewBannerReturnAction.isBusy}. */
  onAction: () => void
  /** The move is running: the button is `aria-disabled` and keeps focus. */
  isBusy?: boolean
  /**
   * A move caused this banner: the button comes FIRST and takes focus. When
   * `false` it follows the primary action and never takes focus.
   */
  leads: boolean
}

/** Props for {@link PreviewBanner}. */
export interface PreviewBannerProps {
  /** The headline sentence describing the state. */
  message: string
  /** Label of the primary action button. */
  actionLabel: string
  /** Primary action handler. Not called while {@link PreviewBannerProps.isBusy}. */
  onAction: () => void
  /** The primary action is in flight: `aria-disabled`, presses ignored, focus kept. */
  isBusy?: boolean
  /**
   * Move keyboard focus to the action button when the banner mounts (UX-008).
   * Used by the failed state so a keyboard user lands on Reload; left off for
   * limit-reached, which is not a recovery a user is mid-flow in. A leading
   * {@link PreviewBannerProps.returnAction} takes focus instead.
   */
  autoFocusAction?: boolean
  /** The failed state's return button (issue #124); absent everywhere else. */
  returnAction?: PreviewBannerReturnAction
}

/** Props for one banner button. */
interface BannerButtonProps {
  label: string
  onAction: () => void
  busy: boolean
  buttonRef: React.RefObject<HTMLButtonElement>
}

/** One banner button; busy ignores presses but stays focusable. */
function BannerButton({ label, onAction, busy, buttonRef }: BannerButtonProps): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="html-preview-banner-button"
      aria-disabled={busy ? 'true' : undefined}
      onClick={() => {
        // `aria-disabled` alone stops nothing; the press is ignored here.
        if (!busy) onAction()
      }}
    >
      {/*
        THE SPAN IS LOAD-BEARING, presentational as it looks. The busy state is
        drawn by dimming the button's CONTENT, and a bare text node has no box to
        put an opacity on; dimming the button instead would dim its focus ring
        with it, to about 2.3:1 — under the 3:1 WCAG 1.4.11 asks of a focus
        indicator, on a button that TAKES focus on mount. The rule is
        `.html-preview-banner-button[aria-disabled='true'] > *` in
        HtmlPreviewPanel.css; it needs an element child to find.

        It adds no semantics and changes no accessible name: the name is still
        this button's text content.
      */}
      <span>{label}</span>
    </button>
  )
}

/**
 * Renders a centered banner with a message, a primary action and, in the
 * failed state after a same-tab move, a return button.
 *
 * @param props - Message, actions and focus preference.
 * @returns The rendered banner.
 *
 * @example Limit reached
 * ```tsx
 * <PreviewBanner
 *   message="A preview is already open."
 *   actionLabel="Open as source"
 *   onAction={openAsSource}
 * />
 * ```
 *
 * @example Failed after a move – the return button leads and takes focus
 * ```tsx
 * <PreviewBanner
 *   message="pricing.html could not be shown – it may have been moved or deleted."
 *   actionLabel="Reload"
 *   onAction={reload}
 *   autoFocusAction
 *   returnAction={{ label: 'Back to overview.html', onAction: goBack, leads: true }}
 * />
 * ```
 */
export function PreviewBanner({
  message,
  actionLabel,
  onAction,
  isBusy = false,
  autoFocusAction = false,
  returnAction
}: PreviewBannerProps): JSX.Element {
  const actionRef = useRef<HTMLButtonElement>(null)
  const returnRef = useRef<HTMLButtonElement>(null)
  const returnLeads = returnAction?.leads ?? false

  // Move focus when the banner mounts (UX-008) – and again when a return
  // button starts to lead: the banner can mount for the failed load before the
  // `pageChanged` that says a move caused it. An effect, not the native
  // `autoFocus` attribute, so it re-runs on either change.
  useEffect(() => {
    if (returnLeads) returnRef.current?.focus()
    else if (autoFocusAction) actionRef.current?.focus()
  }, [autoFocusAction, returnLeads])

  const returnButton = returnAction ? (
    <BannerButton
      label={returnAction.label}
      onAction={returnAction.onAction}
      busy={returnAction.isBusy ?? false}
      buttonRef={returnRef}
    />
  ) : null

  return (
    <div className="html-preview-banner" role="alert">
      <AlertCircle size={32} aria-hidden="true" />
      <span className="html-preview-banner-message">{message}</span>
      {returnLeads && returnButton}
      <BannerButton label={actionLabel} onAction={onAction} busy={isBusy} buttonRef={actionRef} />
      {!returnLeads && returnButton}
    </div>
  )
}
