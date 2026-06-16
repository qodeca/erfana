// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keyboard Shortcuts Hook
 *
 * Manages global keyboard shortcuts for the markdown editor panel.
 * Handles Cmd/Ctrl+S (save) and Cmd/Ctrl+W (close tab with confirmation).
 *
 * @module useKeyboardShortcuts
 */

import { useEffect, useRef } from 'react'
import { isMacOS } from '../utils/platform'

/**
 * Configuration for confirmation dialog.
 * Subset of ConfirmDialogConfig from Dialog framework.
 */
export interface ConfirmOptions {
  /** Dialog title */
  title: string
  /** Dialog message */
  message: string
  /** Label for confirm button */
  confirmLabel?: string
  /** Apply danger styling */
  danger?: boolean
}

/**
 * Configuration options for useKeyboardShortcuts hook.
 */
export interface UseKeyboardShortcutsOptions {
  /** Callback to save the current file */
  onSave: () => void
  /** Callback to close the current tab/panel */
  onClose: () => void
  /** Whether the file has unsaved changes */
  isModified: boolean
  /** Function to show confirmation dialog, returns true if confirmed */
  showConfirm: (options: ConfirmOptions) => Promise<boolean>
  /** Current file name (for dialog message) */
  fileName: string | null
}

/**
 * Hook for handling editor keyboard shortcuts.
 *
 * Intercepts Cmd/Ctrl+S for save and Cmd/Ctrl+W for close tab.
 * Close tab shows confirmation dialog if there are unsaved changes.
 *
 * @param options - Configuration including callbacks and state
 *
 * @example Basic usage in editor panel
 * ```tsx
 * function MarkdownEditorPanel() {
 *   const { showConfirm } = useDialog()
 *   const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
 *
 *   const handleSave = useCallback(() => {
 *     // Save logic here
 *   }, [currentFile])
 *
 *   const handleClose = useCallback(() => {
 *     props.api.close()
 *   }, [props.api])
 *
 *   useKeyboardShortcuts({
 *     onSave: handleSave,
 *     onClose: handleClose,
 *     isModified: currentFile?.modified ?? false,
 *     showConfirm,
 *     fileName: currentFile?.path ? getBasename(currentFile.path) : null
 *   })
 *
 *   return <Editor />
 * }
 * ```
 *
 * @example With manual save trigger
 * ```tsx
 * useKeyboardShortcuts({
 *   onSave: () => handleSave(false), // false = manual save
 *   onClose: () => panelApi.close(),
 *   isModified: file?.modified ?? false,
 *   showConfirm,
 *   fileName: extractFileName(file?.path)
 * })
 * ```
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  // Use refs to access latest values without re-registering the listener
  // This prevents stale closure issues when options change
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
      // Detect platform for correct modifier key
      const isMac = isMacOS()
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl+S - Save
      if (modKey && e.key === 's' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        optionsRef.current.onSave()
      }

      // Cmd/Ctrl+W - Close tab
      if (modKey && e.key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault()

        const currentOptions = optionsRef.current

        if (currentOptions.isModified) {
          // Show confirmation dialog if unsaved changes
          const confirmed = await currentOptions.showConfirm({
            title: 'Unsaved Changes',
            message: `File "${currentOptions.fileName || 'Untitled'}" has unsaved changes. Close anyway?`,
            confirmLabel: 'Close Without Saving',
            danger: true
          })
          if (confirmed) {
            currentOptions.onClose()
          }
        } else {
          currentOptions.onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // Empty deps - we use refs to avoid stale closures
}
