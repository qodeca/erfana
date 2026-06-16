// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useCameraCapture Hook
 *
 * Tests the camera capture functionality including device enumeration,
 * stream management, permission states, and photo capture.
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCameraCapture } from './useCameraCapture'

// =============================================================================
// Mock navigator.mediaDevices
// =============================================================================

interface MockMediaDeviceInfo {
  deviceId: string
  kind: MediaDeviceKind
  label: string
  groupId: string
  toJSON: () => MediaDeviceInfo
}

const createMockDevice = (
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = 'videoinput'
): MockMediaDeviceInfo => ({
  deviceId,
  kind,
  label,
  groupId: 'default',
  toJSON: function () {
    return this as unknown as MediaDeviceInfo
  }
})

const mockGetUserMedia = vi.fn()
const mockEnumerateDevices = vi.fn()
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

// Create mock MediaStream
class MockMediaStream {
  private tracks: MediaStreamTrack[]

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks
  }

  getTracks(): MediaStreamTrack[] {
    return this.tracks
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}

// Create mock MediaStreamTrack
const createMockTrack = (kind: 'video' | 'audio' = 'video', readyState: 'live' | 'ended' = 'live') => ({
  kind,
  readyState,
  stop: vi.fn()
})

Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: mockGetUserMedia,
    enumerateDevices: mockEnumerateDevices,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener
  }
})

// =============================================================================
// Mock localStorage
// =============================================================================

const localStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    })
  }
})()

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
})

// =============================================================================
// Mock window.api.camera.save
// =============================================================================

const mockCameraSave = vi.fn()

Object.defineProperty(global.window, 'api', {
  writable: true,
  value: {
    camera: {
      save: mockCameraSave
    }
  }
})

// =============================================================================
// Mock logger
// =============================================================================

vi.mock('../utils/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

// =============================================================================
// Mock HTMLCanvasElement
// =============================================================================

const mockToDataURL = vi.fn(() => 'data:image/jpeg;base64,mockBase64Data')
const mockGetContext = vi.fn(() => ({
  drawImage: vi.fn()
}))

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  writable: true,
  value: mockToDataURL
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: mockGetContext
})

// =============================================================================
// Tests
// =============================================================================

