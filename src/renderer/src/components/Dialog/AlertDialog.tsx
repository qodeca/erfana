// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Info, AlertTriangle } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import type { AlertDialogConfig } from './types'

interface AlertDialogProps {
  config: AlertDialogConfig
  zIndex: number
  onConfirm: () => void
}

/**
 * AlertDialog - Simple alert/notification dialog
 *
 * Features:
 * - Dynamic icon (Info for normal, AlertTriangle for danger)
 * - Single "OK" button
 * - Danger mode for error alerts (red button + warning icon)
 * - Keyboard shortcuts (Enter or Esc to close)
 * - Promise-based API via useDialog()
 *
 * @example
 * ```typescript
 * const { showAlert } = useDialog()
 *
 * // Normal alert (shows Info icon)
 * await showAlert({
 *   title: 'Success',
 *   message: 'File saved successfully'
 * })
 *
 * // Error alert (shows AlertTriangle icon)
 * await showAlert({
 *   title: 'Error',
 *   message: 'Failed to save file',
 *   danger: true
 * })
 * ```
 */
export function AlertDialog({ config, zIndex, onConfirm }: AlertDialogProps) {
  const {
    id,
    title,
    message,
    confirmLabel = 'OK',
    danger = false
  } = config

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  const handleConfirm = () => {
    onConfirm()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleConfirm}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div onKeyDown={handleKeyDown} data-testid={TEST_IDS.DIALOG_ALERT}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            {danger ? (
              <AlertTriangle size={20} strokeWidth={2} />
            ) : (
              <Info size={20} strokeWidth={2} />
            )}
          </div>
          <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>{title}</h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message" data-testid={TEST_IDS.DIALOG_ALERT_MESSAGE}>{message}</p>
        </div>

        <div className="dialog-actions">
          <button
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}
            onClick={handleConfirm}
            autoFocus
            data-testid={TEST_IDS.DIALOG_BTN_OK}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
