// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Drag & Drop Hook
 *
 * Handles external file drag-and-drop onto the terminal panel.
 * Files dropped on the terminal have their paths inserted at the cursor.
 *
 * Uses document-level event listeners with capture phase to intercept
 * events before they reach xterm.js DOM elements.
 *
 * @module TerminalPanel/hooks/useTerminalDragDrop
 * @see Issue #85 - Drag-drop file path insertion
 */

import { useState, useRef, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../../../../stores/useTerminalStore'
import { showWarningToast } from '../../../../utils/toastHelpers'
import { formatPathsForTerminal } from '../../../../utils/shellPathEscape'
import { isPointInElement } from '../../../../utils/domGeometry'
import { logger } from '../../../../utils/logger'
import type { DragHandlerRefs } from '../types'

/**
 * Configuration options for the useTerminalDragDrop hook.
 */
export interface UseTerminalDragDropOptions {
  /** Ref to the terminal panel element (for hit testing) */
  terminalPanelRef: React.RefObject<Element | null>
  /** Ref to current terminal ID */
  terminalIdRef: React.RefObject<string | null>
  /** Ref to xterm instance (for focus after drop) */
  xtermRef: React.RefObject<Terminal | null>
  /** Whether drag-drop is enabled */
  enabled: boolean
}

/**
 * Return type for the useTerminalDragDrop hook.
 */
export interface UseTerminalDragDropReturn {
  /** Whether the terminal is currently a drop target */
  isDropTarget: boolean
  /** Set drop target state directly (for testing) */
  setIsDropTarget: React.Dispatch<React.SetStateAction<boolean>>
  /** Attach drag handlers to document */
  attachDragHandlers: () => void
  /** Remove drag handlers from document */
  cleanupDragHandlers: () => void
  /** Ref to drag handler functions (for cleanup registry) */
  dragHandlersRef: React.RefObject<DragHandlerRefs | null>
}

/**
 * Hook for managing terminal drag-and-drop file path insertion.
 *
 * Provides document-level drag event handlers that:
 * - Detect when files are dragged over the terminal panel
 * - Show drop target visual feedback
 * - Insert file paths on drop
 * - Focus terminal after successful drop
 *
 * @param options - Configuration options
 * @returns Drag-drop state and control functions
 *
 * @example
 * ```tsx
 * const { isDropTarget, attachDragHandlers, cleanupDragHandlers } = useTerminalDragDrop({
 *   terminalPanelRef,
 *   terminalIdRef,
 *   xtermRef,
 *   enabled: true
 * })
 *
 * // In initializeTerminal:
 * attachDragHandlers()
 *
 * // In cleanup:
 * cleanupDragHandlers()
 * ```
 */
export function useTerminalDragDrop(
  options: UseTerminalDragDropOptions
): UseTerminalDragDropReturn {
  const { terminalPanelRef, terminalIdRef, xtermRef, enabled } = options

  const [isDropTarget, setIsDropTarget] = useState(false)
  const dragHandlersRef = useRef<DragHandlerRefs | null>(null)

  /**
   * Remove all drag event handlers from document.
   * Safe to call multiple times.
   */
  const cleanupDragHandlers = useCallback(() => {
    if (dragHandlersRef.current) {
      document.removeEventListener('dragover', dragHandlersRef.current.dragover, { capture: true })
      document.removeEventListener('dragenter', dragHandlersRef.current.dragenter, { capture: true })
      document.removeEventListener('dragleave', dragHandlersRef.current.dragleave, { capture: true })
      document.removeEventListener('drop', dragHandlersRef.current.drop, { capture: true })
      document.removeEventListener('dragend', dragHandlersRef.current.dragend, { capture: true })
      dragHandlersRef.current = null
    }
  }, [])

  /**
   * Attach drag event handlers to document.
   * Uses capture phase to intercept before xterm.js handlers.
   */
  const attachDragHandlers = useCallback(() => {
    if (!enabled) return
    if (dragHandlersRef.current) {
      // Already attached - cleanup first
      cleanupDragHandlers()
    }

    const terminalPanel = terminalPanelRef.current

    /**
     * Check if drag coordinates are over the terminal panel.
     */
    const isOverTerminalPanel = (e: DragEvent): boolean => {
      return isPointInElement(e.clientX, e.clientY, terminalPanel)
    }

    /**
     * Handle dragover - allow drop if over terminal with files.
     */
    const nativeDragOver = (e: DragEvent): void => {
      if (!isOverTerminalPanel(e)) return
      if (!e.dataTransfer?.types.includes('Files')) return

      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    /**
     * Handle dragenter - show drop target state.
     */
    const nativeDragEnter = (e: DragEvent): void => {
      if (!isOverTerminalPanel(e)) return
      if (!e.dataTransfer?.types.includes('Files')) return

      e.preventDefault()
      setIsDropTarget(true)
      logger.info('External drag entered terminal panel')
    }

    /**
     * Handle dragleave - hide drop target state when leaving panel.
     */
    const nativeDragLeave = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return

      // Check if we're still over the terminal panel
      if (isOverTerminalPanel(e)) return
      setIsDropTarget(false)
    }

    /**
     * Handle drop - extract file paths and insert into terminal.
     */
    const nativeDrop = async (e: DragEvent): Promise<void> => {
      if (!isOverTerminalPanel(e)) return
      if (!e.dataTransfer?.files.length) return

      e.preventDefault()
      setIsDropTarget(false)

      if (!terminalIdRef.current) return

      // Use webUtils.getPathForFile via preload API (File.path not available in sandbox)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => {
          try {
            return window.api.utils.getPathForFile(f)
          } catch (err) {
            logger.warn('Failed to get path for dropped file', {
              fileName: f.name,
              error: err instanceof Error ? err.message : String(err)
            })
            return null
          }
        })
        .filter((p): p is string => Boolean(p))

      if (paths.length === 0) {
        logger.warn('External drop: no valid file paths found')
        return
      }

      logger.info('External file drop on terminal', { pathCount: paths.length, paths })

      const formattedPaths = formatPathsForTerminal(paths)

      try {
        const success = await useTerminalStore.getState().sendToTerminal(formattedPaths, false)

        if (!success) {
          showWarningToast('Drop failed', 'Could not insert path into terminal')
          return
        }

        xtermRef.current?.focus()
      } catch (err) {
        logger.error('Failed to send dropped paths to terminal', err instanceof Error ? err : undefined)
        showWarningToast('Drop failed', 'Error inserting path into terminal')
      }
    }

    /**
     * Handle dragend - cleanup drop target state when drag cancelled.
     */
    const nativeDragEnd = (): void => {
      setIsDropTarget(false)
    }

    // Use capture phase to intercept before any other handlers
    document.addEventListener('dragover', nativeDragOver, { capture: true })
    document.addEventListener('dragenter', nativeDragEnter, { capture: true })
    document.addEventListener('dragleave', nativeDragLeave, { capture: true })
    document.addEventListener('drop', nativeDrop, { capture: true })
    document.addEventListener('dragend', nativeDragEnd, { capture: true })

    dragHandlersRef.current = {
      dragover: nativeDragOver,
      dragenter: nativeDragEnter,
      dragleave: nativeDragLeave,
      drop: nativeDrop,
      dragend: nativeDragEnd
    }
  }, [enabled, terminalPanelRef, terminalIdRef, xtermRef, cleanupDragHandlers])

  return {
    isDropTarget,
    setIsDropTarget,
    attachDragHandlers,
    cleanupDragHandlers,
    dragHandlersRef
  }
}
