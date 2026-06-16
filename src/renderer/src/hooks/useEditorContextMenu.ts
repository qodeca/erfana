// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Editor Context Menu Hook
 *
 * Manages the state and handlers for the Monaco editor's custom context menu.
 * Provides cut, copy (via EditorContextMenu), and paste functionality.
 *
 * @module useEditorContextMenu
 */

import { useState, useEffect, useCallback } from 'react'
import {
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  buildMonacoClipboardDeps
} from '../utils/monacoClipboardCommands'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

/**
 * Position and content data for the editor context menu.
 */
export interface EditorContextMenuState {
  /** X coordinate (pixels from viewport left) */
  x: number
  /** Y coordinate (pixels from viewport top) */
  y: number
  /** Currently selected text in editor */
  selectedText: string
  /** Start line number of selection */
  startLine: number
  /** End line number of selection */
  endLine: number
}

/**
 * Configuration options for useEditorContextMenu hook.
 */
export interface UseEditorContextMenuOptions {
  /** Reference to the Monaco editor instance */
  editorRef: React.RefObject<MonacoEditorHandle | null>
}

/**
 * Return type for useEditorContextMenu hook.
 */
export interface UseEditorContextMenuReturn {
  /** Current context menu state, or null if closed */
  editorContextMenu: EditorContextMenuState | null
  /** Handler to open context menu with position and selection data */
  handleEditorContextMenu: (event: EditorContextMenuState) => void
  /** Handler to close the context menu */
  handleCloseEditorContextMenu: () => void
  /** Handler for copy action (writes the live selection to the clipboard) */
  handleEditorCopy: () => Promise<void>
  /** Handler for cut action (deletes selection only after a successful copy) */
  handleEditorCut: () => Promise<void>
  /** Handler for paste action (inserts clipboard content) */
  handleEditorPaste: () => Promise<void>
}

/**
 * Hook for managing Monaco editor context menu state and actions.
 *
 * Provides handlers for opening/closing the context menu and for
 * copy/cut/paste operations. All three clipboard actions delegate to the shared
 * pure commands in `monacoClipboardCommands.ts` against the LIVE editor, so the
 * menu path and the keybinding path cannot diverge.
 *
 * @param options - Configuration options including editor ref
 * @returns Context menu state and action handlers
 *
 * @example Basic usage in MarkdownEditorPanel
 * ```tsx
 * function MarkdownEditorPanel() {
 *   const editorRef = useRef<MonacoEditorHandle>(null)
 *
 *   const {
 *     editorContextMenu,
 *     handleEditorContextMenu,
 *     handleCloseEditorContextMenu,
 *     handleEditorCut,
 *     handleEditorPaste
 *   } = useEditorContextMenu({ editorRef })
 *
 *   return (
 *     <>
 *       <MonacoMarkdownEditor
 *         ref={editorRef}
 *         onContextMenu={handleEditorContextMenu}
 *       />
 *       {editorContextMenu && (
 *         <EditorContextMenu
 *           x={editorContextMenu.x}
 *           y={editorContextMenu.y}
 *           selectedText={editorContextMenu.selectedText}
 *           onClose={handleCloseEditorContextMenu}
 *           onCut={handleEditorCut}
 *           onPaste={handleEditorPaste}
 *         />
 *       )}
 *     </>
 *   )
 * }
 * ```
 */
export function useEditorContextMenu(
  options: UseEditorContextMenuOptions
): UseEditorContextMenuReturn {
  const { editorRef } = options

  // Context menu state: null when closed, object with position/selection when open
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null)

  // Cleanup context menu state on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      setEditorContextMenu(null)
    }
  }, [])

  /**
   * Open the context menu at the specified position with selection data.
   * Called by Monaco editor's onContextMenu event.
   */
  const handleEditorContextMenu = useCallback((event: EditorContextMenuState) => {
    setEditorContextMenu({
      x: event.x,
      y: event.y,
      selectedText: event.selectedText,
      startLine: event.startLine,
      endLine: event.endLine
    })
  }, [])

  /**
   * Close the context menu.
   * Called on Escape key, click outside, or after action execution.
   */
  const handleCloseEditorContextMenu = useCallback(() => {
    setEditorContextMenu(null)
  }, [])

  /**
   * Handle copy action from the context menu.
   *
   * Delegates to the shared pure `clipboardCopy` so copy uses the LIVE selection
   * range (`getValueInRange`) and the same collapsed-selection guard as the
   * keybinding path — no stale `selectedText` snapshot. Transport errors
   * (logging/toast) are owned by the central clipboard service.
   */
  const handleEditorCopy = useCallback(async () => {
    const editor = editorRef.current?.getEditor()
    const monaco = editorRef.current?.getMonaco()
    if (!editor || !monaco) return

    await clipboardCopy(buildMonacoClipboardDeps(editor, monaco))
  }, [editorRef])

  /**
   * Handle cut action from the context menu.
   *
   * Delegates to the shared pure `clipboardCut` so the write-guards-delete
   * invariant (selection is deleted ONLY when the clipboard write succeeds) is
   * identical to the keybinding path. Transport errors (logging/toast) are
   * owned by the central clipboard service.
   */
  const handleEditorCut = useCallback(async () => {
    const editor = editorRef.current?.getEditor()
    const monaco = editorRef.current?.getMonaco()
    if (!editor || !monaco) return

    await clipboardCut(buildMonacoClipboardDeps(editor, monaco))
  }, [editorRef])

  /**
   * Handle paste action from the context menu.
   *
   * Delegates to the shared pure `clipboardPaste` so cursor/read-only/empty
   * semantics match the keybinding path. The service resolves `''` on failure,
   * which is treated as a no-op; transport errors are owned by the service.
   */
  const handleEditorPaste = useCallback(async () => {
    const editor = editorRef.current?.getEditor()
    const monaco = editorRef.current?.getMonaco()
    if (!editor || !monaco) return

    await clipboardPaste(buildMonacoClipboardDeps(editor, monaco))
  }, [editorRef])

  return {
    editorContextMenu,
    handleEditorContextMenu,
    handleCloseEditorContextMenu,
    handleEditorCopy,
    handleEditorCut,
    handleEditorPaste
  }
}
