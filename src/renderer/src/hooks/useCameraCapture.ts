// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useCameraCapture Hook
 *
 * Manages camera functionality for photo capture within the application.
 * Handles device enumeration, stream management, permission states, and photo capture.
 *
 * Features:
 * - Device enumeration with hot-plug support (devicechange event)
 * - Persistent device selection via localStorage
 * - Permission state tracking (prompt, granted, denied, unavailable)
 * - Stream lifecycle management with proper cleanup
 * - Photo capture via canvas with JPEG encoding
 *
 * @example
 * ```tsx
 * const {
 *   devices,
 *   selectedDeviceId,
 *   setSelectedDeviceId,
 *   stream,
 *   isPreviewActive,
 *   permissionState,
 *   error,
 *   startPreview,
 *   stopPreview,
 *   capturePhoto,
 *   refreshDevices,
 *   clearError
 * } = useCameraCapture()
 *
 * // Start preview when dialog opens
 * useEffect(() => {
 *   if (isOpen) startPreview()
 *   return () => stopPreview()
 * }, [isOpen])
 *
 * // Capture photo
 * const handleCapture = async () => {
 *   const filePath = await capturePhoto(videoRef.current!)
 *   if (filePath) onCapture(filePath)
 * }
 * ```
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '../utils/logger'
import { CAMERA } from '../../../shared/constants'

/** LocalStorage key for persisting last used camera device */
const STORAGE_KEY_LAST_DEVICE = 'erfana-camera-last-device'

/**
 * Error codes for camera-related errors.
 * Used to identify specific error conditions for appropriate UI feedback.
 */
export type CameraErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_DISCONNECTED'
  | 'CAMERA_IN_USE'
  | 'CAMERA_UNKNOWN_ERROR'

/**
 * Camera error with optional error code for programmatic handling.
 */
export interface CameraError {
  /** Human-readable error message */
  message: string
  /** Error code for programmatic handling */
  code?: CameraErrorCode
}

/**
 * Permission state for camera access.
 * - 'prompt': User has not been asked yet
 * - 'granted': Camera access allowed
 * - 'denied': Camera access denied by user or system
 * - 'unavailable': No cameras available on system
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable'

/**
 * Return type for the useCameraCapture hook.
 */
export interface UseCameraCaptureReturn {
  // Device state
  /** List of available camera devices */
  devices: MediaDeviceInfo[]
  /** Currently selected device ID (null if none selected) */
  selectedDeviceId: string | null
  /** Select a camera device by its deviceId */
  setSelectedDeviceId: (deviceId: string) => void

  // Stream state
  /** Active MediaStream for video preview (null if not streaming) */
  stream: MediaStream | null
  /** Whether the camera preview is currently active */
  isPreviewActive: boolean

  // Permission state
  /** Current camera permission state */
  permissionState: PermissionState

  // Error state
  /** Current error (null if no error) */
  error: CameraError | null

  // Actions
  /** Start camera preview with selected device */
  startPreview: () => Promise<void>
  /** Stop camera preview and release resources */
  stopPreview: () => void
  /** Capture current video frame as photo and save to file */
  capturePhoto: (videoElement: HTMLVideoElement) => Promise<string | null>
  /** Refresh the list of available camera devices */
  refreshDevices: () => Promise<void>
  /** Clear the current error state */
  clearError: () => void
}

/**
 * Persist the last used device ID to localStorage.
 *
 * @param deviceId - Device ID to persist
 */
function persistLastDevice(deviceId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_DEVICE, deviceId)
  } catch (e) {
    // localStorage may be unavailable in some contexts
    logger.warn('Failed to persist camera device selection', { error: String(e) })
  }
}

/**
 * Load the last used device ID from localStorage.
 *
 * @returns Last used device ID, or null if not set
 */
function loadLastDevice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_DEVICE)
  } catch {
    return null
  }
}

/**
 * Result of capturing a video frame to canvas.
 */
interface CaptureFrameResult {
  /** Base64 JPEG data URL of the captured frame */
  dataUrl: string | null
  /** Error message if capture failed */
  error: string | null
}

