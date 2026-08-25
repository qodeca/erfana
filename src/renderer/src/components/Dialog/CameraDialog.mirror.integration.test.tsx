// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wiring integration test for the per-camera mirror preference (#42).
 *
 * The one thing only this file proves: the chain runs through the REAL
 * `useCameraCapture`. `CameraDialog.test.tsx` doubles that hook, so it can show
 * checkbox → store → class but not that `selectedDeviceId` from the real hook is
 * what keys the preference, nor that `disabled` tracks the real
 * `isPreviewActive`.
 *
 * `vi.mock` is hoisted and FILE-SCOPED, so not mocking the hook here does not
 * affect the sibling suites. Only the real boundaries are stubbed:
 * `navigator.mediaDevices`, `window.api.camera` and the logger — the same
 * approach `useCameraCapture.test.ts` uses. `localStorage` is jsdom's real one,
 * and the mirror store is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CameraDialog } from './CameraDialog'
import { TEST_IDS } from '../../constants/testids'
import { useCameraMirrorStore } from '../../stores/useCameraMirrorStore'
import { mirrorMap } from '../../test-utils/mirrorMap'

const MIRROR_STORAGE_KEY = 'erfana-camera-mirror-state'
const LAST_DEVICE_STORAGE_KEY = 'erfana-camera-last-device'

// =============================================================================
// Real boundaries: navigator.mediaDevices
// =============================================================================

const createMockDevice = (deviceId: string, label: string): MediaDeviceInfo =>
  ({
    deviceId,
    kind: 'videoinput',
    label,
    groupId: 'default',
    toJSON: () => ({}) as MediaDeviceInfo
  }) as MediaDeviceInfo

class MockMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}
  getTracks(): MediaStreamTrack[] {
    return this.tracks
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks
  }
  getAudioTracks(): MediaStreamTrack[] {
    return []
  }
}

const createMockTrack = (): MediaStreamTrack =>
  ({ kind: 'video', readyState: 'live', stop: vi.fn() }) as unknown as MediaStreamTrack

const mockGetUserMedia = vi.fn()
const mockEnumerateDevices = vi.fn()
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

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
// Real boundary: window.api.camera
// =============================================================================

const mockCameraSave = vi.fn()

Object.defineProperty(global.window, 'api', {
  writable: true,
  value: { camera: { save: mockCameraSave } }
})

// =============================================================================
// Logger (keeps the IPC-less renderer logger from writing to stderr)
// =============================================================================

vi.mock('../../utils/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return { ...actual, createPortal: (node: React.ReactNode) => node }
})

/**
 * Reinstall the default implementations.
 *
 * Called from an unconditional `afterEach` right after `mockReset()`, which
 * strips implementations as well as call history — `vi.clearAllMocks()` would
 * clear only the history and leave any implementation in place. Nothing here
 * uses `mockImplementationOnce`: an unconsumed once-implementation leaks into
 * the next test and makes an unrelated test throw.
 */
function installDefaults(): void {
  mockEnumerateDevices.mockResolvedValue([
    createMockDevice('device1', 'Camera 1'),
    createMockDevice('device2', 'Camera 2')
  ])
  mockGetUserMedia.mockResolvedValue(new MockMediaStream([createMockTrack()]))
  mockCameraSave.mockResolvedValue({ success: true, filePath: '/tmp/camera-photo.jpg' })
}

/** The persisted mirror map, or `undefined` when nothing is stored. */
function readPersistedMirrorMap(): Record<string, unknown> | undefined {
  const raw = localStorage.getItem(MIRROR_STORAGE_KEY)
  if (raw === null) return undefined
  return (JSON.parse(raw) as { state?: { mirrorByDevice?: Record<string, unknown> } }).state
    ?.mirrorByDevice
}

