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
import { useCameraMirrorPreference } from './useCameraMirrorPreference'
import { useCameraMirrorStore } from '../stores/useCameraMirrorStore'
import { mirrorMap } from '../test-utils/mirrorMap'

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

/**
 * The members of `CanvasRenderingContext2D` this suite actually stubs.
 *
 * ONE hoisted object, not a fresh literal per getContext() call, so tests can
 * assert on what capture did to the context. All SEVEN CanvasRenderingContext2D
 * transform members are present so that a regression which re-introduces a flip
 * fails on a meaningful assertion instead of on `ctx.transform is not a
 * function` — which capturePhoto's catch would swallow into `return null`.
 * `filter` is a plain property assignment and is therefore invisible to call
 * assertions; it is asserted by value.
 */
const stubbedCanvasMembers = {
  drawImage: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  transform: vi.fn(),
  setTransform: vi.fn(),
  resetTransform: vi.fn(),
  getTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  filter: 'none'
}

/**
 * Property names that are NOT canvas API and must pass through untrapped.
 *
 * The test runner, `pretty-format` and the `await` protocol probe objects for
 * these while building failure output. Trapping them would turn a readable
 * assertion failure into a confusing throw from inside the reporter.
 */
const INTROSPECTION_PASSTHROUGH = new Set([
  'constructor',
  'toString',
  'toJSON',
  'valueOf',
  'then',
  'nodeType',
  'tagName',
  '$$typeof',
  'hasOwnProperty',
  'asymmetricMatch',
  '@@__IMMUTABLE_ITERABLE__@@',
  '@@__IMMUTABLE_RECORD__@@'
])

/**
 * Stable 2D-context stub, fronted by a DENY-BY-DEFAULT Proxy.
 *
 * The plain object above is an ALLOWLIST: any canvas API it does not name is
 * simply `undefined`, so a flip built from an unstubbed member — the classic
 * `getImageData` → reverse-rows → `putImageData` route, say — throws
 * `ctx.getImageData is not a function`. `captureVideoFrame` runs inside
 * `capturePhoto`'s `try`, whose `catch` turns any throw into `return null`. The
 * #42 guards below would then see no transform call, `filter === 'none'` and
 * the recorded `drawImage` args, and pass green over a capture that produced
 * nothing at all.
 *
 * The Proxy closes that hole: reading a member nobody stubbed is a NAMED,
 * loud failure instead of `undefined`. Combined with the success assertions in
 * the guards (returned file path, `toDataURL`, `camera.save`), a swallowed
 * throw can no longer masquerade as a pass.
 *
 * WRITES are denied on the same terms, and for the same reason. Half the canvas
 * API is plain property assignment, and an assignment to an unstubbed member
 * would otherwise be silently ACCEPTED: `ctx.globalCompositeOperation = 'copy'`
 * or `ctx.imageSmoothingEnabled = false` calls no method, leaves `filter` at
 * `'none'`, and the #42 guards — which watch the six transform methods and
 * `filter` by value — would stay green over a capture that mutated the frame.
 * Only `filter` is asserted by value, so only the stubbed members are writable.
 *
 * Symbols and {@link INTROSPECTION_PASSTHROUGH} are exempt: they are runner
 * plumbing, never canvas API.
 *
 * If production code legitimately starts using a new context member, ADD IT to
 * `stubbedCanvasMembers` — do not widen either trap.
 */
const mockCanvasContext = new Proxy(stubbedCanvasMembers, {
  get(target, property, receiver) {
    if (
      typeof property === 'symbol' ||
      INTROSPECTION_PASSTHROUGH.has(property) ||
      Object.prototype.hasOwnProperty.call(target, property)
    ) {
      return Reflect.get(target, property, receiver)
    }
    throw new Error(
      `UNSTUBBED CANVAS MEMBER: capture read ctx.${property}, which this ` +
        `suite does not stub. Either production code gained a new canvas ` +
        `dependency (add it to stubbedCanvasMembers) or a frame transform ` +
        `sneaked back in through an API the #42 guards do not watch.`
    )
  },
  set(target, property, value) {
    if (
      typeof property === 'symbol' ||
      INTROSPECTION_PASSTHROUGH.has(property) ||
      Object.prototype.hasOwnProperty.call(target, property)
    ) {
      // No `receiver`: the write belongs on the stub object itself, which is
      // what the assertions read. Forwarding the proxy as receiver would route
      // the write back through this proxy's `defineProperty` trap instead.
      return Reflect.set(target, property, value)
    }
    throw new Error(
      `UNSTUBBED CANVAS MEMBER: capture wrote ctx.${property} = ` +
        `${String(value)}, which this suite does not stub. Either production ` +
        `code gained a new canvas dependency (add it to stubbedCanvasMembers) ` +
        `or a frame transform sneaked back in through a property the #42 ` +
        `guards do not watch.`
    )
  }
})

