// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the CameraDialog Enter-key routing fix and its live regions.
 *
 * Two pre-existing defects fixed alongside #42:
 * - the dialog-level Enter shortcut swallowed Enter aimed at a focused control
 *   (pressing Enter on Cancel took a photo instead of cancelling);
 * - the error and loading regions were silent to screen readers.
 *
 * Kept in its own file so it does not collide with the #42 additions to
 * `CameraDialog.test.tsx`; `vi.mock` is file-scoped, so the hook double below
 * is independent of that suite's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CameraDialog } from './CameraDialog'
import { TEST_IDS } from '../../constants/testids'
import { useCameraMirrorStore } from '../../stores/useCameraMirrorStore'
import { mirrorMap } from '../../test-utils/mirrorMap'
import type { UseCameraCaptureReturn } from '../../hooks/useCameraCapture'

const mockStartPreview = vi.fn()
const mockStopPreview = vi.fn()
const mockCapturePhoto = vi.fn()
const mockRefreshDevices = vi.fn()
const mockClearError = vi.fn()
const mockSetSelectedDeviceId = vi.fn()

function createDevice(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    kind: 'videoinput',
    label,
    groupId: 'default',
    toJSON: () => ({}) as MediaDeviceInfo
  } as MediaDeviceInfo
}

const defaultHookReturn: UseCameraCaptureReturn = {
  devices: [createDevice('device1', 'Camera 1'), createDevice('device2', 'Camera 2')],
  selectedDeviceId: 'device1',
  setSelectedDeviceId: mockSetSelectedDeviceId,
  stream: null,
  isPreviewActive: true,
  permissionState: 'granted',
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

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node
  }
})