describe('CameraDialog mirror wiring through the real useCameraCapture (#42)', () => {
  const defaultProps = { isOpen: true, onClose: vi.fn(), onCapture: vi.fn() }

  const video = (): HTMLElement => screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)
  const toggle = (): HTMLElement => screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)

  async function renderDialog(): Promise<void> {
    await act(async () => {
      render(<CameraDialog {...defaultProps} />)
    })
  }

  beforeEach(() => {
    installDefaults()

    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }

    localStorage.removeItem(MIRROR_STORAGE_KEY)
    localStorage.removeItem(LAST_DEVICE_STORAGE_KEY)
    useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })
  })

  afterEach(() => {
    mockEnumerateDevices.mockReset()
    mockGetUserMedia.mockReset()
    mockCameraSave.mockReset()
    mockAddEventListener.mockReset()
    mockRemoveEventListener.mockReset()
    installDefaults()
  })

  it('binds the preview class to the checkbox and persists it for the selected device', async () => {
    await renderDialog()

    // The real hook has to reach a live preview before the control is usable.
    await waitFor(() => expect(toggle()).not.toBeDisabled())
    expect(video()).not.toHaveClass('camera-preview--mirrored')

    await act(async () => {
      fireEvent.click(toggle())
    })

    // Chain end to end: click → store → class, and the value is durable.
    expect(video()).toHaveClass('camera-preview--mirrored')
    expect(useCameraMirrorStore.getState().mirrorByDevice.device1).toBe(true)
    expect(readPersistedMirrorMap()).toEqual({ device1: true })
  })

  it("keys the preference on the real hook's selected device", async () => {
    await renderDialog()
    await waitFor(() => expect(toggle()).not.toBeDisabled())

    await act(async () => {
      fireEvent.click(toggle())
    })
    expect(video()).toHaveClass('camera-preview--mirrored')

    // Switch camera through the real hook: device2 has no stored preference.
    await act(async () => {
      fireEvent.change(screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT), {
        target: { value: 'device2' }
      })
    })

    expect(video()).not.toHaveClass('camera-preview--mirrored')
    expect(toggle()).not.toBeChecked()

    // …and switching back restores it, from the same real hook state.
    await act(async () => {
      fireEvent.change(screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT), {
        target: { value: 'device1' }
      })
    })
    expect(video()).toHaveClass('camera-preview--mirrored')
  })

  it('restores a persisted preference on a fresh mount', async () => {
    localStorage.setItem(
      MIRROR_STORAGE_KEY,
      JSON.stringify({ state: { mirrorByDevice: { device1: true } }, version: 0 })
    )
    await act(async () => {
      await useCameraMirrorStore.persist.rehydrate()
    })

    await renderDialog()

    await waitFor(() => expect(video()).toHaveClass('camera-preview--mirrored'))
    expect(toggle()).toBeChecked()
  })

  it('does not restart the stream when the mirror preference is toggled', async () => {
    // Moved here from `useCameraCapture.test.ts`, where it was tautological:
    // that suite renders the hook alone and mutates the store directly, and the
    // hook has no store subscription, so nothing could have restarted the
    // stream. Here the REAL toggle is clicked, the whole component re-renders,
    // and a mirror preference wired into the getUserMedia constraints (or an
    // effect keyed on `isMirrored`) would show up as a second call.
    await renderDialog()
    await waitFor(() => expect(toggle()).not.toBeDisabled())

    const callsBefore = mockGetUserMedia.mock.calls.length
    expect(callsBefore).toBeGreaterThan(0) // guard against a vacuous pass
    const streamBefore = (screen.getByTestId(TEST_IDS.CAMERA_PREVIEW) as HTMLVideoElement).srcObject

    await act(async () => {
      fireEvent.click(toggle())
    })

    // The click really did take effect — otherwise "no restart" proves nothing.
    expect(video()).toHaveClass('camera-preview--mirrored')
    expect(mockGetUserMedia).toHaveBeenCalledTimes(callsBefore)
    expect(
      (screen.getByTestId(TEST_IDS.CAMERA_PREVIEW) as HTMLVideoElement).srcObject
    ).toBe(streamBefore)
  })

  it('disables the control until the real hook reports a live preview', async () => {
    // getUserMedia never settles, so isPreviewActive stays false.
    mockGetUserMedia.mockImplementation(() => new Promise(() => {}))

    await renderDialog()

    expect(toggle()).toBeInTheDocument()
    expect(toggle()).toBeDisabled()
    expect(video()).not.toHaveClass('camera-preview--mirrored')
  })
})
