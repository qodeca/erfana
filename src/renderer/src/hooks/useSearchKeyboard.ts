// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef } from 'react'
import { useSearchStore } from '../stores/useSearchStore'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'
import { getSelectedText } from '../utils/selectionHelpers'
import { isMacOS } from '../utils/platform'

/**
 * Options for the useSearchKeyboard hook.
 */
interface UseSearchKeyboardOptions {
  /** Optional ref to Monaco editor for getting selected text */
  editorRef?: React.RefObject<MonacoEditorHandle | null>
}

/**
 * Hook for handling global search keyboard shortcuts.
 *
 * Listens for Cmd/Ctrl+F at the window level during capture phase
 * to open the search bar. This runs before Monaco's keybinding handler.
 *
 * When an editorRef is provided, selected text from the editor (or DOM
 * fallback) will be used to populate the initial search query.
 *
 * @param options - Optional configuration including editor ref for selection
 *
 * @see ADR-Spec001-001 - Unified search architecture
 * @see FR-012 - Keyboard shortcut triggers search
 *
 * @example Basic usage
 * ```tsx
 * function EditorPanel() {
 *   useSearchKeyboard()
 *   return <div>...</div>
 * }
 * ```
 *
 * @example With editor ref for selection population
 * ```tsx
 * function EditorPanel() {
 *   const editorRef = useRef<MonacoEditorHandle>(null)
 *   useSearchKeyboard({ editorRef })
 *   return <MonacoMarkdownEditor ref={editorRef} />
 * }
 * ```
 */
export function useSearchKeyboard(options?: UseSearchKeyboardOptions): void {
  // Store options in ref to avoid re-registering listener when options change
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Detect platform
      const isMac = isMacOS()
      const modifierKey = isMac ? e.metaKey : e.ctrlKey

      // Check for Cmd/Ctrl+F
      if (modifierKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        e.stopPropagation()

        // Get selected text from editor or DOM fallback
        const selectedText = getSelectedText(optionsRef.current?.editorRef)
        useSearchStore.getState().openSearch(selectedText)
      }
    }

    // Use capture phase to intercept before Monaco sees the event
    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
