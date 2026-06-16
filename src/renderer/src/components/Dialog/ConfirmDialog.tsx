// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * - Keyboard shortcuts (Enter to confirm, Esc to cancel)
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
    danger = false
  } = config

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  const handleConfirm = () => {
    onConfirm()
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      handleConfirm()
    }
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
          <button className="dialog-btn dialog-btn-secondary" onClick={handleCancel} data-testid={TEST_IDS.DIALOG_BTN_CANCEL}>
            {cancelLabel}
          </button>
          <button
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}
            onClick={handleConfirm}
            autoFocus
            data-testid={TEST_IDS.DIALOG_BTN_CONFIRM}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
