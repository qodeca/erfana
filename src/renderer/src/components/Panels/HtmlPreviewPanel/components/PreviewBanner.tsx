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
 * @module HtmlPreviewPanel/components/PreviewBanner
 */

import { useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'

/** Props for {@link PreviewBanner}. */
export interface PreviewBannerProps {
  /** The headline sentence describing the state. */
  message: string
  /** Label of the primary action button. */
  actionLabel: string
  /** Primary action handler. */
  onAction: () => void
  /** Disables the button while an action is in flight. */
  isBusy?: boolean
  /**
   * Move keyboard focus to the action button when the banner mounts (UX-008).
   * Used by the failed state so a keyboard user lands on Reload; left off for
   * limit-reached, which is not a recovery a user is mid-flow in.
   */
  autoFocusAction?: boolean
}

/**
 * Renders a centered banner with a message and a single primary action.
 *
 * @param props - Message, action label, handler and optional busy flag.
 * @returns The rendered banner.
 *
 * @example
 * ```tsx
 * <PreviewBanner
 *   message="A preview is already open."
 *   actionLabel="Open as source"
 *   onAction={openAsSource}
 * />
 * ```
 */
export function PreviewBanner({
  message,
  actionLabel,
  onAction,
  isBusy = false,
  autoFocusAction = false
}: PreviewBannerProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Move focus to the action on mount when asked (UX-008). An effect, not the
  // native `autoFocus` attribute, so it re-runs if the banner remounts.
  useEffect(() => {
    if (autoFocusAction) buttonRef.current?.focus()
  }, [autoFocusAction])

  return (
    <div className="html-preview-banner" role="alert">
      <AlertCircle size={32} aria-hidden="true" />
      <span className="html-preview-banner-message">{message}</span>
      <button
        ref={buttonRef}
        type="button"
        className="html-preview-banner-button"
        onClick={onAction}
        disabled={isBusy}
      >
        {actionLabel}
      </button>
    </div>
  )
}
