// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Move, Copy, FileInput, X } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import type { DropModeDialogConfig, DropModeDialogResult, DropMode } from './types'

/**
 * Props for the DropModeDialog component
 */
interface DropModeDialogProps {
  /** Configuration for the dialog */
  config: DropModeDialogConfig
  /** Z-index for stacking order */
  zIndex: number
  /** Called when user selects a mode */
  onSelect: (result: DropModeDialogResult) => void
  /** Called when user cancels */
  onCancel: () => void
}

/**
 * DropModeDialog - Allows user to choose how to handle dropped external files
 *
 * Shown when files are dropped from outside the application onto the project tree.
 * Provides three options:
 * - Move: Move files from source location (removes originals)
 * - Copy: Copy files (keeps originals)
 * - Import: Import with additional processing (future feature)
 *
 * @param props - Component props
 * @returns Rendered dialog or null if not open
 *
 * @example
 * ```typescript
 * const { showDropMode } = useDialog()
 * const result = await showDropMode({ fileCount: 3 })
 * if (result) {
 *   console.log('Selected mode:', result.mode)
 * }
 * ```
 */
export function DropModeDialog({
  config,
  zIndex,
  onSelect,
  onCancel
}: DropModeDialogProps) {
  const { id, fileCount, fileName, showImport = true } = config

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  /**
   * Handle mode selection
   * Calls onSelect with the chosen mode
   */
  const handleModeSelect = (mode: DropMode) => {
    onSelect({ mode })
  }

  /**
   * Handle keyboard navigation
   * Enter confirms the focused button
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let buttons handle their own Enter key
    if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) {
      return
    }
  }

  // Build description message based on file count
  const description = fileCount === 1 && fileName
    ? `Choose how to add "${fileName}" to your project:`
    : `Choose how to add ${fileCount} file${fileCount > 1 ? 's' : ''} to your project:`

  return (
    <BaseDialog
      isOpen={true}
      onClose={onCancel}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div onKeyDown={handleKeyDown} data-testid={TEST_IDS.EXTERNAL_DROP_DIALOG}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <FileInput size={20} strokeWidth={2} />
          </div>
          <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>
            Add files
          </h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message">
            {description}
          </p>
        </div>

        <div className="dialog-drop-mode-options">
          <button
            className="dialog-drop-mode-btn"
            onClick={() => handleModeSelect('move')}
            autoFocus
            data-testid={TEST_IDS.EXTERNAL_DROP_MOVE_BUTTON}
          >
            <Move size={18} strokeWidth={2} />
            <span className="dialog-drop-mode-btn-label">Move</span>
            <span className="dialog-drop-mode-btn-description">
              Move files here (removes from original location)
            </span>
          </button>

          <button
            className="dialog-drop-mode-btn"
            onClick={() => handleModeSelect('copy')}
            data-testid={TEST_IDS.EXTERNAL_DROP_COPY_BUTTON}
          >
            <Copy size={18} strokeWidth={2} />
            <span className="dialog-drop-mode-btn-label">Copy</span>
            <span className="dialog-drop-mode-btn-description">
              Copy files here (keeps originals)
            </span>
          </button>

          {showImport && (
            <button
              className="dialog-drop-mode-btn"
              onClick={() => handleModeSelect('import')}
              data-testid={TEST_IDS.EXTERNAL_DROP_IMPORT_BUTTON}
            >
              <FileInput size={18} strokeWidth={2} />
              <span className="dialog-drop-mode-btn-label">Import</span>
              <span className="dialog-drop-mode-btn-description">
                Import and process files
              </span>
            </button>
          )}
        </div>

        <div className="dialog-actions">
          <button
            className="dialog-btn dialog-btn-secondary"
            onClick={onCancel}
            data-testid={TEST_IDS.EXTERNAL_DROP_CANCEL_BUTTON}
          >
            <X size={14} strokeWidth={2} />
            Cancel
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
