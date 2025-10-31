import { BaseDialog } from './BaseDialog'
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
 * - Confirm/Cancel buttons
 * - Danger mode for destructive actions
 * - Keyboard shortcuts (Enter to confirm, Esc to cancel)
 * - Promise-based API via useDialog()
 *
 * @example
 * ```typescript
 * const { showConfirm } = useDialog()
 * const confirmed = await showConfirm({
 *   title: 'Delete File',
 *   message: 'Are you sure?',
 *   danger: true
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
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div onKeyDown={handleKeyDown}>
        <div className="dialog-header">
          <h3 id={titleId} className="dialog-title">{title}</h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message">{message}</p>
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={handleCancel}>
            {cancelLabel}
          </button>
          <button
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}
            onClick={handleConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