describe('CameraDialog keyboard routing and live regions', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCapture: vi.fn()
  }

  async function renderDialog(props = defaultProps) {
    await act(async () => {
      render(<CameraDialog {...props} />)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHookReturn = { ...defaultHookReturn }

    // BaseDialog bails out without a portal root, even with createPortal mocked.
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
    mockStartPreview.mockResolvedValue(undefined)
    mockCapturePhoto.mockResolvedValue('/tmp/camera-photo.jpg')
    useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })
    localStorage.clear()
  })

  describe('Enter does not steal focus from interactive controls', () => {
    it('does not capture when Enter is pressed on the Cancel button', async () => {
      await renderDialog()

      // fireEvent returns false when a handler called preventDefault(); the
      // button's own default activation must survive.
      const notPrevented = fireEvent.keyDown(screen.getByTestId(TEST_IDS.CAMERA_BTN_CANCEL), {
        key: 'Enter'
      })

      expect(notPrevented).toBe(true)
      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })

    it('does not capture when Enter is pressed on the mirror checkbox', async () => {
      await renderDialog()

      const notPrevented = fireEvent.keyDown(screen.getByTestId(TEST_IDS.CAMERA_MIRROR_TOGGLE), {
        key: 'Enter'
      })

      expect(notPrevented).toBe(true)
      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })

    it('does not capture when Enter is pressed on the device selector', async () => {
      await renderDialog()

      const notPrevented = fireEvent.keyDown(screen.getByTestId(TEST_IDS.CAMERA_DEVICE_SELECT), {
        key: 'Enter'
      })

      expect(notPrevented).toBe(true)
      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })

    it('still captures when Enter is pressed on the dialog body', async () => {
      const onCapture = vi.fn()
      await renderDialog({ ...defaultProps, onCapture })

      await act(async () => {
        fireEvent.keyDown(screen.getByTestId(TEST_IDS.CAMERA_DIALOG), { key: 'Enter' })
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
        expect(onCapture).toHaveBeenCalledWith('/tmp/camera-photo.jpg')
      })
    })

    it('still captures when Enter is pressed on the preview element', async () => {
      await renderDialog()

      await act(async () => {
        fireEvent.keyDown(screen.getByTestId(TEST_IDS.CAMERA_PREVIEW), { key: 'Enter' })
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalled()
      })
    })
  })

  describe('Enter on the focused Capture button', () => {
    /**
     * The PRIMARY keyboard path, and the one every other Enter test misses:
     * BaseDialog parks focus on Capture once the preview is live, so
     * Enter-on-Capture is what a keyboard user actually presses.
     *
     * WHAT THIS PROVES: `handleKeyDown` bails out for any target inside
     * `button, select, input` — that was the Enter-on-Cancel fix — so it can no
     * longer be the thing that captures here. Capture therefore has to arrive
     * through the button's own activation. `userEvent` models that activation
     * per the UI Events spec: for Enter on a `<button>` its `keypress`
     * behaviour dispatches a `click`
     * (`@testing-library/user-event/.../event/behavior/keypress.ts`), giving the
     * full keydown → keypress → click → keyup sequence.
     *
     * WHAT THIS DOES NOT PROVE: that a real browser performs that activation.
     * jsdom implements no default activation behaviour at all, and `fireEvent`
     * would prove nothing here; `userEvent` SIMULATES the browser rather than
     * being one. Real native activation is only assertable in Chromium — see
     * `e2e/camera-mirror.e2e.ts` ("Enter on the focused Capture button …") and
     * manual UAT.
     */
    it('captures when Enter is pressed while Capture holds focus (activation simulated by userEvent, not native)', async () => {
      const user = userEvent.setup()
      const onCapture = vi.fn()
      await renderDialog({ ...defaultProps, onCapture })

      const captureButton = screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)
      expect(captureButton).toBeEnabled()
      captureButton.focus()
      expect(captureButton).toHaveFocus()

      // Targets document.activeElement, i.e. Capture.
      await act(async () => {
        await user.keyboard('{Enter}')
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalledTimes(1)
        expect(onCapture).toHaveBeenCalledWith('/tmp/camera-photo.jpg')
      })
    })

    /**
     * The mechanism split, asserted honestly and separately from the test
     * above: the dialog-level handler must NOT be what captures, and the click
     * half of the activation sequence must be. Together these say "if native
     * Enter→click ever stops reaching us, nothing else will paper over it" —
     * which is precisely the regression the e2e test guards.
     */
    it('does not capture from the dialog-level keydown handler alone — a bare keydown on Capture is inert', async () => {
      await renderDialog()

      const captureButton = screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)
      captureButton.focus()

      // A bare keydown is exactly what `handleKeyDown` sees. fireEvent returns
      // false when a handler called preventDefault(); the button's own default
      // activation must survive untouched.
      const notPrevented = fireEvent.keyDown(captureButton, { key: 'Enter' })

      expect(notPrevented).toBe(true)
      expect(mockCapturePhoto).not.toHaveBeenCalled()

      // ...so the capture can only come from the click that activation
      // synthesises. Native Enter→click is the browser's job; here it is
      // dispatched explicitly to show it is the live half of the path.
      await act(async () => {
        fireEvent.click(captureButton)
      })

      await waitFor(() => {
        expect(mockCapturePhoto).toHaveBeenCalledTimes(1)
      })
    })

    it('does not capture when Enter is pressed on a DISABLED Capture button', async () => {
      // Guards the bail-out from being widened into "Enter over any button is
      // a capture": while the camera is still starting there is nothing to
      // capture, and neither path may fire.
      mockHookReturn.isPreviewActive = false
      const user = userEvent.setup()
      await renderDialog()

      const captureButton = screen.getByTestId(TEST_IDS.CAMERA_BTN_CAPTURE)
      expect(captureButton).toBeDisabled()

      await act(async () => {
        await user.keyboard('{Enter}')
      })

      expect(mockCapturePhoto).not.toHaveBeenCalled()
    })
  })

  describe('live regions', () => {
    it('announces camera errors', async () => {
      mockHookReturn.error = { message: 'Camera is in use by another application.' }
      await renderDialog()

      const errorRegion = screen.getByTestId(TEST_IDS.CAMERA_ERROR)
      expect(errorRegion).toHaveAttribute('role', 'alert')
      // `role="alert"` already implies `aria-live="assertive"`. Spelling both
      // out is a documented double-speaking source in some screen-reader /
      // browser pairs, so the redundant attribute was removed.
      expect(errorRegion).not.toHaveAttribute('aria-live')
    })

    it('announces the preview-starting state politely', async () => {
      mockHookReturn.isPreviewActive = false
      await renderDialog()

      // The announcement no longer rides on the VISUAL loading block. That
      // block is unmounted on every state transition, and a live region that
      // arrives already carrying its text — or that disappears instead of being
      // emptied — announces nothing. The region is now a separate node that
      // stays mounted for the life of the dialog and only has its text swapped.
      const statusRegion = screen.getByRole('status')
      expect(statusRegion).toHaveTextContent('Starting camera...')
      // `role="status"` implies `aria-live="polite"`; see the error test above.
      expect(statusRegion).not.toHaveAttribute('aria-live')

      // The sighted-user affordance is unchanged.
      expect(
        screen.getByText('Starting camera...', { selector: '.camera-preview-loading span' })
      ).toBeInTheDocument()
    })
  })
})
