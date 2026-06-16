// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Divider Position Hook
 *
 * Manages the position of resizable dividers in split view mode.
 * Persists positions to localStorage for consistent layout across sessions.
 *
 * @module useDividerPosition
 */

import { useState, useCallback } from 'react'

/** localStorage key for vertical split divider position */
const STORAGE_KEY_VERTICAL = 'markdown-editor-divider-position'

/** localStorage key for horizontal split divider position */
const STORAGE_KEY_HORIZONTAL = 'markdown-editor-divider-position-horizontal'

/** Default divider position as percentage */
const DEFAULT_POSITION = 50

/**
 * Configuration options for useDividerPosition hook.
 */
export interface UseDividerPositionOptions {
  /**
   * Optional callback fired when resize ends.
   * Useful for triggering scroll map rebuild or Monaco layout update.
   */
  onResizeEnd?: () => void
}

/**
 * Return type for useDividerPosition hook.
 */
export interface UseDividerPositionReturn {
  /** Vertical divider position as percentage (0-100) */
  dividerPosition: number
  /** Horizontal divider position as percentage (0-100) */
  dividerPositionHorizontal: number
  /** Handler for vertical divider resize */
  handleDividerResize: (newPosition: number) => void
  /** Handler for horizontal divider resize */
  handleDividerResizeHorizontal: (newPosition: number) => void
  /** Handler called when any resize operation ends */
  handleDividerResizeEnd: () => void
}

/**
 * Load persisted divider position from localStorage.
 *
 * @param key - localStorage key
 * @returns Persisted position or default value
 */
function loadPosition(key: string): number {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const parsed = parseFloat(saved)
      // Validate the value is a reasonable percentage
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        return parsed
      }
    }
  } catch {
    // localStorage may not be available (private browsing, quota exceeded)
    // Silently fall back to default
  }
  return DEFAULT_POSITION
}

/**
 * Save divider position to localStorage.
 *
 * @param key - localStorage key
 * @param position - Position value to save
 */
function savePosition(key: string, position: number): void {
  try {
    localStorage.setItem(key, position.toString())
  } catch {
    // localStorage may not be available (private browsing, quota exceeded)
    // Silently fail - position will be reset on next session
  }
}

/**
 * Hook for managing resizable divider positions in split view layouts.
 *
 * Provides state and handlers for both vertical (side-by-side) and
 * horizontal (top-bottom) split modes. Positions are persisted to
 * localStorage for consistent layout across sessions.
 *
 * @param options - Configuration options
 * @returns Divider positions and resize handlers
 *
 * @example Basic usage in split view editor
 * ```tsx
 * function EditorPanel() {
 *   const {
 *     dividerPosition,
 *     dividerPositionHorizontal,
 *     handleDividerResize,
 *     handleDividerResizeHorizontal,
 *     handleDividerResizeEnd
 *   } = useDividerPosition({
 *     onResizeEnd: () => rebuildScrollMap()
 *   })
 *
 *   return (
 *     <div className="split-view">
 *       <div style={{ width: `${dividerPosition}%` }}>
 *         <Editor />
 *       </div>
 *       <ResizableDivider
 *         orientation="vertical"
 *         onResize={handleDividerResize}
 *         onResizeEnd={handleDividerResizeEnd}
 *       />
 *       <div style={{ width: `${100 - dividerPosition}%` }}>
 *         <Preview />
 *       </div>
 *     </div>
 *   )
 * }
 * ```
 *
 * @example Horizontal split
 * ```tsx
 * <div style={{ height: `${dividerPositionHorizontal}%` }}>
 *   <Preview />
 * </div>
 * <ResizableDivider
 *   orientation="horizontal"
 *   onResize={handleDividerResizeHorizontal}
 *   onResizeEnd={handleDividerResizeEnd}
 * />
 * <div style={{ height: `${100 - dividerPositionHorizontal}%` }}>
 *   <Editor />
 * </div>
 * ```
 */
export function useDividerPosition(
  options: UseDividerPositionOptions = {}
): UseDividerPositionReturn {
  const { onResizeEnd } = options

  // Vertical split divider position (side-by-side: editor | preview)
  const [dividerPosition, setDividerPosition] = useState<number>(() =>
    loadPosition(STORAGE_KEY_VERTICAL)
  )

  // Horizontal split divider position (preview top, editor bottom)
  const [dividerPositionHorizontal, setDividerPositionHorizontal] = useState<number>(() =>
    loadPosition(STORAGE_KEY_HORIZONTAL)
  )

  /**
   * Handle vertical divider resize.
   * Updates state and persists to localStorage.
   */
  const handleDividerResize = useCallback((newPosition: number) => {
    setDividerPosition(newPosition)
    savePosition(STORAGE_KEY_VERTICAL, newPosition)
  }, [])

  /**
   * Handle horizontal divider resize.
   * Updates state and persists to localStorage.
   */
  const handleDividerResizeHorizontal = useCallback((newPosition: number) => {
    setDividerPositionHorizontal(newPosition)
    savePosition(STORAGE_KEY_HORIZONTAL, newPosition)
  }, [])

  /**
   * Handle resize end event.
   * Calls optional onResizeEnd callback for scroll map rebuild, etc.
   */
  const handleDividerResizeEnd = useCallback(() => {
    onResizeEnd?.()
  }, [onResizeEnd])

  return {
    dividerPosition,
    dividerPositionHorizontal,
    handleDividerResize,
    handleDividerResizeHorizontal,
    handleDividerResizeEnd
  }
}
