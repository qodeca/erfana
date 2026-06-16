// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selection helper utilities for extracting selected text from various sources.
 *
 * Provides functions to get selected text from Monaco editor, DOM selection,
 * or both with fallback logic. Used by search feature to populate initial query.
 *
 * @module selectionHelpers
 */

import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

/**
 * Gets selected text from Monaco editor or DOM selection.
 *
 * Tries Monaco editor first (if ref provided), falls back to DOM selection.
 * Returns undefined if no text is selected or selection is whitespace-only.
 *
 * @param editorRef - Optional ref to Monaco editor handle
 * @returns Selected text trimmed, or undefined if nothing selected
 *
 * @example Get selection with Monaco fallback to DOM
 * ```tsx
 * const selectedText = getSelectedText(editorRef)
 * if (selectedText) {
 *   searchStore.openSearch(selectedText)
 * }
 * ```
 */
export function getSelectedText(
  editorRef?: React.RefObject<MonacoEditorHandle | null>
): string | undefined {
  // Try Monaco editor first
  if (editorRef?.current) {
    const editor = editorRef.current.getEditor()
    if (editor) {
      const selection = editor.getSelection()
      const model = editor.getModel()
      if (selection && model && !selection.isEmpty()) {
        const text = model.getValueInRange(selection)
        if (text.trim()) return text
      }
    }
  }

  // Fall back to DOM selection (for preview pane)
  const domSelection = window.getSelection()?.toString().trim()
  return domSelection || undefined
}

/**
 * Gets selected text from Monaco editor only.
 *
 * Does not fall back to DOM selection. Returns undefined if no editor ref,
 * no editor instance, no selection, or selection is whitespace-only.
 *
 * @param editorRef - Ref to Monaco editor handle
 * @returns Selected text trimmed, or undefined if nothing selected
 *
 * @example Get Monaco-only selection
 * ```tsx
 * const text = getEditorSelection(editorRef)
 * if (text) {
 *   console.log('Selected in editor:', text)
 * }
 * ```
 */
export function getEditorSelection(
  editorRef: React.RefObject<MonacoEditorHandle | null>
): string | undefined {
  if (!editorRef?.current) return undefined

  const editor = editorRef.current.getEditor()
  if (!editor) return undefined

  const selection = editor.getSelection()
  const model = editor.getModel()

  if (selection && model && !selection.isEmpty()) {
    const text = model.getValueInRange(selection)
    return text.trim() || undefined
  }

  return undefined
}

/**
 * Gets selected text from DOM selection (preview pane).
 *
 * Uses window.getSelection() to get text selected in the DOM.
 * Returns undefined if no selection or selection is whitespace-only.
 *
 * @returns Selected text trimmed, or undefined if nothing selected
 *
 * @example Get DOM-only selection
 * ```tsx
 * const text = getPreviewSelection()
 * if (text) {
 *   console.log('Selected in preview:', text)
 * }
 * ```
 */
export function getPreviewSelection(): string | undefined {
  const selection = window.getSelection()?.toString().trim()
  return selection || undefined
}
