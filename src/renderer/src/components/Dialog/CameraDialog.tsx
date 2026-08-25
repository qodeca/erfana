// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CameraDialog Component
 *
 * Modal dialog for camera photo capture. Provides live preview from the user's
 * camera, device selection for multiple cameras, and single-frame photo capture.
 *
 * Features:
 * - Live video preview (16:9, letterboxed to show the whole captured frame)
 * - Optional per-camera preview mirroring (preview only; the saved JPEG is
 *   never mirrored)
 * - Device selector dropdown for multi-camera systems
 * - Shutter animation on capture
 * - Keyboard navigation (Escape to close; Enter captures only as the native
 *   activation of a focused Capture button — the dialog-level Enter handler
 *   bails out for every focusable control, so there is no dialog-wide
 *   "press Enter anywhere to capture" shortcut)
 * - Error handling with refresh capability
 * - Accessibility support (ARIA labels, focus trap)
 *
 * @see Spec #014 - Camera photo capture specification
 * @see Issue #86 enhancement - Camera integration with terminal
 */

import { memo, useId, useState, useCallback, useEffect, useRef } from 'react'
import { Camera, AlertCircle, Loader2, RefreshCw, CameraOff } from 'lucide-react'
import { useCameraCapture } from '../../hooks/useCameraCapture'
import { useCameraMirrorPreference } from '../../hooks/useCameraMirrorPreference'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import { logger } from '../../utils/logger'
import './CameraDialog.css'

/**
 * State the camera can be in, as far as the status live region cares.
 */
interface CameraStatusInputs {
  /** A camera error is currently displayed (its own `role="alert"` region). */
  hasError: boolean
  /** No camera hardware was found. */
  showEmptyState: boolean
  /** The stream is still coming up. */
  showLoading: boolean
  /** The preview is live and the capture controls are enabled. */
  isPreviewActive: boolean
}

/**
 * Text the persistent status live region should be carrying right now.
 *
 * Returns `''` for states that another region already announces, or that have
 * nothing to say — an empty live region is silent, which is the point of
 * keeping it mounted.
 *
 * The error case is deliberately empty: the error block carries `role="alert"`,
 * and duplicating the message here would make every failure double-speak.
 *
 * @param inputs - Current camera state
 * @returns The announcement text, or `''` for nothing to announce
 *
 * @example
 * ```ts
 * getCameraStatusMessage({
 *   hasError: false,
 *   showEmptyState: false,
 *   showLoading: false,
 *   isPreviewActive: true
 * }) // => 'Camera ready'
 * ```
 */
function getCameraStatusMessage({
  hasError,
  showEmptyState,
  showLoading,
  isPreviewActive
}: CameraStatusInputs): string {
  if (hasError) return ''
  if (showEmptyState) return 'No camera detected. Connect a camera and choose Refresh.'
  if (showLoading) return 'Starting camera...'
  // Terminal state, and the one the old markup could never announce: it
  // UNMOUNTED the loading region instead of emptying it, so the moment the
  // Capture button and the mirror checkbox became enabled was announced by
  // nothing at all.
  if (isPreviewActive) return 'Camera ready'
  return ''
}

/**
 * Props for the CameraDialog component.
 */
interface CameraDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean
  /** Called when dialog should close (Cancel, Escape, backdrop click) */
  onClose: () => void
  /** Called with captured photo file path when capture succeeds */
  onCapture: (filePath: string) => void
}

/**
 * Modal dialog for capturing photos from the user's camera.
 *
 * Opens with a live preview from the default camera. If multiple cameras
 * are available, shows a device selector dropdown. Captures the current
 * frame when the user activates Capture — by click, or by Enter/Space while
 * Capture itself holds focus.
 *
 * @param props - Component props
 * @returns Rendered dialog or null if not open
 *
 * @example
 * ```tsx
 * <CameraDialog
 *   isOpen={isCameraDialogOpen}
 *   onClose={() => setIsCameraDialogOpen(false)}
 *   onCapture={(filePath) => {
 *     setIsCameraDialogOpen(false)
 *     insertPathToTerminal(filePath)
 *   }}
 * />
 * ```
 */
