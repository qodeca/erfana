// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useRef, useEffect, useCallback, ReactNode } from 'react'
import { Info } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { CharacterCount } from '../shared'
import { TextareaContextMenu } from '../ContextMenu/TextareaContextMenu'
import { useTextareaClipboard } from '../../hooks/useTextareaClipboard'
import { validateFileSystemName, ValidationErrorCode } from '../../utils/fileValidation'

/** Max length for file/folder names (silent paste reject rule). */
const FILE_NAME_MAX_LENGTH = 255

interface FileSystemDialogProps {
  id?: string
  title: string
  icon: ReactNode
  itemType: 'file' | 'folder'
  operation: 'create' | 'rename'
  parentPath: string
  currentName?: string
  inputPlaceholder?: string
  existingNames?: string[]
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * FileSystemDialog - Base component for file system operations
 *
 * Consolidates common logic from NewFileDialog, NewFolderDialog, and RenameDialog.
 * Provides validation, keyboard shortcuts, and consistent UI.
 *
 * Features:
 * - Shared validation logic via fileValidation.ts
 * - Auto-focus with optional select-all (for rename)
 * - Character counter and inline validation errors
 * - Keyboard shortcuts tooltip (Enter to submit, Esc to cancel)
 * - Configurable icon, labels, and operation type
 *
 * @example
 * ```typescript
 * <FileSystemDialog
 *   id="dialog-123"
 *   title="Create New File"
 *   icon={<File size={20} strokeWidth={2} />}
 *   itemType="file"
 *   operation="create"
 *   parentPath="/project/docs"
 *   inputPlaceholder="notes.md"
 *   existingNames={['README.md']}
 *   zIndex={10001}
 *   onSubmit={(name) => console.log('Created:', name)}
 *   onCancel={() => console.log('Cancelled')}
 * />
 * ```
 */
export function FileSystemDialog({
  id,
  title,
  icon,
  itemType,
  operation,
  parentPath,
  currentName,
  inputPlaceholder,
  existingNames = [],
  zIndex,
  onSubmit,
  onCancel
}: FileSystemDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const [inputValue, setInputValue] = useState(currentName || '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const contextId = `dialog-context-${id}`

  // Auto-focus input and select text for rename operations
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      if (operation === 'rename') {
        inputRef.current.select()
      }
    }
  }, [operation])

  // Validation function using shared utilities with error code system
  const validateInput = useCallback(
    (value: string): boolean => {
      const result = validateFileSystemName(value, existingNames, {
        currentName: operation === 'rename' ? currentName : undefined
      })

      if (result.success) {
        setValidationError(null)
        return true
      }

      // Customize error message based on item type and error code
      let errorMessage = result.message
      if (result.code === ValidationErrorCode.EMPTY) {
        errorMessage = itemType === 'file' ? 'File name cannot be empty' : 'Folder name cannot be empty'
      } else if (result.code === ValidationErrorCode.DUPLICATE) {
        errorMessage =
          itemType === 'file'
            ? 'A file with this name already exists'
            : 'A folder with this name already exists'
      }

      setValidationError(errorMessage)
      return false
    },
    [itemType, operation, currentName, existingNames]
  )

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (validateInput(trimmed)) {
      onSubmit(trimmed)
    }
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)

    // Clear validation error when user types
    if (validationError) {
      setValidationError(null)
    }
  }

  // Track selection changes for context menu state
  const handleSelect = useCallback(() => {
    if (inputRef.current) {
      const { selectionStart, selectionEnd } = inputRef.current
      setHasSelection(selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd)
    }
  }, [])

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
    handleSelect()
  }, [handleSelect])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Clipboard operations via the central textClipboard service (issue #203).
  // The hook supports HTMLInputElement and preserves cursor position; the
  // 255-char limit stays a silent product rule (no toast).
  const { handleCut, handleCopy, handlePaste } = useTextareaClipboard({
    textareaRef: inputRef,
    value: inputValue,
    setValue: setInputValue,
    maxLength: FILE_NAME_MAX_LENGTH
  })

  // Derive labels and text based on operation and item type
  const inputLabel = operation === 'rename' ? 'New name:' : `${itemType === 'file' ? 'File' : 'Folder'} name:`
  const primaryButtonText = operation === 'rename' ? 'Rename' : 'Create'
  const tooltipAction = operation === 'rename' ? 'rename' : 'create'

  const trimmedLength = inputValue.trim().length
  // Button should be disabled if there's a validation error or input is empty/too long
  const isValid = validationError === null && trimmedLength > 0 && trimmedLength <= 255

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={contextId}
      className="dialog-rename"
    >
      <div>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">{icon}</div>
          <h3 id={titleId} className="dialog-title">
            {title}
          </h3>
        </div>

        <div className="dialog-body">
          <div id={contextId} className="dialog-rename-context">
            in {parentPath}
          </div>

          <div className="dialog-rename-input-section">
            <label className="dialog-input-label">{inputLabel}</label>
            <input
              ref={inputRef}
              type="text"
              className={`dialog-rename-input ${validationError ? 'error' : ''}`}
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
              onSelect={handleSelect}
              placeholder={inputPlaceholder}
              maxLength={255}
            />

            {validationError && <div className="dialog-rename-validation-error">{validationError}</div>}
          </div>
        </div>

        <div className="dialog-actions">
          {/* Info icon with tooltip - keyboard accessible */}
          <div className="dialog-actions-left">
            <div className="dialog-info-wrapper">
              <button
                type="button"
                className="dialog-info-icon"
                aria-label="View keyboard shortcuts"
                onFocus={() => setShowTooltip(true)}
                onBlur={() => setShowTooltip(false)}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                <Info size={16} strokeWidth={2} />
              </button>
              <div
                className={`dialog-tooltip ${showTooltip ? 'visible' : ''}`}
                role="tooltip"
                aria-hidden={!showTooltip}
              >
                <div className="dialog-tooltip-content">
                  <kbd>Enter</kbd> to {tooltipAction}
                  <br />
                  <kbd>Esc</kbd> to cancel
                </div>
              </div>
            </div>
            <CharacterCount charCount={trimmedLength} maxLength={255} />
          </div>
          <button className="dialog-btn dialog-btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleSubmit} disabled={!isValid}>
            {primaryButtonText}
          </button>
        </div>
      </div>

      {/* Context menu for input clipboard operations */}
      {contextMenu && (
        <TextareaContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={hasSelection}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onClose={handleCloseContextMenu}
        />
      )}
    </BaseDialog>
  )
}
