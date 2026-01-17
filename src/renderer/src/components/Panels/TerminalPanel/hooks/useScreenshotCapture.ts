/**
 * Screenshot Capture Hook
 *
 * Handles macOS screenshot capture functionality for the terminal panel.
 * Supports screen, window, and area capture modes with multi-monitor support.
 *
 * @module TerminalPanel/hooks/useScreenshotCapture
 * @see Issue #86 - Terminal screenshot capture
 */

import { useState, useEffect, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  showWarningToast,
  showErrorToast,
  showSuccessToast,
  showInfoToast
} from '../../../../utils/toastHelpers'
import { escapePathForShell } from '../../../../utils/shellPathEscape'
import { logger } from '../../../../utils/logger'
import type { ScreenshotCaptureMode, DisplayInfo } from '../types'

/**
 * Configuration options for the useScreenshotCapture hook.
 */
export interface UseScreenshotCaptureOptions {
  /** Ref to current terminal ID */
  terminalIdRef: React.RefObject<string | null>
  /** Ref to xterm instance (for focus after capture) */
  xtermRef: React.RefObject<Terminal | null>
}

/**
 * Return type for the useScreenshotCapture hook.
 */
export interface UseScreenshotCaptureReturn {
  /** Whether running on macOS (screenshot only available on macOS) */
  isMacOS: boolean
  /** Current capture mode in progress, or null if not capturing */
  capturingMode: ScreenshotCaptureMode | null
  /** Available displays for multi-monitor selection */
  displays: DisplayInfo[]
  /** Whether the screen selection dialog is open */
  showScreenSelectDialog: boolean
  /** Set screen selection dialog visibility */
  setShowScreenSelectDialog: (show: boolean) => void
  /** Refresh displays list (called before showing selection) */
  refreshDisplays: () => Promise<DisplayInfo[]>
  /** Handle screenshot capture */
  handleScreenshot: (mode: ScreenshotCaptureMode, displayId?: number) => Promise<void>
}

/**
 * Hook for managing macOS screenshot capture functionality.
 *
 * Provides:
 * - Platform detection (macOS only)
 * - Multi-monitor display detection
 * - Screen, window, and area capture modes
 * - Path insertion into terminal after capture
 *
 * @param options - Configuration options
 * @returns Screenshot capture state and handlers
 *
 * @example
 * ```tsx
 * const {
 *   isMacOS,
 *   capturingMode,
 *   handleScreenshot
 * } = useScreenshotCapture({
 *   terminalIdRef,
 *   xtermRef
 * })
 *
 * if (isMacOS) {
 *   <button onClick={() => handleScreenshot('screen')}>
 *     Capture Screen
 *   </button>
 * }
 * ```
 */
export function useScreenshotCapture(
  options: UseScreenshotCaptureOptions
): UseScreenshotCaptureReturn {
  const { terminalIdRef, xtermRef } = options

  const [isMacOS, setIsMacOS] = useState(false)
  const [capturingMode, setCapturingMode] = useState<ScreenshotCaptureMode | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [showScreenSelectDialog, setShowScreenSelectDialog] = useState(false)

  // Check platform on mount and fetch initial displays for macOS
  useEffect(() => {
    const platform = window.api.utils.getPlatform()
    const isMac = platform === 'darwin'
    setIsMacOS(isMac)

    // Initial fetch of displays (macOS only)
    if (isMac) {
      window.api.screenshot.getDisplays().then((result) => {
        setDisplays(result.displays)
      })
    }
  }, [])

  /**
   * Refresh displays list from the system.
   * Call before showing multi-monitor selection dialog.
   */
  const refreshDisplays = useCallback(async (): Promise<DisplayInfo[]> => {
    const result = await window.api.screenshot.getDisplays()
    setDisplays(result.displays)
    return result.displays
  }, [])

  /**
   * Handle screenshot capture.
   *
   * Captures the terminal ID at click time, invokes the screenshot service,
   * and pastes the resulting path to the terminal. Handles various error
   * conditions including permission denial, timeout, and terminal closure.
   *
   * @param mode - Screenshot capture mode: 'screen', 'window', or 'area'
   * @param displayId - Optional display ID for 'screen' mode (multi-monitor support)
   */
  const handleScreenshot = useCallback(
    async (mode: ScreenshotCaptureMode, displayId?: number): Promise<void> => {
      // Capture terminal ID at click time to ensure we paste to the correct terminal
      // even if user switches terminals during interactive window/area selection
      const capturedTerminalId = terminalIdRef.current

      if (!capturedTerminalId) {
        showWarningToast('No terminal', 'Open a terminal first')
        return
      }

      setCapturingMode(mode)

      try {
        const result = await window.api.screenshot.capture({ mode, displayId })

        if (!result.success) {
          if (result.errorCode === 'SCREENSHOT_CANCELLED') {
            // Silent - user cancelled intentionally (pressed Escape)
            return
          } else if (result.errorCode === 'SCREENSHOT_TIMEOUT') {
            showErrorToast('Timeout', 'Screenshot capture timed out after 30 seconds')
          } else if (result.errorCode === 'SCREENSHOT_PERMISSION_DENIED') {
            showErrorToast(
              'Permission required',
              'Grant screen recording permission in System Settings > Privacy & Security'
            )
          } else {
            showErrorToast('Capture failed', result.error || 'Unknown error')
          }
          return
        }

        // Verify terminal still exists after capture completes
        const currentTerminalId = terminalIdRef.current
        if (!currentTerminalId) {
          // Terminal closed during capture - show full path in toast for manual copy
          showInfoToast('Terminal closed', `Screenshot saved to: ${result.filePath}`)
          return
        }

        // Validate filePath exists (should always be present on success, but check defensively)
        if (!result.filePath) {
          logger.error('Screenshot succeeded but no file path returned')
          showErrorToast('Capture error', 'Screenshot saved but path unavailable')
          return
        }

        // Paste path to terminal with shell-safe escaping (single quotes)
        // Uses same escaping as drag-drop for consistency
        const quotedPath = escapePathForShell(result.filePath)
        await window.api.terminal.write(currentTerminalId, quotedPath)

        // Show success toast with filename only (not full path)
        const filename = result.filePath.split('/').pop() || 'screenshot.png'
        showSuccessToast('Screenshot captured', filename)

        // Return focus to terminal after capture
        xtermRef.current?.focus()
      } catch (error) {
        showErrorToast('Error', 'Screenshot capture failed unexpectedly')
        logger.error('Screenshot capture error', error instanceof Error ? error : undefined)
      } finally {
        setCapturingMode(null)
      }
    },
    [terminalIdRef, xtermRef]
  )

  return {
    isMacOS,
    capturingMode,
    displays,
    showScreenSelectDialog,
    setShowScreenSelectDialog,
    refreshDisplays,
    handleScreenshot
  }
}
