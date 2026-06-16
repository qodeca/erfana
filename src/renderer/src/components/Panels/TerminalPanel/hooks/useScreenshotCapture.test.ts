// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useScreenshotCapture Hook
 *
 * Covers platform detection, display + window enumeration, screenshot
 * capture across outcomes, and error handling.
 *
 * @module TerminalPanel/hooks/useScreenshotCapture.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useScreenshotCapture } from './useScreenshotCapture'

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../../../utils/toastHelpers', () => ({
  showWarningToast: vi.fn(),
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
  showInfoToast: vi.fn()
}))

vi.mock('../../../../utils/shellPathEscape', () => ({
  escapePathForShell: vi.fn((path: string) => `'${path}'`)
}))

vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import {
  showWarningToast,
  showErrorToast,
  showSuccessToast,
  showInfoToast
} from '../../../../utils/toastHelpers'

// =============================================================================
// window.api mock
// =============================================================================

const mockGetDisplays = vi.fn()
const mockEnumerateWindows = vi.fn()
const mockCapture = vi.fn()
const mockGetPlatform = vi.fn()
const mockGetCapabilities = vi.fn()
const mockTerminalWrite = vi.fn()

Object.defineProperty(global.window, 'api', {
  writable: true,
  configurable: true,
  value: {
    screenshot: {
      getDisplays: mockGetDisplays,
      enumerateWindows: mockEnumerateWindows,
      capture: mockCapture,
      getCapabilities: mockGetCapabilities
    },
    terminal: {
      write: mockTerminalWrite
    },
    utils: {
      getPlatform: mockGetPlatform
    }
  }
})

// =============================================================================
// Helpers
// =============================================================================

const mockDisplay = {
  id: 1,
  label: 'Built-in Display',
  isPrimary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 }
}

const mockWindowSource = {
  id: 'window:42:0',
  name: 'Visual Studio Code',
  thumbnailDataUrl: 'data:image/png;base64,AAA='
}

