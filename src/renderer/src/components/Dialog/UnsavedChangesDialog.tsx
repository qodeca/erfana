// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useRef } from 'react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import { renderIcon } from '../../utils/iconRegistry'
import type { UnsavedChangesDialogConfig, UnsavedChangesDialogResult } from './types'

/**
 * Props for the {@link UnsavedChangesDialog} component.
 */
interface UnsavedChangesDialogProps {
  /** File name and variant; `id` is set by the dialog context */
  config: UnsavedChangesDialogConfig
  /** Z-index for stacking order */
  zIndex: number
  /** Called with the answer the user chose */
  onSelect: (result: UnsavedChangesDialogResult) => void
  /** Called on Cancel and Escape */
  onCancel: () => void
}

/**
 * UnsavedChangesDialog – what to do with another tab's unsaved edits before a
 * preview tab shows that page (issue #124, part 3 §3.6; UX spec §5).
 *
 * Two variants:
 * - `save`: "Save changes to pricing.html?" with Don't save (danger, apart at
 *   the leading edge), Cancel and Save. Save takes first focus.
 * - `conflict` (the file changed on disk): "Discard your changes to
 *   pricing.html?" with Discard my changes (danger) and Cancel. Save is not
 *   offered, because it would overwrite the newer file; Cancel takes focus.
 *
 * FOCUS (RU1). `BaseDialog` focuses the FIRST focusable control unless given
 * `initialFocusRef`, and in this button order that is the destructive one – so
 * the ref is set explicitly, on the choice that loses nothing. There is
 * deliberately no Enter handler: Enter activates whichever button has focus,
 * natively. `ConfirmDialog`'s confirm-on-Enter is not copied, because here it
 * would fire an action the user did not have focused. Escape is Cancel, and a
 * click outside does nothing.
 *
 * @param props - Component props
 * @returns The rendered dialog
 *
 * @example Through the dialog context
 * ```tsx
 * const { showUnsavedChanges } = useDialog()
 * const answer = await showUnsavedChanges({ fileName: 'pricing.html', variant: 'save' })
 * if (answer === 'save') await editorSaveRegistry.save(editorPanelId)
 * ```
 */
export function UnsavedChangesDialog({
  config,
  zIndex,
  onSelect,
  onCancel
}: UnsavedChangesDialogProps): JSX.Element {
  const { id, fileName, variant } = config
  const isConflict = variant === 'conflict'
  const saveRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  return (
    <BaseDialog
      isOpen={true}
      onClose={onCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      trapFocus
      initialFocusRef={isConflict ? cancelRef : saveRef}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div className="dialog-header-with-icon">
        {/* The warning triangle "File already exists" uses (UX §5). */}
        <div className="dialog-icon dialog-icon-warning">
          {renderIcon('alert-triangle', { size: 20, 'aria-hidden': true })}
        </div>
        <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>
          {isConflict
            ? `Discard your changes to ${fileName}?`
            : `Save changes to ${fileName}?`}
        </h3>
      </div>

      <div className="dialog-body">
        <p id={messageId} className="dialog-message">
          {isConflict
            ? `${fileName} changed on disk while another tab had unsaved changes to it. ` +
              'Showing it here closes that tab and keeps the version on disk.'
            : `${fileName} is open in another tab with unsaved changes. ` +
              "Showing it here closes that tab – if you don't save, the changes are lost."}
        </p>
      </div>

      <div className="dialog-actions">
        {/* The destructive choice sits apart at the leading edge (the macOS
            alert layout), so it is never next to the safe default. Erfana uses
            this one button order on every platform. */}
        <div className="dialog-actions-left">
          <button
            type="button"
            className="dialog-btn dialog-btn-danger"
            onClick={() => onSelect('discard')}
          >
            {isConflict ? 'Discard my changes' : "Don't save"}
          </button>
        </div>
        <button
          ref={cancelRef}
          type="button"
          className="dialog-btn dialog-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        {!isConflict && (
          <button
            ref={saveRef}
            type="button"
            className="dialog-btn dialog-btn-primary"
            onClick={() => onSelect('save')}
          >
            Save
          </button>
        )}
      </div>
    </BaseDialog>
  )
}