/**
 * Capture current video frame as JPEG data URL using canvas.
 *
 * Creates a temporary canvas element, draws the current video frame,
 * and converts to a base64-encoded JPEG data URL.
 *
 * @param videoElement - Video element displaying the camera stream
 * @param jpegQuality - JPEG compression quality (0-1), defaults to CAMERA.JPEG_QUALITY
 * @returns Result with dataUrl on success, error message on failure
 *
 * @example
 * ```ts
 * const result = captureVideoFrame(videoRef.current, 0.92)
 * if (result.dataUrl) {
 *   // Send to main process for saving
 * }
 * ```
 */
function captureVideoFrame(
  videoElement: HTMLVideoElement,
  jpegQuality: number = CAMERA.JPEG_QUALITY
): CaptureFrameResult {
  // Create canvas with video dimensions
  const canvas = document.createElement('canvas')
  canvas.width = videoElement.videoWidth
  canvas.height = videoElement.videoHeight

  // Get 2D rendering context
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      dataUrl: null,
      error: 'Failed to create canvas context.'
    }
  }

  // Draw current video frame to canvas
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

  // Convert to JPEG data URL
  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality)

  return { dataUrl, error: null }
}

/**
 * Map MediaDevices API errors to CameraErrorCode.
 *
 * Converts low-level browser errors from getUserMedia() and enumerateDevices()
 * into user-friendly CameraError objects with appropriate error codes for
 * programmatic handling in the UI.
 *
 * Error mapping:
 * - NotAllowedError → CAMERA_PERMISSION_DENIED (user denied camera access)
 * - NotFoundError → CAMERA_NOT_FOUND (no camera device available)
 * - NotReadableError → CAMERA_IN_USE (camera busy, used by another app)
 * - AbortError → CAMERA_DISCONNECTED (camera was disconnected during use)
 * - Other DOMException → CAMERA_UNKNOWN_ERROR (generic browser error)
 * - Error instance → CAMERA_UNKNOWN_ERROR (JavaScript error)
 * - Non-Error → CAMERA_UNKNOWN_ERROR (unexpected throw value)
 *
 * @param error - Error from getUserMedia or enumerateDevices (can be any type)
 * @returns CameraError with user-friendly message and error code
 *
 * @example
 * ```ts
 * try {
 *   await navigator.mediaDevices.getUserMedia({ video: true })
 * } catch (err) {
 *   const cameraError = mapMediaError(err)
 *   if (cameraError.code === 'CAMERA_PERMISSION_DENIED') {
 *     // Show permission settings dialog
 *   }
 * }
 * ```
 */
function mapMediaError(error: unknown): CameraError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return {
          message: 'Camera access denied. Please grant camera permission in your system settings.',
          code: 'CAMERA_PERMISSION_DENIED'
        }
      case 'NotFoundError':
        return {
          message: 'No camera detected. Please connect a camera and try again.',
          code: 'CAMERA_NOT_FOUND'
        }
      case 'NotReadableError':
        return {
          message: 'Camera is in use by another application.',
          code: 'CAMERA_IN_USE'
        }
      case 'AbortError':
        return {
          message: 'Camera was disconnected.',
          code: 'CAMERA_DISCONNECTED'
        }
      default:
        return {
          message: error.message || 'Failed to access camera.',
          code: 'CAMERA_UNKNOWN_ERROR'
        }
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: 'CAMERA_UNKNOWN_ERROR'
    }
  }

  return {
    message: 'An unexpected error occurred.',
    code: 'CAMERA_UNKNOWN_ERROR'
  }
}

/**
 * React hook for managing camera functionality.
 *
 * Provides a complete API for camera device enumeration, stream management,
 * photo capture, and error handling. Handles device hot-plug events and
 * persists device selection across sessions.
 *
 * @returns Camera state and control functions
 *
 * @example
 * ```tsx
 * function CameraDialog({ onCapture }) {
 *   const videoRef = useRef<HTMLVideoElement>(null)
 *   const {
 *     devices,
 *     selectedDeviceId,
 *     setSelectedDeviceId,
 *     stream,
 *     isPreviewActive,
 *     error,
 *     startPreview,
 *     capturePhoto
 *   } = useCameraCapture()
 *
 *   // Attach stream to video element
 *   useEffect(() => {
 *     if (videoRef.current && stream) {
 *       videoRef.current.srcObject = stream
 *     }
 *   }, [stream])
 *
 *   const handleCapture = async () => {
 *     const path = await capturePhoto(videoRef.current!)
 *     if (path) onCapture(path)
 *   }
 *
 *   return (
 *     <video ref={videoRef} autoPlay playsInline />
 *     <button onClick={handleCapture} disabled={!isPreviewActive}>
 *       Capture
 *     </button>
 *   )
 * }
 * ```
 */