function createRefs(terminalId: string | null = 'term-1', shellKind: 'posix' | 'cmd' | 'powershell' | null = 'posix') {
  return {
    terminalIdRef: { current: terminalId },
    shellKindRef: { current: shellKind },
    xtermRef: { current: { focus: vi.fn() } as unknown as React.RefObject<import('@xterm/xterm').Terminal | null>['current'] }
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('useScreenshotCapture', () => {
  beforeEach(() => {
    // #164 round-2 F#21: resetAllMocks (not clearAllMocks) so
    // `mockResolvedValueOnce` queues don't leak into the next case.
    vi.resetAllMocks()
    mockGetPlatform.mockReturnValue('darwin')
    mockGetDisplays.mockResolvedValue({ displays: [mockDisplay] })
    mockEnumerateWindows.mockResolvedValue({ sources: [mockWindowSource] })
    mockCapture.mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' })
    mockTerminalWrite.mockResolvedValue(undefined)
    // Default: macOS-style capabilities (supported, native picker). Tests
    // that exercise Windows / unsupported flows override per-test.
    mockGetCapabilities.mockResolvedValue({
      supported: true,
      hasNativeWindowPicker: true,
      areaCaptureMode: 'native'
    })
  })

  it('is a function', () => {
    expect(typeof useScreenshotCapture).toBe('function')
  })

  describe('platform detection', () => {
    it('reflects darwin capabilities (supported, native window picker)', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current.isScreenshotSupported).toBe(true)
        expect(result.current.hasNativeWindowPicker).toBe(true)
      })
    })

    it('reflects win32 capabilities (supported, in-app picker)', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: true,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'overlay'
      })
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current.isScreenshotSupported).toBe(true)
        expect(result.current.hasNativeWindowPicker).toBe(false)
      })
    })

    it('reports unsupported when main returns supported: false', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: false,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'unsupported'
      })
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current.isScreenshotSupported).toBe(false)
      })
    })
  })

  describe('initial displays', () => {
    it('fetches displays on mount when supported (darwin)', async () => {
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(mockGetDisplays).toHaveBeenCalledOnce()
        expect(result.current.displays).toEqual([mockDisplay])
      })
    })

    it('fetches displays on mount when supported (win32)', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: true,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'overlay'
      })
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(mockGetDisplays).toHaveBeenCalledOnce()
        expect(result.current.displays).toEqual([mockDisplay])
      })
    })

    it('does not fetch displays on unsupported platforms', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: false,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'unsupported'
      })
      const refs = createRefs()

      renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(mockGetDisplays).not.toHaveBeenCalled()
      })
    })
  })

  describe('return shape', () => {
    it('returns all expected properties', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current).toEqual(
          expect.objectContaining({
            isScreenshotSupported: expect.any(Boolean),
            hasNativeWindowPicker: expect.any(Boolean),
            capturingMode: null,
            displays: expect.any(Array),
            windowSources: expect.any(Array),
            showScreenSelectDialog: false,
            setShowScreenSelectDialog: expect.any(Function),
            showWindowPickerDialog: false,
            setShowWindowPickerDialog: expect.any(Function),
            refreshDisplays: expect.any(Function),
            refreshWindowSources: expect.any(Function),
            handleScreenshot: expect.any(Function)
          })
        )
      })
    })
  })

  describe('refreshDisplays', () => {
    it('updates displays state', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      const newDisplay = { ...mockDisplay, id: 2, label: 'External' }
      mockGetDisplays.mockResolvedValue({ displays: [mockDisplay, newDisplay] })

      let returned: unknown[]
      await act(async () => {
        returned = await result.current.refreshDisplays()
      })

      expect(result.current.displays).toHaveLength(2)
      expect(returned!).toHaveLength(2)
    })
  })

  describe('refreshWindowSources', () => {
    it('updates windowSources state', async () => {
      mockGetPlatform.mockReturnValue('win32')
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      let returned: unknown[]
      await act(async () => {
        returned = await result.current.refreshWindowSources()
      })

      expect(result.current.windowSources).toEqual([mockWindowSource])
      expect(returned!).toEqual([mockWindowSource])
    })
  })

  describe('handleScreenshot', () => {
    it('captures and writes path to terminal on success', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(mockCapture).toHaveBeenCalledWith({ mode: 'area' })
      expect(mockTerminalWrite).toHaveBeenCalledWith('term-1', "'/tmp/screenshot.png'")
      expect(showSuccessToast).toHaveBeenCalledWith('Screenshot captured', 'screenshot.png')
    })

    it('passes displayId for screen mode', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('screen', { displayId: 2 })
      })

      expect(mockCapture).toHaveBeenCalledWith({ mode: 'screen', displayId: 2 })
    })

    it('sends window-native on darwin (macOS native picker, no windowId)', async () => {
      // Default darwin capabilities — hasNativeWindowPicker: true.
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      // #164 round-2 D4: macOS uses the dedicated `window-native` variant
      // because the OS picker resolves the target window itself.
      expect(mockCapture).toHaveBeenCalledWith({ mode: 'window-native' })
    })

    it('sends window with windowId on Windows (in-app picker)', async () => {
      mockGetCapabilities.mockResolvedValueOnce({
        supported: true,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'overlay'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window', { windowId: 'window:42:0' })
      })

      expect(mockCapture).toHaveBeenCalledWith({ mode: 'window', windowId: 'window:42:0' })
    })

    it('shows warning when no terminal is open', async () => {
      const refs = createRefs(null)
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(mockCapture).not.toHaveBeenCalled()
      expect(showWarningToast).toHaveBeenCalledWith('No terminal', 'Open a terminal first')
    })

    it('silently returns on SCREENSHOT_CANCELLED', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_CANCELLED'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(showErrorToast).not.toHaveBeenCalled()
      expect(showWarningToast).not.toHaveBeenCalled()
    })

    it('shows error toast on SCREENSHOT_TIMEOUT', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_TIMEOUT'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('screen')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Timeout',
        'Screenshot capture timed out after 30 seconds'
      )
    })

    it('shows error toast on SCREENSHOT_PERMISSION_DENIED', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_PERMISSION_DENIED'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Permission required',
        'Grant screen recording permission in System Settings > Privacy & Security'
      )
    })

    it('shows error toast on SCREENSHOT_WINDOW_NOT_FOUND', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_WINDOW_NOT_FOUND'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Window unavailable',
        'The selected window is no longer available'
      )
    })

    it('shows error toast on SCREENSHOT_DISPLAY_NOT_FOUND', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_DISPLAY_NOT_FOUND'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('screen')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Display unavailable',
        'The selected display is no longer available'
      )
    })

    it('shows error toast on SCREENSHOT_OVERLAY_FAILED', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        errorCode: 'SCREENSHOT_OVERLAY_FAILED'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Overlay failed',
        'Could not open the area-selection overlay'
      )
    })

    it('shows generic error toast on unknown failure', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        error: 'Something went wrong'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(showErrorToast).toHaveBeenCalledWith('Capture failed', 'Something went wrong')
    })

    it('shows info toast when terminal closes during capture', async () => {
      const refs = createRefs('term-1')
      mockCapture.mockImplementation(async () => {
        refs.terminalIdRef.current = null
        return { success: true, filePath: '/tmp/shot.png' }
      })

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(mockTerminalWrite).not.toHaveBeenCalled()
      expect(showInfoToast).toHaveBeenCalledWith(
        'Terminal closed',
        'Screenshot saved to: /tmp/shot.png'
      )
    })

    it('handles Windows backslash-separated filename correctly', async () => {
      mockCapture.mockResolvedValue({
        success: true,
        filePath: 'C:\\Users\\me\\AppData\\Local\\Temp\\erfana-screenshot-1.png'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('screen')
      })

      expect(showSuccessToast).toHaveBeenCalledWith(
        'Screenshot captured',
        'erfana-screenshot-1.png'
      )
    })

    it('resets capturingMode after completion', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(result.current.capturingMode).toBeNull()
    })

    it('resets capturingMode after error', async () => {
      mockCapture.mockRejectedValue(new Error('Unexpected'))
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isScreenshotSupported).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(result.current.capturingMode).toBeNull()
      expect(showErrorToast).toHaveBeenCalledWith('Error', 'Screenshot capture failed unexpectedly')
    })
  })
})
