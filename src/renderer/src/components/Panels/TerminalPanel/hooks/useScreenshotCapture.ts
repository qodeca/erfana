// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot Capture Hook
 *
 * Cross-platform screenshot capture for the terminal panel: full-screen,
 * window, and area modes. Owns the platform-detection, display + window
 * enumeration, and the IPC choreography of the picker dialogs.
 *
 * @module TerminalPanel/hooks/useScreenshotCapture
 * @see Issue #86 - original macOS screenshot capture
 * @see Issue #164 - Windows Phase 3 parity (cross-platform, window picker)
 */

import { useState, useEffect, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  showWarningToast,
  showErrorToast,
  showSuccessToast,
  showInfoToast
} from '../../../../utils/toastHelpers'
import { escapePathForShell, type ShellKind } from '../../../../utils/shellPathEscape'
import { getBasename } from '../../../../utils/fileUtils'
import { logger } from '../../../../utils/logger'
import type { ScreenshotCaptureMode, DisplayInfo, WindowSource } from '../types'

/**
 * Platform default quoting flavour, used when no terminal is active yet or
 * when the shellKind ref hasn't been populated. Windows defaults to
 * `'powershell'` because PowerShell is the modern default shell on Windows
 * 10+ (#164 round-2 F#30 — pre-round-2 this defaulted to `'cmd'` which
 * mis-quotes paths for the dominant shell).
 */
function platformDefaultShellKind(): ShellKind {
  return window.api.utils.getPlatform() === 'win32' ? 'powershell' : 'posix'
}

/**
 * Configuration options for the useScreenshotCapture hook.
 */
export interface UseScreenshotCaptureOptions {
  /** Ref to current terminal ID */
  terminalIdRef: React.RefObject<string | null>
  /**
   * Ref to the active terminal's quoting flavour, populated from the
   * `terminal:create` response. `null` when no terminal is active; falls
   * back to {@link platformDefaultShellKind} during capture in that case
   * (#164 round-2 F#1, F#7).
   */
  shellKindRef: React.RefObject<ShellKind | null>
  /** Ref to xterm instance (for focus after capture) */
  xtermRef: React.RefObject<Terminal | null>
}

/**
 * Return type for the useScreenshotCapture hook.
 */
export interface UseScreenshotCaptureReturn {
  /**
   * Whether the runtime platform supports screenshot capture.
   * Was `isMacOS` at #86; renamed at #164 once Windows shipped.
   */
  isScreenshotSupported: boolean
  /** True on macOS, where the platform uses its native window picker. */
  hasNativeWindowPicker: boolean
  /** Current capture mode in progress, or null if not capturing */
  capturingMode: ScreenshotCaptureMode | null
  /** Available displays for multi-monitor selection */
  displays: DisplayInfo[]
  /** Enumerated capturable windows (populated when window picker opens) */
  windowSources: WindowSource[]
  /** Whether the screen selection dialog is open */
  showScreenSelectDialog: boolean
  setShowScreenSelectDialog: (show: boolean) => void
  /** Whether the window picker dialog is open (cross-platform window mode) */
  showWindowPickerDialog: boolean
  setShowWindowPickerDialog: (show: boolean) => void
  /** Refresh displays list (called before showing selection) */
  refreshDisplays: () => Promise<DisplayInfo[]>
  /** Refresh window sources (called before opening window picker) */
  refreshWindowSources: () => Promise<WindowSource[]>
  /** Handle screenshot capture */
  handleScreenshot: (
    mode: ScreenshotCaptureMode,
    options?: { displayId?: number; windowId?: string }
  ) => Promise<void>
}

/**
 * Hook for managing screenshot capture functionality (cross-platform).
 *
 * Provides:
 * - Platform detection (`isScreenshotSupported`)
 * - Multi-monitor display detection
 * - Window enumeration for the picker dialog (Windows / Linux)
 * - Screen / window / area capture modes
 * - Path insertion into terminal after capture
 *
 * @param options - Configuration options
 * @returns Screenshot capture state and handlers
 *
 * @example
 * ```tsx
 * const { isScreenshotSupported, capturingMode, handleScreenshot } = useScreenshotCapture({
 *   terminalIdRef,
 *   xtermRef
 * })
 *
 * if (isScreenshotSupported) {
 *   <button onClick={() => handleScreenshot('screen')}>Capture Screen</button>
 * }
 * ```
 */