/**
 * Assertion message for "the capture must have succeeded".
 *
 * `capturePhoto` swallows every throw into `return null`, but it also parks the
 * message on the hook's `error` state — so echoing it here turns an otherwise
 * opaque `expected null` into the actual cause, e.g. the Proxy's
 * `UNSTUBBED CANVAS MEMBER: capture read ctx.getImageData`.
 *
 * @param error - `result.current.error` at the moment of the assertion
 * @returns Message naming both the contract and the swallowed cause
 */
function captureFailureMessage(error: { message: string } | null): string {
  return (
    'capture must SUCCEED, not be silently swallowed. ' +
    `Hook error state: ${error === null ? '(none)' : error.message}`
  )
}

/** The six members that MUTATE the transform. `getTransform` only reads. */
const MUTATING_TRANSFORMS = [
  'translate',
  'rotate',
  'scale',
  'transform',
  'setTransform',
  'resetTransform'
] as const

const mockGetContext = vi.fn(() => mockCanvasContext)

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

    // `vi.clearAllMocks()` clears call history but does NOT touch plain
    // properties, so `filter` is reset by hand (#42).
    mockCanvasContext.filter = 'none'

    // The mirror store is module-scoped and therefore shared by every test in
    // this file; reset it so a preference cannot leak between tests (#42).
    useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })

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

    it('performs no canvas transform while the preview is mirrored (#42)', async () => {
      // NOTE ON SCOPE: this asserts "captureVideoFrame performs no transform on
      // the capture canvas". It does NOT assert "the saved file is unmirrored" —
      // nothing in jsdom decodes the JPEG. The two coincide only because the
      // canvas starts at the identity transform.
      //
      // `ctx.transform(-1, 0, 0, 1, w, 0)` is the idiomatic horizontal flip and
      // was entirely unguarded before #42; it is one of the six members below.
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])
      const { result } = renderHook(() => useCameraCapture())
      await waitFor(() => expect(result.current.selectedDeviceId).toBe('device1'))
      await act(async () => {
        await result.current.startPreview()
      })

      // Mirror ON for this device — the preview flag must not reach the canvas.
      act(() => {
        useCameraMirrorStore.getState().setMirror('device1', true)
      })

      const mockVideo = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      // SUCCESS FIRST. Every assertion below is about what capture did NOT do,
      // and `capturePhoto`'s catch turns any throw into `return null` — so
      // without this the whole guard stays green over a capture that threw and
      // produced no photo at all. A broken capture must fail here, loudly, and
      // the swallowed message is echoed into the assertion so the failure names
      // the real cause instead of just "expected null".
      expect(filePath, captureFailureMessage(result.current.error)).toBe('/tmp/camera-photo.jpg')
      expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.92)
      expect(mockCameraSave).toHaveBeenCalledWith({
        dataUrl: 'data:image/jpeg;base64,mockBase64Data',
        timestamp: expect.any(Number)
      })

      for (const method of MUTATING_TRANSFORMS) {
        expect(
          mockCanvasContext[method],
          `ctx.${method}() must never be called during capture (#42)`
        ).not.toHaveBeenCalled()
      }
      expect(mockCanvasContext.filter, 'ctx.filter must stay unset during capture').toBe('none')

      expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(1)
      expect(mockCanvasContext.drawImage).toHaveBeenCalledWith(mockVideo, 0, 0, 1920, 1080)
    })

    it('performs no canvas transform while the preview is un-mirrored (#42)', async () => {
      // Same scope note as above. Run with the preference OFF as well, because
      // the point of the pair is that the preview state never reaches the
      // canvas in EITHER direction.
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])
      const { result } = renderHook(() => useCameraCapture())
      await waitFor(() => expect(result.current.selectedDeviceId).toBe('device1'))
      await act(async () => {
        await result.current.startPreview()
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice['device1']).toBeUndefined()

      const mockVideo = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
      let filePath: string | null = null
      await act(async () => {
        filePath = await result.current.capturePhoto(mockVideo)
      })

      // Same reason as the mirrored case: prove the capture SUCCEEDED before
      // asserting what it refrained from doing.
      expect(filePath, captureFailureMessage(result.current.error)).toBe('/tmp/camera-photo.jpg')
      expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.92)
      expect(mockCameraSave).toHaveBeenCalledWith({
        dataUrl: 'data:image/jpeg;base64,mockBase64Data',
        timestamp: expect.any(Number)
      })

      for (const method of MUTATING_TRANSFORMS) {
        expect(
          mockCanvasContext[method],
          `ctx.${method}() must never be called during capture (#42)`
        ).not.toHaveBeenCalled()
      }
      expect(mockCanvasContext.filter, 'ctx.filter must stay unset during capture').toBe('none')

      expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(1)
      expect(mockCanvasContext.drawImage).toHaveBeenCalledWith(mockVideo, 0, 0, 1280, 720)
    })
  })

  // ===========================================================================
  // Mirror Preference Tests (#42)
  // ===========================================================================

  describe('mirror preference render timing (#42)', () => {
    /** Every committed render's (device, mirror) pair, in order. */
    const commits: Array<{ deviceId: string | null; mirrored: boolean }> = []

    beforeEach(() => {
      commits.length = 0
      useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })
    })

    it('never commits a render whose mirror flag disagrees with its device', async () => {
      mockEnumerateDevices.mockResolvedValue([
        createMockDevice('device1', 'Camera 1'),
        createMockDevice('device2', 'Camera 2')
      ])
      // Seeded through the store's public state, so the test does not depend on
      // the persisted JSON shape.
      useCameraMirrorStore.setState({
        mirrorByDevice: mirrorMap({ device1: true, device2: false })
      })

      const { result } = renderHook(() => {
        const camera = useCameraCapture()
        const mirror = useCameraMirrorPreference(camera.selectedDeviceId)
        // Pushed on EVERY render, before the commit is painted. A useState +
        // useEffect reimplementation produces at least one render where the
        // pair disagrees (new device, previous device's flag); a value derived
        // during render cannot. Do NOT replace this with a settled-state
        // assertion — act() drains effect-triggered re-renders, so the settled
        // state is identical under both implementations, and the test would
        // prove nothing. Do not "simplify" it.
        commits.push({ deviceId: camera.selectedDeviceId, mirrored: mirror.isMirrored })
        return { ...camera, ...mirror }
      })

      await waitFor(() => expect(result.current.selectedDeviceId).toBe('device1'))

      // async act(): setSelectedDeviceId changes refreshDevices' identity,
      // re-firing the mount effect whose enumerateDevices() promise resolves
      // outside a synchronous act().
      await act(async () => {
        result.current.setSelectedDeviceId('device2')
      })
      await act(async () => {
        result.current.setSelectedDeviceId('device1')
      })

      const expected: Record<string, boolean> = { device1: true, device2: false }
      const inconsistent = commits.filter(
        (commit) => commit.deviceId !== null && commit.mirrored !== expected[commit.deviceId]
      )
      expect(
        inconsistent,
        `commits holding an inconsistent (device, mirror) pair: ${JSON.stringify(inconsistent)}`
      ).toEqual([])

      // Sanity: an empty or single-device `commits` must not pass vacuously.
      expect(commits.some((c) => c.deviceId === 'device2')).toBe(true)
      expect(commits.filter((c) => c.deviceId === 'device1').length).toBeGreaterThan(1)
    })

    it('applies the stored preference on the refreshDevices auto-select path', async () => {
      // No last-device key, so refreshDevices picks videoDevices[0] directly via
      // setSelectedDeviceIdState — the path a sync wired into
      // setSelectedDeviceId would miss entirely.
      mockEnumerateDevices.mockResolvedValue([createMockDevice('device1', 'Camera 1')])
      useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap({ device1: true }) })

      const { result } = renderHook(() => {
        const camera = useCameraCapture()
        const mirror = useCameraMirrorPreference(camera.selectedDeviceId)
        commits.push({ deviceId: camera.selectedDeviceId, mirrored: mirror.isMirrored })
        return { ...camera, ...mirror }
      })

      await waitFor(() => expect(result.current.selectedDeviceId).toBe('device1'))
      expect(commits.filter((c) => c.deviceId === 'device1').every((c) => c.mirrored)).toBe(true)
      // Guard against a vacuous pass if the auto-select path ever stops firing.
      expect(commits.some((c) => c.deviceId === 'device1')).toBe(true)
    })
  })

  // NOTE: "toggling the mirror preference does not restart the stream" is NOT
  // tested here. `useCameraCapture` has no subscription to the mirror store, so
  // mutating the store around a bare `renderHook(useCameraCapture)` cannot make
  // the assertion fail by construction — the test would be tautological. It
  // lives in `CameraDialog.mirror.integration.test.tsx`, where the real toggle
  // is clicked and the whole component re-renders (#42).

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
