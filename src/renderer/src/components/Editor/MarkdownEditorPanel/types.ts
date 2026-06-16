// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared Types for MarkdownEditorPanel
 *
 * Contains type definitions used across multiple hooks and components
 * within the MarkdownEditorPanel module.
 *
 * @module MarkdownEditorPanel/types
 */

/**
 * View mode for the markdown editor panel.
 *
 * Determines the layout and visible panes:
 * - `editor`: Editor only (no preview)
 * - `preview`: Preview only (no editor)
 * - `split`: Vertical split (editor left, preview right)
 * - `split-horizontal`: Horizontal split (preview top, editor bottom)
 */
export type ViewMode = 'split' | 'split-horizontal' | 'editor' | 'preview'

/**
 * State for the editor context menu.
 *
 * Stores the position and context for the right-click context menu
 * in the Monaco editor.
 */
export interface EditorContextMenuState {
  /** X coordinate of the menu position (relative to viewport) */
  x: number
  /** Y coordinate of the menu position (relative to viewport) */
  y: number
  /** Text that was selected when context menu was triggered */
  selectedText: string
  /** Starting line number of the selection (1-indexed) */
  startLine: number
  /** Ending line number of the selection (1-indexed) */
  endLine: number
}

/**
 * Represents a file currently open in the editor.
 */
export interface EditorFile {
  /** Absolute path to the file */
  path: string
  /** Current content of the file in the editor */
  content: string
  /** Whether the file has unsaved modifications */
  modified: boolean
}
