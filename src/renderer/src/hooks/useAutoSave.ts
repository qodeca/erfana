/**
 * Auto-save Hook for Markdown Editor
 *
 * Provides debounced auto-save functionality with configurable delay.
 * Triggers save after user stops editing for the specified delay period.
 *
 * @module useAutoSave
 */

import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Configuration options for useAutoSave hook
 */
export interface UseAutoSaveOptions {
  /** Delay in milliseconds before auto-save triggers (default: 2000) */
  delay?: number
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean
}

/**
 * Return type for useAutoSave hook
 */
export interface UseAutoSaveReturn {
  /** Whether an auto-save is currently in progress */
  isAutoSaving: boolean
  /** Set the auto-saving state (for external control) */
  setIsAutoSaving: (value: boolean) => void
  /** Cancel any pending auto-save */
  cancelAutoSave: () => void
}

/**
 * Hook for auto-saving content with debouncing.
 *
 * Automatically triggers save after the user stops making changes
 * for the specified delay period. Handles cleanup on unmount.
 *
 * @param isModified - Whether the content has unsaved changes
 * @param onSave - Callback to execute when auto-save triggers
 * @param options - Configuration options
 * @returns Auto-save state and controls
 *
 * @example
 * ```tsx
 * function Editor({ content, onSave }) {
 *   const [isModified, setIsModified] = useState(false)
 *
 *   const { isAutoSaving } = useAutoSave(
 *     isModified,
 *     async () => {
 *       await saveContent(content)
 *       setIsModified(false)
 *     },
 *     { delay: 2000 }
 *   )
 *
 *   return (
 *     <div>
 *       {isAutoSaving && <span>Auto-saving...</span>}
 *       <textarea onChange={(e) => {
 *         setContent(e.target.value)
 *         setIsModified(true)
 *       }} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useAutoSave(
  isModified: boolean,
  onSave: () => void | Promise<void>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn {
  const { delay = 2000, enabled = true } = options

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  // Use useState instead of useRef for isAutoSaving to trigger re-renders (fixes stale closure bug)
  const [isAutoSaving, setIsAutoSavingState] = useState(false)

  // Use ref pattern to avoid stale closures and infinite re-renders from onSave
  // This prevents issues when parent doesn't memoize the callback
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  /**
   * Cancel any pending auto-save timer
   */
  const cancelAutoSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /**
   * Set auto-saving state (for external control)
   */
  const setIsAutoSaving = useCallback((value: boolean) => {
    setIsAutoSavingState(value)
  }, [])

  // Schedule auto-save when content is modified
  useEffect(() => {
    // Clear existing timer
    cancelAutoSave()

    // Only auto-save if enabled and content is modified
    if (enabled && isModified) {
      timerRef.current = setTimeout(() => {
        // Use ref to get latest onSave without adding it to dependencies
        onSaveRef.current()
      }, delay)
    }

    // Cleanup timer on unmount or dependency change
    return cancelAutoSave
  }, [isModified, delay, enabled, cancelAutoSave])

  return {
    isAutoSaving,
    setIsAutoSaving,
    cancelAutoSave
  }
}
