// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { AlertTriangle, Replace, FilePlus2 } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import type { ConflictDialogConfig, ConflictDialogResult } from './types'

/**
 * Props for the ConflictDialog component
 */
interface ConflictDialogProps {
  /** Configuration for the dialog */
  config: ConflictDialogConfig
  /** Z-index for stacking order */
  zIndex: number
  /** Called when user selects a resolution */
  onSelect: (result: ConflictDialogResult) => void
  /** Called when user cancels (skips this file) */
  onCancel: () => void
}

/**
 * ConflictDialog - Resolves file naming conflicts during file operations
 *
 * Shown when a file with the same name already exists at the target location.
 * Provides two options:
 * - Replace: Overwrite the existing file
 * - Keep both: Rename the new file to avoid conflict
 *
 * Cancel/Skip allows skipping this particular file in batch operations.
 *
 * @param props - Component props
 * @returns Rendered dialog or null if not open
 *
 * @example
 * ```typescript
 * const { showConflict } = useDialog()
 * const result = await showConflict({
 *   fileName: 'document.md',
 *   targetPath: '/project/docs/document.md'
 * })
 * if (result) {
 *   if (result.resolution === 'replace') {
 *     // Overwrite existing file
 *   } else {
 *     // Generate unique name and copy
 *   }
 * } else {
 *   // User cancelled, skip this file
 * }
 * ```
 */
export function ConflictDialog({
  config,
  zIndex,
  onSelect,
  onCancel
}: ConflictDialogProps) {
  const { id, fileName } = config

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  /**
   * Handle resolution selection
   */
  const handleSelect = (resolution: 'replace' | 'keepBoth') => {
    onSelect({ resolution })
  }

  /**
   * Handle keyboard navigation
   * Enter confirms the focused button
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) {
      return
    }
  }

  return (
    <BaseDialog
      isOpen={true}
      onClose={onCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div onKeyDown={handleKeyDown} data-testid={TEST_IDS.CONFLICT_DIALOG}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon dialog-icon-warning">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>
          <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>
            File already exists
          </h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message">
            A file named <strong className="dialog-filename">&quot;{fileName}&quot;</strong> already exists in this location.
          </p>
        </div>

        <div className="dialog-actions">
          <button
            className="dialog-btn dialog-btn-secondary"
            onClick={onCancel}
            data-testid={TEST_IDS.CONFLICT_CANCEL_BUTTON}
          >
            Skip
          </button>
          <button
            className="dialog-btn dialog-btn-secondary dialog-btn-with-icon"
            onClick={() => handleSelect('keepBoth')}
            data-testid={TEST_IDS.CONFLICT_KEEP_BOTH_BUTTON}
          >
            <FilePlus2 size={14} strokeWidth={2} />
            Keep both
          </button>
          <button
            className="dialog-btn dialog-btn-danger dialog-btn-with-icon"
            onClick={() => handleSelect('replace')}
            autoFocus
            data-testid={TEST_IDS.CONFLICT_REPLACE_BUTTON}
          >
            <Replace size={14} strokeWidth={2} />
            Replace
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
