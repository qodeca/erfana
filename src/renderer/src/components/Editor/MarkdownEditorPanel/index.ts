// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MarkdownEditorPanel Module
 *
 * Provides the markdown editor panel component with live preview,
 * scroll synchronization, and file management.
 *
 * @module MarkdownEditorPanel
 */

// Types
export type { ViewMode, EditorContextMenuState, EditorFile } from './types'

// Components
export { MarkdownToolbar } from './components/MarkdownToolbar'
export type { MarkdownToolbarProps } from './components/MarkdownToolbar'

// Hooks
export { useScrollSync } from './hooks'
export type { UseScrollSyncOptions, UseScrollSyncReturn } from './hooks'
