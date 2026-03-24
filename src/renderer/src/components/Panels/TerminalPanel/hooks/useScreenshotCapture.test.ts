/**
 * Tests for useScreenshotCapture Hook
 *
 * Tests platform detection, display enumeration, screenshot capture
 * with various outcomes, and error handling.
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
const mockCapture = vi.fn()
const mockGetPlatform = vi.fn()
const mockTerminalWrite = vi.fn()

Object.defineProperty(global.window, 'api', {
  writable: true,
  configurable: true,
  value: {
    screenshot: {
      getDisplays: mockGetDisplays,
      capture: mockCapture
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

function createRefs(terminalId: string | null = 'term-1') {
  return {
    terminalIdRef: { current: terminalId },
    xtermRef: { current: { focus: vi.fn() } as unknown as React.RefObject<import('@xterm/xterm').Terminal | null>['current'] }
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('useScreenshotCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPlatform.mockReturnValue('darwin')
    mockGetDisplays.mockResolvedValue({ displays: [mockDisplay] })
    mockCapture.mockResolvedValue({ success: true, filePath: '/tmp/screenshot.png' })
    mockTerminalWrite.mockResolvedValue(undefined)
  })

  it('is a function', () => {
    expect(typeof useScreenshotCapture).toBe('function')
  })

  describe('platform detection', () => {
    it('sets isMacOS true on darwin', async () => {
      mockGetPlatform.mockReturnValue('darwin')
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current.isMacOS).toBe(true)
      })
    })

    it('sets isMacOS false on linux', async () => {
      mockGetPlatform.mockReturnValue('linux')
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(result.current.isMacOS).toBe(false)
      })
    })
  })

  describe('initial displays', () => {
    it('fetches displays on mount when macOS', async () => {
      const refs = createRefs()

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => {
        expect(mockGetDisplays).toHaveBeenCalledOnce()
        expect(result.current.displays).toEqual([mockDisplay])
      })
    })

    it('does not fetch displays on non-macOS', async () => {
      mockGetPlatform.mockReturnValue('win32')
      const refs = createRefs()

      renderHook(() => useScreenshotCapture(refs))

      // Give the useEffect time to run
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
            isMacOS: expect.any(Boolean),
            capturingMode: null,
            displays: expect.any(Array),
            showScreenSelectDialog: false,
            setShowScreenSelectDialog: expect.any(Function),
            refreshDisplays: expect.any(Function),
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

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

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

  describe('handleScreenshot', () => {
    it('captures and writes path to terminal on success', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(mockCapture).toHaveBeenCalledWith({ mode: 'area', displayId: undefined })
      expect(mockTerminalWrite).toHaveBeenCalledWith('term-1', "'/tmp/screenshot.png'")
      expect(showSuccessToast).toHaveBeenCalledWith('Screenshot captured', 'screenshot.png')
    })

    it('passes displayId for screen mode', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('screen', 2)
      })

      expect(mockCapture).toHaveBeenCalledWith({ mode: 'screen', displayId: 2 })
    })

    it('shows warning when no terminal is open', async () => {
      const refs = createRefs(null)
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

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

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

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

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

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

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(showErrorToast).toHaveBeenCalledWith(
        'Permission required',
        'Grant screen recording permission in System Settings > Privacy & Security'
      )
    })

    it('shows generic error toast on unknown failure', async () => {
      mockCapture.mockResolvedValue({
        success: false,
        error: 'Something went wrong'
      })
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(showErrorToast).toHaveBeenCalledWith('Capture failed', 'Something went wrong')
    })

    it('shows info toast when terminal closes during capture', async () => {
      const refs = createRefs('term-1')
      mockCapture.mockImplementation(async () => {
        // Simulate terminal closing during capture
        refs.terminalIdRef.current = null
        return { success: true, filePath: '/tmp/shot.png' }
      })

      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(mockTerminalWrite).not.toHaveBeenCalled()
      expect(showInfoToast).toHaveBeenCalledWith(
        'Terminal closed',
        'Screenshot saved to: /tmp/shot.png'
      )
    })

    it('resets capturingMode after completion', async () => {
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('window')
      })

      expect(result.current.capturingMode).toBeNull()
    })

    it('resets capturingMode after error', async () => {
      mockCapture.mockRejectedValue(new Error('Unexpected'))
      const refs = createRefs()
      const { result } = renderHook(() => useScreenshotCapture(refs))

      await waitFor(() => expect(result.current.isMacOS).toBe(true))

      await act(async () => {
        await result.current.handleScreenshot('area')
      })

      expect(result.current.capturingMode).toBeNull()
      expect(showErrorToast).toHaveBeenCalledWith('Error', 'Screenshot capture failed unexpectedly')
    })
  })
})
