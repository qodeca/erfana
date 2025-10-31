import { BaseDialog } from './BaseDialog'
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
 * - Single "OK" button
 * - Keyboard shortcuts (Enter or Esc to close)
 * - Promise-based API via useDialog()
 *
 * @example
 * ```typescript
 * const { showAlert } = useDialog()
 * await showAlert({
 *   title: 'Success',
 *   message: 'File saved successfully'
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