export const CameraDialog = memo(function CameraDialog({
  isOpen,
  onClose,
  onCapture
}: CameraDialogProps) {
  // Unique id for the status live region. `useId()` rather than a literal
  // because two TerminalPanels can each have a CameraDialog mounted, and a
  // duplicated id would make `aria-describedby` resolve to the wrong region.
  const statusRegionId = `camera-dialog-status-${useId()}`

  // Video element ref for capture
  const videoRef = useRef<HTMLVideoElement>(null)
  // Preferred initial-focus target. Focus RECOVERY (a control that loses focus
  // to nowhere because it just became disabled) is BaseDialog's job, via the
  // `trapFocus` focusout rescue — no per-control onBlur here.
  const captureButtonRef = useRef<HTMLButtonElement>(null)
  // Where BaseDialog's focusout rescue should send focus. Refresh only exists
  // in the error state; BaseDialog ignores an empty/detached ref and falls back
  // to the first focusable control, so this can be passed unconditionally.
  // Without it the rescue lands on the device `<select>` at the TOP of the
  // dialog, where the user's next arrow key silently switches camera and
  // restarts the stream — the opposite of what a disconnect calls for.
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  // Shutter-animation timer id. Tracked so the effect below can clear it on
  // unmount — otherwise the 200ms callback fires on a disposed React tree
  // (see #159: vitest teardown produced "ReferenceError: window is not defined").
  const shutterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Shutter animation state
  const [isShutterActive, setIsShutterActive] = useState(false)

  // Loading state for initial camera startup
  const [isLoading, setIsLoading] = useState(false)

  // Text currently inside the status live region. Held in state, and written
  // from an EFFECT rather than derived inline, purely so the text lands in a
  // LATER commit than the region itself: assistive tech announces CHANGES to a
  // live region, not content that was already there when the region appeared.
  // Rendering `<div role="status">Starting camera...</div>` in one commit — as
  // this dialog used to, inside a brand-new portal subtree — is silent.
  const [announcedStatus, setAnnouncedStatus] = useState('')

  // Camera hook provides all device and stream management
  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    stream,
    isPreviewActive,
    permissionState,
    error,
    startPreview,
    stopPreview,
    capturePhoto,
    refreshDevices,
    clearError
  } = useCameraCapture()

  // Per-camera mirror preference (#42). Module-scoped store, so a second
  // TerminalPanel's CameraDialog sees the same value.
  const { isMirrored, setMirrored } = useCameraMirrorPreference(selectedDeviceId)

  /**
   * Start camera preview when dialog opens.
   * Handles initial loading state and error clearing.
   */
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true)
      clearError()
      startPreview().finally(() => {
        setIsLoading(false)
      })
    } else {
      // Stop preview when dialog closes
      stopPreview()
    }
  }, [isOpen, startPreview, stopPreview, clearError])

  /**
   * Attach stream to video element when it changes.
   */
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  /**
   * Restart preview when device selection changes.
   */
  useEffect(() => {
    if (isOpen && selectedDeviceId && !isLoading) {
      // Small delay to avoid rapid restarts
      const timer = setTimeout(() => {
        startPreview()
      }, 100)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [selectedDeviceId]) // Only react to device changes, not other deps

  /**
   * Handle photo capture with shutter animation.
   */
  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !isPreviewActive) return

    // Trigger shutter animation
    setIsShutterActive(true)

    // Wait for animation start before capture
    await new Promise((resolve) => setTimeout(resolve, 50))

    const filePath = await capturePhoto(videoRef.current)

    // Reset shutter animation. Clear any pending timer first (rapid re-capture)
    // and store the new id so the unmount cleanup below can cancel it.
    if (shutterTimerRef.current !== null) {
      clearTimeout(shutterTimerRef.current)
    }
    shutterTimerRef.current = setTimeout(() => {
      setIsShutterActive(false)
      shutterTimerRef.current = null
    }, 200)

    if (filePath) {
      logger.info('Camera photo captured', { filePath })
      onCapture(filePath)
    }
  }, [isPreviewActive, capturePhoto, onCapture])

  // Cancel the shutter-reset timer on unmount so it can't fire against a
  // torn-down React tree (prevents the test-env `window is not defined`
  // crash and also the React "state update on unmounted component" warning).
  useEffect(() => {
    return () => {
      if (shutterTimerRef.current !== null) {
        clearTimeout(shutterTimerRef.current)
        shutterTimerRef.current = null
      }
    }
  }, [])

  /**
   * Handle device selection change.
   */
  const handleDeviceChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const deviceId = event.target.value
      setSelectedDeviceId(deviceId)
    },
    [setSelectedDeviceId]
  )

  /**
   * Handle refresh button click.
   */
  const handleRefresh = useCallback(async () => {
    clearError()
    setIsLoading(true)
    await refreshDevices()
    await startPreview()
    setIsLoading(false)
  }, [clearError, refreshDevices, startPreview])

  /**
   * Handle keyboard events.
   * - Enter: Capture photo (if preview is active), unless an interactive
   *   control has focus — Enter belongs to that control, or to nothing at all:
   *   it activates a focused button (Cancel, Refresh) and commits a focused
   *   select, while on the mirror checkbox it is simply inert (a native
   *   checkbox toggles on Space, and there is no form here for Enter to
   *   submit). Either way the dialog must not turn it into a capture.
   * - Arrow Up/Down: Navigate device dropdown (handled by native select)
   * - Escape: Handled by BaseDialog
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' || !isPreviewActive || error) return

      // Bail out BEFORE preventDefault(): this handler sits on the dialog body,
      // so without the guard every Enter — including one aimed at a focused
      // Cancel button — was swallowed into a capture.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button, select, input') !== null
      ) {
        return
      }

      event.preventDefault()
      handleCapture()
    },
    [isPreviewActive, error, handleCapture]
  )

  // Determine if we should show the device selector
  // Only show when multiple devices available and no critical error
  const showDeviceSelector = devices.length > 1 && permissionState === 'granted'

  // Determine if capture is allowed
  const canCapture = isPreviewActive && !error && !isLoading

  // Whether the mirror control is INTERACTIVE — deliberately not named after
  // the mirror state itself (`isMirrored` is that). The control is inert while
  // nothing is being previewed; note this implies `canCapture === false`, since
  // it is a strict subset of the same conditions.
  const canToggleMirror = isPreviewActive && !error

  // Show empty state when no cameras detected
  const showEmptyState = permissionState === 'unavailable' && !isLoading

  // Show loading when starting up
  const showLoading = isLoading || (isOpen && !isPreviewActive && !error && !showEmptyState)

  // What the live region SHOULD say, derived synchronously...
  const statusMessage = getCameraStatusMessage({
    hasError: Boolean(error),
    showEmptyState,
    showLoading,
    isPreviewActive
  })

  // ...and what it actually carries, written one commit later. See
  // `announcedStatus` for why the delay is the whole point.
  useEffect(() => {
    setAnnouncedStatus(statusMessage)
  }, [statusMessage])

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onClose}
      zIndex={10000}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy="camera-dialog-title"
      initialFocusRef={captureButtonRef}
      // Capture is `disabled={!canCapture}` and the camera takes hundreds of
      // milliseconds to start, so at BaseDialog's 10ms focus tick it is still
      // disabled and focus lands on Cancel. Re-arm on the exact value that
      // gates the button, so focus is promoted to Capture the moment it can
      // hold it. BaseDialog's guard makes this a no-op if the user has moved
      // focus in the meantime.
      initialFocusKey={canCapture}
      // Refresh, not the device `<select>` that happens to be first in DOM
      // order, is where a user whose camera just died needs to be.
      focusRescueRef={refreshButtonRef}
      trapFocus
    >
      <div
        className="camera-dialog"
        onKeyDown={handleKeyDown}
        data-testid={TEST_IDS.CAMERA_DIALOG}
      >
        {/* Header with icon */}
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <Camera size={20} />
          </div>
          <h3 id="camera-dialog-title" className="dialog-title">
            Capture photo
          </h3>
        </div>

        <div className="dialog-body">
          {/* Device selector - only shown when multiple cameras */}
          {showDeviceSelector && (
            <div className="camera-device-section">
              <label htmlFor="camera-device-select" className="camera-device-label">
                Camera
              </label>
              <select
                id="camera-device-select"
                className="camera-device-select"
                value={selectedDeviceId || ''}
                onChange={handleDeviceChange}
                data-testid={TEST_IDS.CAMERA_DEVICE_SELECT}
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error message. `role="alert"` already implies
            * `aria-live="assertive"`; spelling both out is a documented
            * double-speaking source in some screen-reader/browser pairs. */}
          {error && (
            <div className="camera-error" role="alert" data-testid={TEST_IDS.CAMERA_ERROR}>
              <AlertCircle size={20} className="camera-error-icon" />
              <span className="camera-error-message">{error.message}</span>
            </div>
          )}

          {/* Video preview container */}
          <div className="camera-preview-container">
            <div className="camera-preview-wrapper" data-testid={TEST_IDS.CAMERA_PREVIEW_WRAPPER}>
              {/* Empty state when no camera */}
              {showEmptyState && (
                <div className="camera-empty-state">
                  <CameraOff size={48} className="camera-empty-state-icon" />
                  <p className="camera-empty-state-text">
                    No camera detected.
                    <br />
                    Please connect a camera and click Refresh.
                  </p>
                </div>
              )}

              {/* Loading state — VISUAL ONLY. The announcement lives in the
                * always-mounted status region below; this block is unmounted on
                * every transition, and an unmounted live region announces
                * nothing when its content changes. */}
              {showLoading && !showEmptyState && (
                <div className="camera-preview-loading">
                  <Loader2 size={32} />
                  <span>Starting camera...</span>
                </div>
              )}

              {/* Video preview */}
              <video
                ref={videoRef}
                className={`camera-preview${isMirrored ? ' camera-preview--mirrored' : ''}`}
                autoPlay
                playsInline
                muted
                data-testid={TEST_IDS.CAMERA_PREVIEW}
                style={{ display: isPreviewActive ? 'block' : 'none' }}
              />

              {/* Shutter overlay */}
              <div
                className={`camera-shutter${isShutterActive ? ' camera-shutter--active' : ''}`}
                data-testid={TEST_IDS.CAMERA_SHUTTER}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Status live region. Mounted for the whole life of the dialog and
            * only its TEXT swapped, so every transition is a change to an
            * existing region — the only kind assistive tech announces. Visually
            * hidden with a component-scoped class, matching `.toast-sr-only`
            * and `.screenshot-overlay-sr-only`; sighted users get the spinner
            * and the enabled/disabled controls instead. `role="status"` implies
            * `aria-live="polite"`, so the attribute is deliberately not
            * repeated. */}
          <div id={statusRegionId} className="camera-sr-only" role="status">
            {announcedStatus}
          </div>

          {/* Mirror-preview option (#42). Rendered UNCONDITIONALLY at a stable
            * height: `permissionState` never leaves 'granted' after a grant, so
            * a render gate would strand the row over a dead preview after a
            * NotReadableError or a disconnect — and unmounting it while focused
            * would drop focus out of an aria-modal dialog. Only `disabled`
            * tracks the live preview. */}
          <div className="camera-option-row">
            <label
              className={`camera-checkbox-label${
                canToggleMirror ? '' : ' camera-checkbox-label--disabled'
              }`}
            >
              <input
                type="checkbox"
                checked={isMirrored}
                disabled={!canToggleMirror}
                onChange={(event) => setMirrored(event.target.checked)}
                // Points at the status region so a browse-mode user who lands
                // on a dimmed checkbox hears WHY ("Starting camera...") rather
                // than just "unavailable".
                aria-describedby={statusRegionId}
                data-testid={TEST_IDS.CAMERA_MIRROR_TOGGLE}
              />
              Mirror preview (saved photo is never mirrored)
            </label>
          </div>
        </div>

        {/* Action buttons */}
        <div className="camera-actions">
          {/* Refresh button - shown when there's an error */}
          {error && (
            <div className="camera-actions-left">
              <button
                ref={refreshButtonRef}
                className="dialog-btn dialog-btn-secondary"
                onClick={handleRefresh}
                disabled={isLoading}
                data-testid={TEST_IDS.CAMERA_BTN_REFRESH}
              >
                <RefreshCw size={14} style={{ marginRight: 'var(--space-3)' }} />
                Refresh
              </button>
            </div>
          )}

          <button
            className="dialog-btn dialog-btn-secondary"
            onClick={onClose}
            data-testid={TEST_IDS.CAMERA_BTN_CANCEL}
          >
            Cancel
          </button>

          <button
            ref={captureButtonRef}
            className="dialog-btn dialog-btn-primary"
            onClick={handleCapture}
            disabled={!canCapture}
            data-testid={TEST_IDS.CAMERA_BTN_CAPTURE}
          >
            Capture
          </button>
        </div>
      </div>
    </BaseDialog>
  )
})