export function useCameraCapture(): UseCameraCaptureReturn {
  // Device state
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(null)

  // Stream state
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isPreviewActive, setIsPreviewActive] = useState(false)

  // Permission state
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')

  // Error state
  const [error, setError] = useState<CameraError | null>(null)

  // Ref to track if component is mounted (for async cleanup)
  const mountedRef = useRef(true)

  // Ref to track current stream for cleanup
  const streamRef = useRef<MediaStream | null>(null)

  // Ref for debouncing device change events
  const deviceChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Stop all tracks in a MediaStream and release resources.
   *
   * @param mediaStream - Stream to stop (uses current stream if not provided)
   */
  const stopStream = useCallback((mediaStream?: MediaStream | null) => {
    const targetStream = mediaStream ?? streamRef.current
    if (targetStream) {
      targetStream.getTracks().forEach((track) => {
        track.stop()
      })
      logger.debug('Camera stream stopped')
    }
    if (!mediaStream) {
      streamRef.current = null
      if (mountedRef.current) {
        setStream(null)
        setIsPreviewActive(false)
      }
    }
  }, [])

  /**
   * Enumerate available video input devices.
   *
   * @returns Promise that resolves when enumeration completes
   */
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setPermissionState('unavailable')
        setError({
          message: 'Camera API not available in this browser.',
          code: 'CAMERA_NOT_FOUND'
        })
        return
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = allDevices.filter((device) => device.kind === 'videoinput')

      if (!mountedRef.current) return

      setDevices(videoDevices)

      if (videoDevices.length === 0) {
        setPermissionState('unavailable')
        setError({
          message: 'No camera detected. Please connect a camera and try again.',
          code: 'CAMERA_NOT_FOUND'
        })
        return
      }

      // Select device: prefer last used, fallback to first available
      const lastDeviceId = loadLastDevice()
      const hasLastDevice = videoDevices.some((d) => d.deviceId === lastDeviceId)

      if (!selectedDeviceId || !videoDevices.some((d) => d.deviceId === selectedDeviceId)) {
        const deviceToSelect = hasLastDevice ? lastDeviceId! : videoDevices[0].deviceId
        setSelectedDeviceIdState(deviceToSelect)
      }

      logger.debug('Camera devices enumerated', { count: videoDevices.length })
    } catch (err) {
      if (!mountedRef.current) return
      const cameraError = mapMediaError(err)
      setError(cameraError)
      logger.error('Failed to enumerate camera devices', err instanceof Error ? err : undefined)
    }
  }, [selectedDeviceId])

  /**
   * Set the selected camera device and persist the selection.
   *
   * @param deviceId - Device ID to select
   */
  const setSelectedDeviceId = useCallback(
    (deviceId: string) => {
      setSelectedDeviceIdState(deviceId)
      persistLastDevice(deviceId)

      // If preview is active, restart with new device
      if (isPreviewActive) {
        stopStream()
        // startPreview will be triggered by the effect watching selectedDeviceId
      }
    },
    [isPreviewActive, stopStream]
  )

  /**
   * Start the camera preview with the selected device.
   *
   * @returns Promise that resolves when preview starts
   */
  const startPreview = useCallback(async () => {
    // Clear previous error
    setError(null)

    // Check API availability
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionState('unavailable')
      setError({
        message: 'Camera API not available in this browser.',
        code: 'CAMERA_NOT_FOUND'
      })
      return
    }

    // Stop any existing stream
    stopStream()

    try {
      // Build video constraints
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: CAMERA.PREVIEW_MAX_WIDTH, max: CAMERA.PREVIEW_MAX_WIDTH },
          height: { ideal: CAMERA.PREVIEW_MAX_HEIGHT, max: CAMERA.PREVIEW_MAX_HEIGHT },
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
        },
        audio: false
      }

      logger.debug('Requesting camera stream', { deviceId: selectedDeviceId })

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints)

      if (!mountedRef.current) {
        // Component unmounted during async operation
        mediaStream.getTracks().forEach((track) => track.stop())
        return
      }

      // Store stream in ref for cleanup
      streamRef.current = mediaStream
      setStream(mediaStream)
      setIsPreviewActive(true)
      setPermissionState('granted')

      // Ensure device list is populated with labels after permission grant
      // (labels are only available after getUserMedia succeeds)
      await refreshDevices()

      logger.info('Camera preview started', { deviceId: selectedDeviceId })
    } catch (err) {
      if (!mountedRef.current) return

      const cameraError = mapMediaError(err)
      setError(cameraError)
      setIsPreviewActive(false)

      if (cameraError.code === 'CAMERA_PERMISSION_DENIED') {
        setPermissionState('denied')
      }

      logger.error('Failed to start camera preview', err instanceof Error ? err : undefined)
    }
  }, [selectedDeviceId, stopStream, refreshDevices])

  /**
   * Stop the camera preview and release resources.
   */
  const stopPreview = useCallback(() => {
    stopStream()
    logger.debug('Camera preview stopped')
  }, [stopStream])

  /**
   * Capture the current video frame as a JPEG photo and save to file.
   *
   * @param videoElement - Video element displaying the camera stream
   * @returns File path of saved photo, or null if capture failed
   */
  const capturePhoto = useCallback(
    async (videoElement: HTMLVideoElement): Promise<string | null> => {
      if (!stream || !isPreviewActive) {
        logger.warn('Cannot capture photo: no active stream')
        return null
      }

      try {
        // Capture video frame to JPEG data URL
        const frameResult = captureVideoFrame(videoElement)
        if (!frameResult.dataUrl) {
          setError({
            message: frameResult.error || 'Failed to capture frame.',
            code: 'CAMERA_UNKNOWN_ERROR'
          })
          return null
        }

        // Save via IPC to main process
        const result = await window.api.camera.save({
          dataUrl: frameResult.dataUrl,
          timestamp: Date.now()
        })

        if (!result.success || !result.filePath) {
          setError({
            message: result.error || 'Failed to save photo.',
            code: 'CAMERA_UNKNOWN_ERROR'
          })
          logger.error('Camera save failed', undefined, { error: result.error })
          return null
        }

        logger.info('Photo captured and saved', { filePath: result.filePath })
        return result.filePath
      } catch (err) {
        const cameraError = mapMediaError(err)
        setError(cameraError)
        logger.error('Failed to capture photo', err instanceof Error ? err : undefined)
        return null
      }
    },
    [stream, isPreviewActive]
  )

  /**
   * Clear the current error state.
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Initial device enumeration on mount
  useEffect(() => {
    refreshDevices()
  }, [refreshDevices])

  // Listen for device changes (hot-plug support) with debouncing
  // Debounce prevents rapid enumeration when devices are rapidly connected/disconnected
  useEffect(() => {
    if (!navigator.mediaDevices) return

    const DEBOUNCE_DELAY_MS = 300

    const handleDeviceChange = () => {
      // Clear any pending debounced call
      if (deviceChangeTimerRef.current) {
        clearTimeout(deviceChangeTimerRef.current)
      }

      // Debounce the device enumeration to handle rapid hot-plug events
      deviceChangeTimerRef.current = setTimeout(() => {
        logger.debug('Media devices changed (debounced)')
        refreshDevices()

        // Check if current device was disconnected
        if (stream && selectedDeviceId) {
          const videoTrack = stream.getVideoTracks()[0]
          if (videoTrack && videoTrack.readyState === 'ended') {
            setError({
              message: 'Camera disconnected.',
              code: 'CAMERA_DISCONNECTED'
            })
            setIsPreviewActive(false)
          }
        }
      }, DEBOUNCE_DELAY_MS)
    }

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
      // Clear any pending debounced call on cleanup
      if (deviceChangeTimerRef.current) {
        clearTimeout(deviceChangeTimerRef.current)
        deviceChangeTimerRef.current = null
      }
    }
  }, [refreshDevices, stream, selectedDeviceId])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      // Stop stream on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [])

  return {
    // Device state
    devices,
    selectedDeviceId,
    setSelectedDeviceId,

    // Stream state
    stream,
    isPreviewActive,

    // Permission state
    permissionState,

    // Error state
    error,

    // Actions
    startPreview,
    stopPreview,
    capturePhoto,
    refreshDevices,
    clearError
  }
}