export function useScreenshotCapture(
  options: UseScreenshotCaptureOptions
): UseScreenshotCaptureReturn {
  const { terminalIdRef, shellKindRef, xtermRef } = options

  const [isScreenshotSupported, setIsScreenshotSupported] = useState(false)
  const [hasNativeWindowPicker, setHasNativeWindowPicker] = useState(false)
  const [capturingMode, setCapturingMode] = useState<ScreenshotCaptureMode | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [windowSources, setWindowSources] = useState<WindowSource[]>([])
  const [showScreenSelectDialog, setShowScreenSelectDialog] = useState(false)
  const [showWindowPickerDialog, setShowWindowPickerDialog] = useState(false)

  // Consult main for platform capabilities on mount (#164 lens-review F[31]).
  // Replaces the previous `getPlatform()` branch — keeping the platform
  // routing single-sourced in `ScreenshotService.computeCapabilities`.
  useEffect(() => {
    let cancelled = false
    window.api.screenshot.getCapabilities().then((capabilities) => {
      if (cancelled) return
      setIsScreenshotSupported(capabilities.supported)
      setHasNativeWindowPicker(capabilities.hasNativeWindowPicker)

      if (capabilities.supported) {
        window.api.screenshot.getDisplays().then((result) => {
          if (cancelled) return
          setDisplays(result.displays)
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshDisplays = useCallback(async (): Promise<DisplayInfo[]> => {
    const result = await window.api.screenshot.getDisplays()
    setDisplays(result.displays)
    return result.displays
  }, [])

  const refreshWindowSources = useCallback(async (): Promise<WindowSource[]> => {
    const result = await window.api.screenshot.enumerateWindows()
    setWindowSources(result.sources)
    if (result.truncated) {
      logger.warn('Window source list was truncated', { count: result.sources.length })
    }
    return result.sources
  }, [])

  const handleScreenshot = useCallback(
    async (
      mode: ScreenshotCaptureMode,
      captureOptions?: { displayId?: number; windowId?: string }
    ): Promise<void> => {
      // Capture terminal ID at click time to ensure we paste to the correct
      // terminal even if the user switches terminals during interactive
      // window / area selection.
      const capturedTerminalId = terminalIdRef.current

      if (!capturedTerminalId) {
        showWarningToast('No terminal', 'Open a terminal first')
        return
      }

      setCapturingMode(mode)

      try {
        // Build the discriminated-union request per mode (#164 Phase 3,
        // round-2 D4). The IPC schema rejects shape mismatches at validation,
        // so each branch supplies exactly the fields its variant expects.
        // Window mode splits on `hasNativeWindowPicker`: macOS uses the
        // native picker (no windowId), Windows uses the in-app picker
        // (windowId required).
        let request: import('../../../../../../shared/ipc/screenshot-schema').ScreenshotCaptureRequest
        if (mode === 'screen') {
          request = { mode, displayId: captureOptions?.displayId }
        } else if (mode === 'area') {
          request = { mode }
        } else if (hasNativeWindowPicker) {
          request = { mode: 'window-native' }
        } else {
          // The toolbar gates this branch on prior `enumerateWindows` + picker
          // selection, so `captureOptions.windowId` is populated here. Guard
          // defensively so a renderer bug surfaces as a clear toast rather
          // than an IPC validation failure.
          if (!captureOptions?.windowId) {
            showWarningToast('Window picker required', 'Choose a window from the picker first')
            return
          }
          request = { mode: 'window', windowId: captureOptions.windowId }
        }
        const result = await window.api.screenshot.capture(request)

        if (!result.success) {
          // Exhaustive switch (#164 lens-review F[12]): adding a new
          // `ScreenshotErrorCode` without a renderer branch is a TS error
          // because the default arm assigns `errorCode` to `never`.
          switch (result.errorCode) {
            case 'SCREENSHOT_CANCELLED':
              return
            case 'SCREENSHOT_TIMEOUT':
              showErrorToast('Timeout', 'Screenshot capture timed out after 30 seconds')
              return
            case 'SCREENSHOT_PERMISSION_DENIED':
              showErrorToast(
                'Permission required',
                'Grant screen recording permission in System Settings > Privacy & Security'
              )
              return
            case 'SCREENSHOT_WINDOW_NOT_FOUND':
              showErrorToast('Window unavailable', 'The selected window is no longer available')
              return
            case 'SCREENSHOT_DISPLAY_NOT_FOUND':
              showErrorToast('Display unavailable', 'The selected display is no longer available')
              return
            case 'SCREENSHOT_OVERLAY_FAILED':
              showErrorToast('Overlay failed', 'Could not open the area-selection overlay')
              return
            case 'SCREENSHOT_NOT_SUPPORTED':
              showErrorToast('Not supported', 'Screenshot capture is not supported on this platform')
              return
            case 'SCREENSHOT_FAILED':
            case undefined:
              showErrorToast('Capture failed', result.error || 'Unknown error')
              return
            default: {
              const _exhaustive: never = result.errorCode
              showErrorToast('Capture failed', result.error || 'Unknown error')
              return _exhaustive
            }
          }
        }

        // Verify terminal still exists after capture completes
        const currentTerminalId = terminalIdRef.current
        if (!currentTerminalId) {
          showInfoToast('Terminal closed', `Screenshot saved to: ${result.filePath}`)
          return
        }

        if (!result.filePath) {
          logger.error('Screenshot succeeded but no file path returned')
          showErrorToast('Capture error', 'Screenshot saved but path unavailable')
          return
        }

        // Paste path to terminal with shell-aware escaping (#164):
        // POSIX shells get single-quote wrap, cmd.exe gets double-quote wrap,
        // PowerShell gets single-quote wrap with doubled-quote escape.
        // shellKind is provided by the `terminal:create` response and stored
        // on the ref by TerminalPanel; if the ref is unpopulated (e.g. a
        // mid-restart race) fall back to the platform default.
        const shellKind = shellKindRef.current ?? platformDefaultShellKind()
        const quotedPath = escapePathForShell(result.filePath, shellKind)
        await window.api.terminal.write(currentTerminalId, quotedPath)

        const filename = getBasename(result.filePath) || 'screenshot.png'
        showSuccessToast('Screenshot captured', filename)

        xtermRef.current?.focus()
      } catch (error) {
        showErrorToast('Error', 'Screenshot capture failed unexpectedly')
        logger.error('Screenshot capture error', error instanceof Error ? error : undefined)
      } finally {
        setCapturingMode(null)
      }
    },
    [terminalIdRef, shellKindRef, xtermRef, hasNativeWindowPicker]
  )

  return {
    isScreenshotSupported,
    hasNativeWindowPicker,
    capturingMode,
    displays,
    windowSources,
    showScreenSelectDialog,
    setShowScreenSelectDialog,
    showWindowPickerDialog,
    setShowWindowPickerDialog,
    refreshDisplays,
    refreshWindowSources,
    handleScreenshot
  }
}
