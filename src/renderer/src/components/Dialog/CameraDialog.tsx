// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CameraDialog Component
 *
 * Modal dialog for camera photo capture. Provides live preview from the user's
 * camera, device selection for multiple cameras, and single-frame photo capture.
 *
 * Features:
 * - Live video preview with 4:3 aspect ratio
 * - Device selector dropdown for multi-camera systems
 * - Shutter animation on capture
 * - Keyboard navigation (Enter to capture, Escape to close)
 * - Error handling with refresh capability
 * - Accessibility support (ARIA labels, focus trap)
 *
 * @see Spec #014 - Camera photo capture specification
 * @see Issue #86 enhancement - Camera integration with terminal
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { Camera, AlertCircle, Loader2, RefreshCw, CameraOff } from 'lucide-react'
import { useCameraCapture } from '../../hooks/useCameraCapture'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'
import { logger } from '../../utils/logger'
import './CameraDialog.css'

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
 * frame when the user clicks Capture or presses Enter.
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
  // Video element ref for capture
  const videoRef = useRef<HTMLVideoElement>(null)
  // Shutter-animation timer id. Tracked so the effect below can clear it on
  // unmount — otherwise the 200ms callback fires on a disposed React tree
  // (see #159: vitest teardown produced "ReferenceError: window is not defined").
  const shutterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Shutter animation state
  const [isShutterActive, setIsShutterActive] = useState(false)

  // Loading state for initial camera startup
  const [isLoading, setIsLoading] = useState(false)

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
   * - Enter: Capture photo (if preview is active)
   * - Arrow Up/Down: Navigate device dropdown (handled by native select)
   * - Escape: Handled by BaseDialog
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && isPreviewActive && !error) {
        event.preventDefault()
        handleCapture()
      }
    },
    [isPreviewActive, error, handleCapture]
  )

  // Determine if we should show the device selector
  // Only show when multiple devices available and no critical error
  const showDeviceSelector = devices.length > 1 && permissionState === 'granted'

  // Determine if capture is allowed
  const canCapture = isPreviewActive && !error && !isLoading

  // Show empty state when no cameras detected
  const showEmptyState = permissionState === 'unavailable' && !isLoading

  // Show loading when starting up
  const showLoading = isLoading || (isOpen && !isPreviewActive && !error && !showEmptyState)

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onClose}
      zIndex={10000}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy="camera-dialog-title"
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

          {/* Error message */}
          {error && (
            <div className="camera-error" data-testid={TEST_IDS.CAMERA_ERROR}>
              <AlertCircle size={20} className="camera-error-icon" />
              <span className="camera-error-message">{error.message}</span>
            </div>
          )}

          {/* Video preview container */}
          <div className="camera-preview-container">
            <div className="camera-preview-wrapper">
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

              {/* Loading state */}
              {showLoading && !showEmptyState && (
                <div className="camera-preview-loading">
                  <Loader2 size={32} />
                  <span>Starting camera...</span>
                </div>
              )}

              {/* Video preview */}
              <video
                ref={videoRef}
                className="camera-preview camera-preview--mirrored"
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
        </div>

        {/* Action buttons */}
        <div className="camera-actions">
          {/* Refresh button - shown when there's an error */}
          {error && (
            <div className="camera-actions-left">
              <button
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
