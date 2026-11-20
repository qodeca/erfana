// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, useState } from 'react'
import { HelpCircle, AlertTriangle } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import type { ConfirmDialogConfig } from './types'

interface ConfirmDialogProps {
  config: ConfirmDialogConfig
  zIndex: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * ConfirmDialog - Yes/No confirmation dialog
 *
 * Features:
 * - Dynamic icon (HelpCircle for normal, AlertTriangle for danger)
 * - Confirm/Cancel buttons
 * - Danger mode for destructive actions (red button + warning icon)
 * - Initial focus on the choice that loses nothing: Cancel when `danger`,
 *   Confirm otherwise
 * - Enter follows the focused button; with focus off the buttons it confirms
 *   a non-danger prompt and does nothing on a danger one. Esc cancels
 * - Opt-in click guard (`confirmArmDelayMs`): Confirm ignores every press and
 *   shows the Buttons card's blocked look (`aria-disabled`, still focusable)
 *   until the delay has passed, so a double-click on the button that opened
 *   a follow-up question cannot answer it
 * - Promise-based API via useDialog()
 *
 * @example
 * ```typescript
 * const { showConfirm } = useDialog()
 * const confirmed = await showConfirm({
 *   title: 'Delete File',
 *   message: 'Are you sure?',
 *   danger: true  // Shows AlertTriangle icon and red button
 * })
 * if (confirmed) deleteFile()
 * ```
 */
export function ConfirmDialog({ config, zIndex, onConfirm, onCancel }: ConfirmDialogProps) {
  const {
    id,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    confirmArmDelayMs = 0
  } = config

  // Fixed for the dialog's life: the guard runs once, from when it opens
  const [armed, setArmed] = useState(() => confirmArmDelayMs <= 0)
  useEffect(() => {
    if (armed) return
    const timer = setTimeout(() => setArmed(true), confirmArmDelayMs)
    return () => clearTimeout(timer)
  }, [armed, confirmArmDelayMs])

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  const handleConfirm = () => {
    if (!armed) return
    onConfirm()
  }

  const handleCancel = () => {
    onCancel()
  }

  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Enter must never pick an answer the focused control does not show. A
  // focused button activates natively on Enter, so the wrapper only steps in
  // when focus is somewhere else in the dialog (e.g. the container itself).
  // Auto-repeat is swallowed everywhere, buttons included: a key held down
  // from whatever opened the prompt must not run into an answer – for a
  // destructive prompt that answer would be delete, discard or quit.
  //
  // The off-button fallback confirms only for non-danger prompts. Nothing
  // focusable sits outside the buttons today, but a link or checkbox added to
  // a message later must not turn Enter into delete, discard or quit.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return

    if (e.repeat) {
      e.preventDefault()
      return
    }

    if (e.target instanceof HTMLButtonElement || danger) return

    e.preventDefault()
    handleConfirm()
  }

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
      initialFocusRef={danger ? cancelRef : confirmRef}
    >
      <div onKeyDown={handleKeyDown} data-testid={TEST_IDS.DIALOG_CONFIRM}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            {danger ? (
              <AlertTriangle size={20} strokeWidth={2} />
            ) : (
              <HelpCircle size={20} strokeWidth={2} />
            )}
          </div>
          <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>{title}</h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message" data-testid={TEST_IDS.DIALOG_CONFIRM_MESSAGE}>{message}</p>
        </div>

        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="dialog-btn dialog-btn-secondary"
            onClick={handleCancel}
            data-testid={TEST_IDS.DIALOG_BTN_CANCEL}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}
            onClick={handleConfirm}
            aria-disabled={armed ? undefined : 'true'}
            data-testid={TEST_IDS.DIALOG_BTN_CONFIRM}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
