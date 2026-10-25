// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorLoadError - What an editor tab shows when its file could not be read.
 *
 * Replaces the "No file open" empty state, which used to hide the failure.
 * The tree reuses an open tab, so opening the file again does not reload it:
 * the way out is the "Try again" button here.
 *
 * Screen readers hear the failure from the error toast, which announces it;
 * this box carries no `role="alert"` (docs/design-system/system/components/feedback:
 * an alert role on a box that mounts with its text is unreliable).
 *
 * @module components/Panels/EditorLoadError
 */

// The design-system button (docs/design-system/system/components/button)
import '../Dialog/Dialog.css'

/** Props for {@link EditorLoadError}. */
export interface EditorLoadErrorProps {
  /** Why the file could not be opened (from `formatLoadError`) */
  message: string
  /** Reads the file again */
  onRetry: () => void
}

/**
 * The failed-load state of an editor tab: the reason and a retry.
 *
 * @param props - The reason and the retry
 * @returns The error state, styled as the panel's empty state
 */
export function EditorLoadError({ message, onRetry }: EditorLoadErrorProps): JSX.Element {
  return (
    <div className="editor-empty">
      <p>{message}</p>
      <p className="hint">Check that the file still exists and can be read</p>
      <button type="button" className="dialog-btn dialog-btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
