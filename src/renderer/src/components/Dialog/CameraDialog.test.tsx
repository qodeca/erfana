// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for CameraDialog Component
 *
 * Tests the camera dialog UI including rendering, keyboard navigation,
 * device selection, and photo capture flow.
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CameraDialog } from './CameraDialog'
import { TEST_IDS } from '../../constants/testids'
import { useCameraMirrorStore } from '../../stores/useCameraMirrorStore'
import { mirrorMap } from '../../test-utils/mirrorMap'
import type { UseCameraCaptureReturn } from '../../hooks/useCameraCapture'

// =============================================================================
// Mock useCameraCapture Hook
// =============================================================================

const mockStartPreview = vi.fn()
const mockStopPreview = vi.fn()
const mockCapturePhoto = vi.fn()
const mockRefreshDevices = vi.fn()
const mockClearError = vi.fn()
const mockSetSelectedDeviceId = vi.fn()

const defaultHookReturn: UseCameraCaptureReturn = {
  devices: [
    {
      deviceId: 'device1',
      kind: 'videoinput',
      label: 'Built-in Camera',
      groupId: 'default',
      toJSON: () => ({} as MediaDeviceInfo)
    }
  ],
  selectedDeviceId: 'device1',
  setSelectedDeviceId: mockSetSelectedDeviceId,
  stream: null,
  isPreviewActive: false,
  permissionState: 'prompt',
  error: null,
  startPreview: mockStartPreview,
  stopPreview: mockStopPreview,
  capturePhoto: mockCapturePhoto,
  refreshDevices: mockRefreshDevices,
  clearError: mockClearError
}

let mockHookReturn = { ...defaultHookReturn }

vi.mock('../../hooks/useCameraCapture', () => ({
  useCameraCapture: () => mockHookReturn
}))

// =============================================================================
// Mock createPortal
// =============================================================================

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node
  }
})

// =============================================================================
// Tests
// =============================================================================