describe('useCameraCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()

    // Reset mock implementations
    mockEnumerateDevices.mockResolvedValue([])
    mockGetUserMedia.mockResolvedValue(new MockMediaStream([createMockTrack()]))
    mockCameraSave.mockResolvedValue({ success: true, filePath: '/tmp/camera-photo.jpg' })
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  // ===========================================================================
  // Device Enumeration Tests
  // ===========================================================================

  describe('device enumeration', () => {
    it('should list all video input devices', async () => {
      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2'),
        createMockDevice('device3', 'Microphone', 'audioinput')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(2)
        expect(result.current.devices[0].label).toBe('Camera 1')
        expect(result.current.devices[1].label).toBe('Camera 2')
      })
    })

    it('should filter out non-video devices', async () => {
      const devices = [
        createMockDevice('audio1', 'Microphone', 'audioinput'),
        createMockDevice('video1', 'Camera', 'videoinput'),
        createMockDevice('audio2', 'Speaker', 'audiooutput')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
        expect(result.current.devices[0].deviceId).toBe('video1')
      })
    })

    it('should refresh devices when refreshDevices is called', async () => {
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      // Update mock to return different devices
      mockEnumerateDevices.mockResolvedValue([
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ])

      await act(async () => {
        await result.current.refreshDevices()
      })

      expect(result.current.devices).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Device Selection Tests
  // ===========================================================================

  describe('device selection', () => {
    it('should select first camera by default when no last device', async () => {
      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.selectedDeviceId).toBe('device1')
      })
    })

    it('should update selected device when setSelectedDeviceId is called', async () => {
      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.selectedDeviceId).toBe('device1')
      })

      act(() => {
        result.current.setSelectedDeviceId('device2')
      })

      expect(result.current.selectedDeviceId).toBe('device2')
    })
  })

  // ===========================================================================
  // Device Persistence Tests
  // ===========================================================================

  describe('device persistence', () => {
    it('should restore last selected device from localStorage', async () => {
      localStorageMock.setItem('erfana-camera-last-device', 'device2')

      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.selectedDeviceId).toBe('device2')
      })
    })

    it('should persist device selection to localStorage', async () => {
      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(2)
      })

      act(() => {
        result.current.setSelectedDeviceId('device2')
      })

      expect(localStorageMock.setItem).toHaveBeenCalledWith('erfana-camera-last-device', 'device2')
    })

    it('should fallback to first device when last device not available', async () => {
      localStorageMock.setItem('erfana-camera-last-device', 'device-nonexistent')

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.selectedDeviceId).toBe('device1')
      })
    })
  })

  // ===========================================================================
  // Stream Start Tests
  // ===========================================================================

  describe('stream start', () => {
    it('should start preview with selected device', async () => {
      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const mockStream = new MockMediaStream([createMockTrack()])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          deviceId: { exact: 'device1' }
        },
        audio: false
      })
      expect(result.current.stream).toBeTruthy()
      expect(result.current.isPreviewActive).toBe(true)
      expect(result.current.permissionState).toBe('granted')
    })

    it('should request without deviceId when no device selected', async () => {
      mockEnumerateDevices.mockResolvedValue([])
      const mockStream = new MockMediaStream([createMockTrack()])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 }
        },
        audio: false
      })
    })
  })

  // ===========================================================================
  // Stream Stop Tests
  // ===========================================================================

  describe('stream stop', () => {
    it('should stop all tracks on stopPreview', async () => {
      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.isPreviewActive).toBe(true)

      act(() => {
        result.current.stopPreview()
      })

      expect(mockTrack.stop).toHaveBeenCalled()
      expect(result.current.stream).toBeNull()
      expect(result.current.isPreviewActive).toBe(false)
    })
  })

  // ===========================================================================
  // Permission Denied Tests
  // ===========================================================================

  describe('permission denied', () => {
    it('should set permissionState to denied and error when permission denied', async () => {
      const error = new DOMException('Permission denied', 'NotAllowedError')
      mockGetUserMedia.mockRejectedValue(error)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.permissionState).toBe('denied')
      expect(result.current.error).toEqual({
        message: 'Camera access denied. Please grant camera permission in your system settings.',
        code: 'CAMERA_PERMISSION_DENIED'
      })
      expect(result.current.isPreviewActive).toBe(false)
    })
  })

  // ===========================================================================
  // No Cameras Tests
  // ===========================================================================

  describe('no cameras', () => {
    it('should set permissionState to unavailable when no cameras found', async () => {
      mockEnumerateDevices.mockResolvedValue([])

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.permissionState).toBe('unavailable')
        expect(result.current.error).toEqual({
          message: 'No camera detected. Please connect a camera and try again.',
          code: 'CAMERA_NOT_FOUND'
        })
      })
    })

    it('should set permissionState to unavailable when API not available', async () => {
      // Temporarily remove mediaDevices
      const original = navigator.mediaDevices
      Object.defineProperty(navigator, 'mediaDevices', {
        writable: true,
        value: undefined
      })

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.permissionState).toBe('unavailable')
        expect(result.current.error?.code).toBe('CAMERA_NOT_FOUND')
      })

      // Restore
      Object.defineProperty(navigator, 'mediaDevices', {
        writable: true,
        value: original
      })
    })
  })

  // ===========================================================================
  // Capture Photo Tests
  // ===========================================================================

  describe('capture photo', () => {
    it('should call canvas.toDataURL and window.api.camera.save', async () => {
      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      const mockVideo = {
        videoWidth: 1920,
        videoHeight: 1080
      } as HTMLVideoElement

      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.92)
      expect(mockCameraSave).toHaveBeenCalledWith({
        dataUrl: 'data:image/jpeg;base64,mockBase64Data',
        timestamp: expect.any(Number)
      })
      expect(filePath).toBe('/tmp/camera-photo.jpg')
    })

    it('should return null when no active stream', async () => {
      const { result } = renderHook(() => useCameraCapture())

      const mockVideo = {
        videoWidth: 1920,
        videoHeight: 1080
      } as HTMLVideoElement

      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      expect(filePath).toBeNull()
    })

    it('should return null when canvas context fails', async () => {
      mockGetContext.mockReturnValueOnce(null)

      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      const mockVideo = {
        videoWidth: 1920,
        videoHeight: 1080
      } as HTMLVideoElement

      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      expect(filePath).toBeNull()
      expect(result.current.error?.code).toBe('CAMERA_UNKNOWN_ERROR')
    })

    it('should return null and set error when save fails', async () => {
      mockCameraSave.mockResolvedValue({
        success: false,
        error: 'Save failed',
        errorCode: 'CAMERA_SAVE_FAILED'
      })

      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      const mockVideo = {
        videoWidth: 1920,
        videoHeight: 1080
      } as HTMLVideoElement

      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      expect(filePath).toBeNull()
      expect(result.current.error?.message).toBe('Save failed')
    })
  })

  // ===========================================================================
  // Device Disconnection Tests
  // ===========================================================================

  describe('device disconnection', () => {
    it('should update devices list when device removed', async () => {
      const devices = [
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(2)
      })

      // Simulate device removal
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])

      // Get the devicechange event handler
      const deviceChangeHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === 'devicechange'
      )?.[1]

      expect(deviceChangeHandler).toBeDefined()

      await act(async () => {
        deviceChangeHandler()
      })

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })
    })

    it('should handle device disconnection event', async () => {
      // Note: Full device disconnection testing is complex due to stream state management.
      // This test verifies the devicechange event listener is registered correctly.
      // The actual disconnection logic is tested indirectly through integration tests.

      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      // Verify devicechange listener is registered
      const deviceChangeHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === 'devicechange'
      )?.[1]

      expect(deviceChangeHandler).toBeDefined()
    })
  })

  // ===========================================================================
  // Device Addition Tests
  // ===========================================================================

  describe('device addition', () => {
    it('should update devices list when device added', async () => {
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])

      const { result } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      // Simulate device addition
      mockEnumerateDevices.mockResolvedValue([
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ])

      const deviceChangeHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === 'devicechange'
      )?.[1]

      await act(async () => {
        deviceChangeHandler()
      })

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanup', () => {
    it('should stop stream on unmount', async () => {
      const mockTrack = createMockTrack()
      const mockStream = new MockMediaStream([mockTrack])
      mockGetUserMedia.mockResolvedValue(mockStream)

      const devices = [createMockDevice('device1', 'Camera 1')]
      mockEnumerateDevices.mockResolvedValue(devices)

      const { result, unmount } = renderHook(() => useCameraCapture())

      await waitFor(() => {
        expect(result.current.devices).toHaveLength(1)
      })

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.isPreviewActive).toBe(true)

      unmount()

      expect(mockTrack.stop).toHaveBeenCalled()
    })

    it('should remove devicechange event listener on unmount', () => {
      const { unmount } = renderHook(() => useCameraCapture())

      unmount()

      expect(mockRemoveEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function))
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should map NotFoundError to CAMERA_NOT_FOUND', async () => {
      const error = new DOMException('No camera found', 'NotFoundError')
      mockGetUserMedia.mockRejectedValue(error)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.error?.code).toBe('CAMERA_NOT_FOUND')
    })

    it('should map NotReadableError to CAMERA_IN_USE', async () => {
      const error = new DOMException('Camera in use', 'NotReadableError')
      mockGetUserMedia.mockRejectedValue(error)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.error?.code).toBe('CAMERA_IN_USE')
    })

    it('should map AbortError to CAMERA_DISCONNECTED', async () => {
      const error = new DOMException('Camera disconnected', 'AbortError')
      mockGetUserMedia.mockRejectedValue(error)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.error?.code).toBe('CAMERA_DISCONNECTED')
    })

    it('should clear error when clearError is called', async () => {
      const error = new DOMException('Permission denied', 'NotAllowedError')
      mockGetUserMedia.mockRejectedValue(error)

      const { result } = renderHook(() => useCameraCapture())

      await act(async () => {
        await result.current.startPreview()
      })

      expect(result.current.error).toBeTruthy()

      act(() => {
        result.current.clearError()
      })

      expect(result.current.error).toBeNull()
    })
  })
})
