// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useFilePicker Hook
 *
 * Provides a Promise-based API for showing the FilePickerDialog.
 * Returns a function that shows the picker and resolves with the selected path.
 *
 * @example
 * ```tsx
 * const { showPicker, pickerProps } = useFilePicker({ projectRoot })
 *
 * // Show picker and wait for selection
 * const selectedPath = await showPicker(candidates, 'Button.tsx')
 * if (selectedPath) {
 *   // User selected a file
 * }
 *
 * // Render the picker
 * <FilePickerDialog {...pickerProps} />
 * ```
 */

import { useState, useCallback, useRef } from 'react'
import type { PathScore } from '../utils/pathScoring'

export interface UseFilePickerOptions {
  /** Project root for displaying relative paths */
  projectRoot: string | null
}

export interface FilePickerState {
  isOpen: boolean
  candidates: PathScore[]
  query: string
}

export interface UseFilePickerReturn {
  /**
   * Show the file picker dialog.
   * Returns a Promise that resolves to the selected path, or null if cancelled.
   */
  showPicker: (candidates: PathScore[], query: string) => Promise<string | null>

  /**
   * Props to spread onto the FilePickerDialog component.
   */
  pickerProps: {
    isOpen: boolean
    onClose: () => void
    onSelect: (path: string) => void
    candidates: PathScore[]
    query: string
    projectRoot: string | null
  }
}

export function useFilePicker(options: UseFilePickerOptions): UseFilePickerReturn {
  const { projectRoot } = options

  const [state, setState] = useState<FilePickerState>({
    isOpen: false,
    candidates: [],
    query: ''
  })

  // Store resolve/reject functions for the current Promise
  const resolveRef = useRef<((value: string | null) => void) | null>(null)

  const showPicker = useCallback(
    (candidates: PathScore[], query: string): Promise<string | null> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve
        setState({
          isOpen: true,
          candidates,
          query
        })
      })
    },
    []
  )

  const handleClose = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }))
    if (resolveRef.current) {
      resolveRef.current(null)
      resolveRef.current = null
    }
  }, [])

  const handleSelect = useCallback((path: string) => {
    setState((prev) => ({ ...prev, isOpen: false }))
    if (resolveRef.current) {
      resolveRef.current(path)
      resolveRef.current = null
    }
  }, [])

  return {
    showPicker,
    pickerProps: {
      isOpen: state.isOpen,
      onClose: handleClose,
      onSelect: handleSelect,
      candidates: state.candidates,
      query: state.query,
      projectRoot
    }
  }
}
