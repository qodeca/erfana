/**
 * Editor Context Menu Hook
 *
 * Manages the state and handlers for the Monaco editor's custom context menu.
 * Provides cut, copy (via EditorContextMenu), and paste functionality.
 *
 * @module useEditorContextMenu
 */

import { useState, useEffect, useCallback } from 'react'
import { logger } from '../utils/logger'
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
  /** Handler for cut action (deletes selection after copy) */
  handleEditorCut: () => void
  /** Handler for paste action (inserts clipboard content) */
  handleEditorPaste: () => Promise<void>
}

/**
 * Hook for managing Monaco editor context menu state and actions.
 *
 * Provides handlers for opening/closing the context menu and for
 * cut/paste operations. Copy is handled directly by EditorContextMenu
 * using the selectedText from the menu state.
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
   * Handle cut action from context menu.
   * Deletes the current selection (clipboard copy is done by EditorContextMenu).
   */
  const handleEditorCut = useCallback(() => {
    const editor = editorRef.current?.getEditor()
    if (!editor) return

    const selection = editor.getSelection()
    if (!selection || selection.isEmpty()) return

    // Delete selected text by replacing with empty string
    editor.executeEdits('context-menu-cut', [
      { range: selection, text: '' }
    ])
  }, [editorRef])

  /**
   * Handle paste action from context menu.
   * Reads clipboard and inserts at current cursor/selection.
   */
  const handleEditorPaste = useCallback(async () => {
    const editor = editorRef.current?.getEditor()
    if (!editor) return

    try {
      const clipboardText = await navigator.clipboard.readText()
      if (!clipboardText) return

      const selection = editor.getSelection()
      if (!selection) return

      // Replace selection (or insert at cursor) with clipboard content
      editor.executeEdits('context-menu-paste', [
        { range: selection, text: clipboardText }
      ])
    } catch (error) {
      logger.error('Failed to paste from clipboard', error instanceof Error ? error : undefined)
    }
  }, [editorRef])

  return {
    editorContextMenu,
    handleEditorContextMenu,
    handleCloseEditorContextMenu,
    handleEditorCut,
    handleEditorPaste
  }
}
