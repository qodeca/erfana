// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FilePickerDialog Component
 *
 * Modal dialog for selecting a file from multiple candidates.
 * Used by smart file path resolution when multiple files match a query.
 *
 * Features:
 * - Keyboard navigation (Arrow Up/Down)
 * - Enter to select, Escape to cancel
 * - Cmd/Ctrl+C to copy selected file path
 * - Click to select
 * - Shows relative path from project root
 * - VS Code-style design
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import type { PathScore } from '../../utils/pathScoring'
import { getRelativePath } from '../../utils/pathScoring'
import { textClipboard } from '../../services/textClipboard'
import './FilePickerDialog.css'

export interface FilePickerDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Callback to close the dialog */
  onClose: () => void
  /** Callback when a file is selected */
  onSelect: (path: string) => void
  /** Ranked list of file candidates */
  candidates: PathScore[]
  /** The original search query */
  query: string
  /** Project root for displaying relative paths */
  projectRoot: string | null
  /** Z-index for stacking */
  zIndex?: number
}

/**
 * Extract just the filename from a path
 */
function getFilename(path: string): string {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sep >= 0 ? path.slice(sep + 1) : path
}

export function FilePickerDialog({
  isOpen,
  onClose,
  onSelect,
  candidates,
  query,
  projectRoot,
  zIndex = 1000
}: FilePickerDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset selection when candidates change
  useEffect(() => {
    setSelectedIndex(0)
  }, [candidates])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && isOpen) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLElement
      // scrollIntoView may not be available in test environments (JSDOM)
      if (selectedItem && typeof selectedItem.scrollIntoView === 'function') {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex, isOpen])

  // Copy selected file path to clipboard
  const handleCopyPath = useCallback(() => {
    if (candidates[selectedIndex]) {
      const path = candidates[selectedIndex].path
      // Transport errors handled centrally by the service (issue #203). Result
      // intentionally ignored — copy has nothing to roll back.
      void textClipboard.writeText(path)
    }
  }, [candidates, selectedIndex])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Copy path with Cmd/Ctrl+C
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        handleCopyPath()
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, candidates.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (candidates[selectedIndex]) {
            onSelect(candidates[selectedIndex].path)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [candidates, selectedIndex, onSelect, onClose, handleCopyPath]
  )

  // Handle item click
  const handleItemClick = useCallback(
    (path: string) => {
      onSelect(path)
    },
    [onSelect]
  )

  if (candidates.length === 0) {
    return null
  }

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onClose}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      className="file-picker-dialog"
      ariaLabelledBy="file-picker-title"
    >
      <div className="dialog-content" onKeyDown={handleKeyDown} tabIndex={-1} data-testid={TEST_IDS.FILE_PICKER}>
        <h2 id="file-picker-title" className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>
          Multiple files match &quot;{getFilename(query)}&quot;
        </h2>

        <p className="dialog-subtitle">Select the file you want to open:</p>

        <ul ref={listRef} className="file-picker-list" role="listbox" aria-activedescendant={`file-item-${selectedIndex}`} data-testid={TEST_IDS.FILE_PICKER_LIST}>
          {candidates.map((candidate, index) => {
            const filename = getFilename(candidate.path)
            const relativePath = projectRoot
              ? getRelativePath(candidate.path, projectRoot)
              : candidate.path
            const isSelected = index === selectedIndex

            return (
              <li
                key={candidate.path}
                id={`file-item-${index}`}
                className={`file-picker-item ${isSelected ? 'selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleItemClick(candidate.path)}
                onMouseEnter={() => setSelectedIndex(index)}
                data-testid={getDynamicTestId(TEST_IDS.FILE_PICKER_ITEM, candidate.path)}
              >
                <span className="file-picker-filename">{filename}</span>
                <span className="file-picker-path">{relativePath}</span>
              </li>
            )
          })}
        </ul>

        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={onClose} data-testid={TEST_IDS.FILE_PICKER_BTN_CANCEL}>
            Cancel
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