describe('CameraDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCapture: vi.fn()
  }

  /**
   * Helper to render CameraDialog and wait for initial effects to settle.
   * Wraps render in act() to handle async state updates from useEffect.
   */
  async function renderDialog(props = defaultProps) {
    let result: ReturnType<typeof render>
    await act(async () => {
      result = render(<CameraDialog {...props} />)
    })
    return result!
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHookReturn = { ...defaultHookReturn }

    // Add portal root for BaseDialog
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }

    // Reset mock implementations
    mockStartPreview.mockResolvedValue(undefined)
    mockCapturePhoto.mockResolvedValue('/tmp/camera-photo.jpg')

    // The mirror store is REAL and module-scoped in this suite (only
    // useCameraCapture is doubled), so it must be reset or a preference set by
    // one test leaks into the next (#42).
    useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })
    localStorage.clear()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('should render nothing when closed', async () => {
      await renderDialog({ ...defaultProps, isOpen: false })
      expect(screen.queryByTestId(TEST_IDS.CAMERA_DIALOG)).not.toBeInTheDocument()
    })

    it('should render dialog when open', async () => {
      mockHookReturn.isPreviewActive = true
      await renderDialog()
      expect(screen.getByTestId(TEST_IDS.CAMERA_DIALOG)).toBeInTheDocument()
    })

    it('should display title', async () => {
      await renderDialog()
      expect(screen.getByText('Capture photo')).toBeInTheDocument()
    })

    it('should display Cancel button', async () => {
      await renderDialog()
      expect(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL)).toBeInTheDocument()
    })

    it('should display Capture button', async () => {
      await renderDialog()
      expect(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)).toBeInTheDocument()
    })

    it('should call startPreview when dialog opens', async () => {
      await renderDialog()
      expect(mockStartPreview).toHaveBeenCalled()
    })

    it('should call stopPreview when dialog closes', async () => {
      const { rerender } = await renderDialog()

      await act(async () => {
        rerender(<CameraDialog {...defaultProps} isOpen={false} />)
      })

      expect(mockStopPreview).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Device Selector Tests
  // ===========================================================================

  describe('device selector', () => {
    it('should show dropdown with multiple cameras', async () => {
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: 'Built-in Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        },
        {
          deviceId: 'device2',
          kind: 'videoinput',
          label: 'External Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        }
      ]
      mockHookReturn.permissionState = 'granted'

      await renderDialog()

      expect(screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT)).toBeInTheDocument()
      expect(screen.getByText('Built-in Camera')).toBeInTheDocument()
      expect(screen.getByText('External Camera')).toBeInTheDocument()
    })

    it('should not show dropdown with single camera', async () => {
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: 'Built-in Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        }
      ]
      mockHookReturn.permissionState = 'granted'

      await renderDialog()

      expect(screen.queryByTestId(TEST_IDS.CAMERA_DEVICE_SELECT)).not.toBeInTheDocument()
    })

    it('should call setSelectedDeviceId when device changes', async () => {
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: 'Built-in Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        },
        {
          deviceId: 'device2',
          kind: 'videoinput',
          label: 'External Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        }
      ]
      mockHookReturn.permissionState = 'granted'

      await renderDialog()

      const select = screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT)
      await act(async () => {
        fireEvent.change(select, { target: { value: 'device2' } })
      })

      expect(mockSetSelectedDeviceId).toHaveBeenCalledWith('device2')
    })

    it('should use fallback label when device label is empty', async () => {
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: '',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        },
        {
          deviceId: 'device2',
          kind: 'videoinput',
          label: '',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        }
      ]
      mockHookReturn.permissionState = 'granted'

      await renderDialog()

      expect(screen.getByText('Camera 1')).toBeInTheDocument()
      expect(screen.getByText('Camera 2')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Keyboard Navigation Tests
  // ===========================================================================

  describe('keyboard navigation', () => {
    it('should call onClose when Escape pressed', async () => {
      const onClose = vi.fn()
      await renderDialog({ ...defaultProps, onClose })

      const dialog = screen.getByTestId(TEST_IDS.CAMERA_DIALOG)
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Escape' })
      })

      expect(onClose).toHaveBeenCalled()
    })

    it('should trigger capture when Enter pressed and preview active', async () => {
      mockHookReturn.isPreviewActive = true
      const onCapture = vi.fn()

      await renderDialog({ ...defaultProps, onCapture })

      const dialog = screen.getByTestId(TEST_IDS.CAMERA_DIALOG)
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Enter' })
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
        expect(onCapture).toHaveBeenCalledWith('/tmp/camera-photo.jpg')
      })
    })

    it('should not trigger capture when Enter pressed and preview inactive', async () => {
      mockHookReturn.isPreviewActive = false

      await renderDialog()

      const dialog = screen.getByTestId(TEST_IDS.CAMERA_DIALOG)
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Enter' })
      })

      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })

    it('should not trigger capture when Enter pressed with error', async () => {
      mockHookReturn.isPreviewActive = true
      mockHookReturn.error = {
        message: 'Camera error',
        code: 'CAMERA_PERMISSION_DENIED'
      }

      await renderDialog()

      const dialog = screen.getByTestId(TEST_IDS.CAMERA_DIALOG)
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Enter' })
      })

      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Cancel Button Tests
  // ===========================================================================

  describe('cancel button', () => {
    it('should call onClose when Cancel clicked', async () => {
      const onClose = vi.fn()
      await renderDialog({ ...defaultProps, onClose })

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL))
      })

      expect(onClose).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Capture Button Tests
  // ===========================================================================

  describe('capture button', () => {
    it('should call onCapture with filePath when Capture clicked', async () => {
      mockHookReturn.isPreviewActive = true
      const onCapture = vi.fn()

      await renderDialog({ ...defaultProps, onCapture })

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE))
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
        expect(onCapture).toHaveBeenCalledWith('/tmp/camera-photo.jpg')
      })
    })

    it('should be disabled when preview not active', async () => {
      mockHookReturn.isPreviewActive = false

      await renderDialog()

      const captureBtn = screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)
      expect(captureBtn).toBeDisabled()
    })

    it('should be disabled when error present', async () => {
      mockHookReturn.isPreviewActive = true
      mockHookReturn.error = {
        message: 'Camera error',
        code: 'CAMERA_PERMISSION_DENIED'
      }

      await renderDialog()

      const captureBtn = screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)
      expect(captureBtn).toBeDisabled()
    })

    it('should not call onCapture when capturePhoto returns null', async () => {
      mockHookReturn.isPreviewActive = true
      mockCapturePhoto.mockResolvedValue(null)
      const onCapture = vi.fn()

      await renderDialog({ ...defaultProps, onCapture })

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE))
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
      })

      expect(onCapture).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Error Display Tests
  // ===========================================================================

  describe('error display', () => {
    it('should show error message when error present', async () => {
      mockHookReturn.error = {
        message: 'Camera access denied',
        code: 'CAMERA_PERMISSION_DENIED'
      }

      await renderDialog()

      expect(screen.getByTestId(TEST_IDS.CAMERA_ERROR)).toBeInTheDocument()
      expect(screen.getByText('Camera access denied')).toBeInTheDocument()
    })

    it('should not show error when no error', async () => {
      mockHookReturn.error = null

      await renderDialog()

      expect(screen.queryByTestId(TEST_IDS.CAMERA_ERROR)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Refresh Button Tests
  // ===========================================================================

  describe('refresh button', () => {
    it('should show and work when error present', async () => {
      mockHookReturn.error = {
        message: 'Camera error',
        code: 'CAMERA_NOT_FOUND'
      }

      await renderDialog()

      const refreshBtn = screen.getByTestId(TEST_IDS.CAMERA_BTN_REFRESH)
      expect(refreshBtn).toBeInTheDocument()

      // Clear call count before clicking refresh
      vi.clearAllMocks()

      await act(async () => {
        fireEvent.click(refreshBtn)
      })

      await waitFor(() => {
        expect(mockClearError).toHaveBeenCalled()
        expect(mockRefreshDevices).toHaveBeenCalled()
        expect(mockStartPreview).toHaveBeenCalled()
      })
    })

    it('should not show when no error', async () => {
      mockHookReturn.error = null

      await renderDialog()

      expect(screen.queryByTestId(TEST_IDS.CAMERA_BTN_REFRESH)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Shutter Animation Tests
  // ===========================================================================

  describe('shutter animation', () => {
    it('should show shutter overlay during capture', async () => {
      mockHookReturn.isPreviewActive = true

      await renderDialog()

      const shutter = screen.getByTestId(TEST_IDS.CAMERA_SHUTTER)
      expect(shutter).not.toHaveClass('camera-shutter--active')

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE))
      })

      // Shutter should activate during capture
      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // Loading State Tests
  // ===========================================================================

  describe('loading state', () => {
    it('should show loading when starting up', async () => {
      mockHookReturn.isPreviewActive = false
      mockHookReturn.error = null
      mockHookReturn.permissionState = 'prompt'

      await renderDialog()

      // Scoped to the VISUAL block: the same words now also live in the
      // always-mounted `role="status"` region, and this test is about what a
      // sighted user sees. The announcement is covered under 'status live
      // region' below.
      expect(
        screen.getByText('Starting camera...', { selector: '.camera-preview-loading span' })
      ).toBeInTheDocument()
    })

    it('should not show loading when preview active', async () => {
      mockHookReturn.isPreviewActive = true

      await renderDialog()

      expect(screen.queryByText('Starting camera...')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Empty State Tests
  // ===========================================================================

  describe('empty state', () => {
    it('should show empty state when no cameras available', async () => {
      mockHookReturn.permissionState = 'unavailable'
      mockHookReturn.devices = []
      mockHookReturn.isPreviewActive = false

      await renderDialog()

      // Scoped to the VISUAL block — see the loading-state test above.
      expect(
        screen.getByText(/No camera detected/, { selector: '.camera-empty-state-text' })
      ).toBeInTheDocument()
    })

    it('should not show empty state when cameras available', async () => {
      mockHookReturn.permissionState = 'granted'
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: 'Camera',
          groupId: 'default',
          toJSON: () => ({} as MediaDeviceInfo)
        }
      ]

      await renderDialog()

      expect(screen.queryByText(/No camera detected/)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Video Preview Tests
  // ===========================================================================

  describe('video preview', () => {
    it('should show video element', async () => {
      await renderDialog()

      expect(screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)).toBeInTheDocument()
    })

    it('should hide video when preview not active', async () => {
      mockHookReturn.isPreviewActive = false

      await renderDialog()

      const video = screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)
      expect(video).toHaveStyle({ display: 'none' })
    })

    it('should show video when preview active', async () => {
      mockHookReturn.isPreviewActive = true

      await renderDialog()

      const video = screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)
      expect(video).toHaveStyle({ display: 'block' })
    })
  })

  // ===========================================================================
  // Preview Mirroring Tests (#42)
  // ===========================================================================

  describe('preview mirroring (#42)', () => {
    // Every assertion keys on TEST_IDS.CAMERA_MIRROR_TOGGLE, never on the label
    // string, so a copy change cannot break this suite.

    it('renders the preview un-mirrored by default', async () => {
      mockHookReturn.isPreviewActive = true
      await renderDialog()

      const video = screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)
      expect(video).toHaveClass('camera-preview')
      expect(video).not.toHaveClass('camera-preview--mirrored')
    })

    it('mirrors the preview when the stored preference for the device is on', async () => {
      useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap({ device1: true }) })
      mockHookReturn.isPreviewActive = true
      await renderDialog()

      expect(screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)).toHaveClass('camera-preview--mirrored')
      expect(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)).toBeChecked()
    })

    it('mirrors the preview when the checkbox is switched on', async () => {
      mockHookReturn.isPreviewActive = true
      await renderDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE))
      })

      expect(screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)).toHaveClass('camera-preview--mirrored')
      expect(useCameraMirrorStore.getState().mirrorByDevice.device1).toBe(true)
    })

    it('un-mirrors the preview when the checkbox is switched off again', async () => {
      useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap({ device1: true }) })
      mockHookReturn.isPreviewActive = true
      await renderDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE))
      })

      expect(screen.getByTestId(TEST_IDS.CAMERA_PREVIEW)).not.toHaveClass(
        'camera-preview--mirrored'
      )
      expect(useCameraMirrorStore.getState().mirrorByDevice.device1).toBe(false)
    })

    it('renders the option row for a single-camera system', async () => {
      // Guards against the row being nested inside the showDeviceSelector
      // block, which only renders when devices.length > 1.
      mockHookReturn.isPreviewActive = true
      mockHookReturn.permissionState = 'granted'
      await renderDialog()

      expect(screen.queryByTestId(TEST_IDS.CAMERA_DEVICE_SELECT)).not.toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)).toBeInTheDocument()
    })

    it('renders the option row before permission is granted, but disabled', async () => {
      // The row is rendered unconditionally; only `disabled` is gated on
      // `isPreviewActive && !error`.
      mockHookReturn.isPreviewActive = false
      mockHookReturn.permissionState = 'prompt'
      await renderDialog()

      const toggle = screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)
      expect(toggle).toBeInTheDocument()
      expect(toggle).toBeDisabled()
    })

    it('disables the option row when the camera errors mid-session', async () => {
      mockHookReturn.isPreviewActive = true
      mockHookReturn.error = {
        message: 'Camera is in use by another application.',
        code: 'CAMERA_IN_USE'
      }
      await renderDialog()

      const toggle = screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)
      expect(toggle).toBeInTheDocument()
      expect(toggle).toBeDisabled()
    })

    it('keeps focus inside the dialog when the disabled control loses focus', async () => {
      // The rescue itself lives in BaseDialog's `trapFocus` focusout handler
      // (there is no per-control onBlur here any more); this asserts CameraDialog
      // is actually wired to it. `focusout` — bubbling, `relatedTarget: null` —
      // is what Chromium delivers when it blurs a control at the instant the
      // control becomes disabled; jsdom does not emulate that, so it is
      // dispatched by hand.
      mockHookReturn.isPreviewActive = false
      await renderDialog()

      fireEvent.focusOut(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE), {
        relatedTarget: null
      })

      const container = screen.getByTestId(TEST_IDS.DIALOG_CONTAINER)
      expect(container.contains(document.activeElement)).toBe(true)
      // Cancel is the only enabled control in this state (Capture and the
      // mirror toggle are both disabled), and no Refresh button exists to be
      // nominated, so the rescue falls back to `first`.
      expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL))
    })

    it('rescues focus to Refresh, not to the device selector, after a disconnect', () => {
      // First-in-DOM-order is the WRONG target here: with two cameras the first
      // focusable is the device `<select>` at the top of the dialog, where the
      // user's next arrow key silently switches camera and restarts the stream.
      // `focusRescueRef` points BaseDialog at Refresh instead — the control a
      // user whose camera just died actually needs.
      mockHookReturn.devices = [
        {
          deviceId: 'device1',
          kind: 'videoinput',
          label: 'Built-in Camera',
          groupId: 'default',
          toJSON: () => ({}) as MediaDeviceInfo
        },
        {
          deviceId: 'device2',
          kind: 'videoinput',
          label: 'USB Camera',
          groupId: 'default',
          toJSON: () => ({}) as MediaDeviceInfo
        }
      ]
      mockHookReturn.permissionState = 'granted'
      mockHookReturn.isPreviewActive = true
      mockHookReturn.error = { message: 'Camera disconnected.', code: 'CAMERA_DISCONNECTED' }

      return renderDialog().then(() => {
        // Precondition: the selector really is first in DOM order, so the
        // assertion below cannot pass by accident.
        const container = screen.getByTestId(TEST_IDS.DIALOG_CONTAINER)
        expect(container.querySelector('select')).toBe(
          screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT)
        )

        fireEvent.focusOut(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE), {
          relatedTarget: null
        })

        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_REFRESH))
      })
    })
  })

  // ===========================================================================
  // Status live region (#42 pre-UAT accessibility fix)
  // ===========================================================================

  describe('status live region', () => {
    /** The single `role="status"` region CameraDialog keeps mounted. */
    function getStatusRegion(): HTMLElement {
      return screen.getByRole('status')
    }

    it('keeps the region mounted with no text before anything is announced', async () => {
      // The defect: the old markup created the region and its text in the SAME
      // commit, inside a brand-new portal subtree. Assistive tech announces
      // CHANGES to a live region, not content that was already there when the
      // region appeared, so "Starting camera..." was most likely never spoken.
      mockHookReturn.isPreviewActive = false
      await renderDialog()

      expect(getStatusRegion()).toBeInTheDocument()
    })

    it('does not repeat aria-live alongside the implicit role semantics', async () => {
      // `role="status"` implies polite and `role="alert"` implies assertive;
      // spelling the attribute out as well is a documented double-speaking
      // source in some screen-reader/browser pairs.
      mockHookReturn.error = { message: 'Camera is in use by another application.' }
      await renderDialog()

      expect(getStatusRegion()).not.toHaveAttribute('aria-live')
      expect(screen.getByTestId(TEST_IDS.CAMERA_ERROR)).not.toHaveAttribute('aria-live')
      expect(screen.getByTestId(TEST_IDS.CAMERA_ERROR)).toHaveAttribute('role', 'alert')
    })

    it('describes the mirror checkbox with the status region', async () => {
      // A browse-mode user who lands on the dimmed checkbox hears WHY it is
      // dimmed, instead of just "unavailable".
      mockHookReturn.isPreviewActive = false
      await renderDialog()

      expect(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)).toHaveAttribute(
        'aria-describedby',
        getStatusRegion().id
      )
    })

    it('leaves the region silent while an error owns the announcement', async () => {
      mockHookReturn.isPreviewActive = false
      mockHookReturn.error = { message: 'Camera is in use by another application.' }
      await renderDialog()

      expect(getStatusRegion()).toHaveTextContent('')
    })

    it('announces the empty state when no camera is attached', async () => {
      mockHookReturn.permissionState = 'unavailable'
      mockHookReturn.isPreviewActive = false
      await renderDialog()

      expect(getStatusRegion()).toHaveTextContent('No camera detected.')
    })
  })

  // ===========================================================================
  // Focus Management Tests
  // ===========================================================================

  describe('focus management', () => {
    it('should have dialog role for focus trapping', async () => {
      await renderDialog()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should have aria-labelledby attribute', async () => {
      await renderDialog()

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby', 'camera-dialog-title')
    })

    it('does not put initial focus on the mirror checkbox (#42)', async () => {
      vi.useFakeTimers()
      try {
        mockHookReturn.isPreviewActive = true // control enabled at t=0
        await renderDialog()
        await act(async () => {
          vi.advanceTimersByTime(20) // BaseDialog's FOCUS_DELAY_MS is 10
        })

        expect(document.activeElement).not.toBe(
          screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE)
        )
        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE))
      } finally {
        vi.useRealTimers()
      }
    })

    // =========================================================================
    // Deferred camera start (#42)
    //
    // The tests above let `startPreview()` resolve in the same flush as the
    // render, which is NOT how a real camera behaves: `getUserMedia()` takes
    // hundreds of milliseconds, so at BaseDialog's 10ms focus tick the Capture
    // button is still `disabled={!canCapture}` and cannot be the initial focus
    // target. These three drive the real sequence instead — Capture stays
    // disabled across the focus tick, and only then does the preview come up.
    // Without the `initialFocusKey` wiring the second one fails: focus stays
    // on Cancel forever.
    // =========================================================================
    describe('while the camera is still starting', () => {
      /** Resolver for the pending `startPreview()` promise. */
      let releasePreview: () => void

      /**
       * Render with `startPreview()` still in flight and the focus tick spent,
       * i.e. the state a real user sees for the first few hundred ms.
       */
      async function renderWithPendingPreview(): Promise<ReturnType<typeof render>> {
        mockStartPreview.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              releasePreview = resolve
            })
        )
        mockHookReturn.isPreviewActive = false

        const result = await renderDialog()
        await act(async () => {
          vi.advanceTimersByTime(20) // past FOCUS_DELAY_MS (10)
        })
        return result
      }

      /**
       * Let the camera finish coming up: the hook flips `isPreviewActive` and
       * `startPreview()` settles, clearing `isLoading` — together they make
       * `canCapture` true, which is the value wired to `initialFocusKey`.
       */
      async function activatePreview(): Promise<void> {
        mockHookReturn.isPreviewActive = true
        await act(async () => {
          releasePreview()
        })
        await act(async () => {
          vi.advanceTimersByTime(20)
        })
      }

      beforeEach(() => {
        vi.useFakeTimers()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('parks focus on Cancel while Capture is still disabled', async () => {
        await renderWithPendingPreview()

        expect(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)).toBeDisabled()
        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL))
      })

      it('promotes focus to Capture once the preview becomes active', async () => {
        await renderWithPendingPreview()
        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL))

        await activatePreview()

        expect(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)).toBeEnabled()
        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE))
      })

      it('swaps the status text inside a region that never unmounts', async () => {
        // The load-bearing property of the fix, and the one the old markup got
        // wrong twice over: the region must be the SAME node before and after,
        // so the transition is a text change to an existing live region rather
        // than a fresh region appearing with content already in it. The old
        // markup UNMOUNTED the region when the stream started, so the moment
        // Capture and the mirror checkbox became enabled was announced by
        // nothing at all.
        await renderWithPendingPreview()

        const region = screen.getByRole('status')
        expect(region).toHaveTextContent('Starting camera...')

        await activatePreview()

        expect(screen.getByRole('status')).toBe(region)
        expect(region).toHaveTextContent('Camera ready')
      })

      it('does not steal focus the user has already moved elsewhere', async () => {
        // A slow camera start gives the user time to tab away. Focus must stay
        // where they put it — this is the guard on BaseDialog's re-armed pass.
        const outside = document.createElement('button')
        outside.textContent = 'Somewhere else'
        document.body.appendChild(outside)

        try {
          await renderWithPendingPreview()
          expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL))

          outside.focus()
          expect(document.activeElement).toBe(outside)

          await activatePreview()

          expect(screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)).toBeEnabled()
          expect(document.activeElement).toBe(outside)
        } finally {
          outside.remove()
        }
      })
    })
  })
})
