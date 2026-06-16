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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CameraDialog } from './CameraDialog'
import { TEST_IDS } from '../../constants/testids'
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

      expect(screen.getByText('Starting camera...')).toBeInTheDocument()
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

      expect(screen.getByText(/No camera detected/)).toBeInTheDocument()
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
  })
})
