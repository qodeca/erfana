// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for DesktopCapturerScreenshotCapturer.
 *
 * Mocks Electron's `desktopCapturer`, `nativeImage`, and `screen` modules
 * to verify source-matching, multi-monitor crop, window enumeration, and
 * overlay coordination logic without spinning up a real BrowserWindow.
 *
 * The overlay is constructor-injected (#164 round-2 F#25) so tests pass a
 * stub `AreaSelectOverlay` instead of mocking the module's free function.
 *
 * #164 round-2 F#21: `vi.resetAllMocks` is used so `mockResolvedValueOnce`
 * queues don't leak across cases.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

const REAL_TMPDIR = os.tmpdir()

const mockGetSources = vi.fn()
const mockNativeImageCreateFromBuffer = vi.fn()
const mockGetAllDisplays = vi.fn()
const mockGetPrimaryDisplay = vi.fn()
const mockWriteFile = vi.fn(async () => undefined)
const mockTmpdir = vi.fn(() => REAL_TMPDIR)

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: mockGetSources
  },
  nativeImage: {
    createFromBuffer: mockNativeImageCreateFromBuffer
  },
  screen: {
    getAllDisplays: mockGetAllDisplays,
    getPrimaryDisplay: mockGetPrimaryDisplay
  }
}))

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  access: vi.fn(async () => undefined)
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    tmpdir: (...args: unknown[]) => mockTmpdir(...args)
  }
})

/**
 * Stub the overlay window module so the capturer module's top-level import
 * doesn't pull in `electron`'s real `BrowserWindow` (which fails to load in
 * the test environment). The stub matches the class shape the capturer
 * depends on via constructor injection — tests pass their own overlay
 * directly so this stub is never exercised.
 */
vi.mock('./ScreenshotOverlayWindow', () => ({
  AreaSelectOverlay: vi.fn().mockImplementation(() => ({
    selectArea: vi.fn(async () => null)
  }))
}))

vi.mock('../LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

function makeThumbnail(opts: { isEmpty?: boolean; pngLen?: number; cropResult?: ReturnType<typeof makeThumbnail>; size?: { width: number; height: number } } = {}) {
  return {
    isEmpty: () => opts.isEmpty ?? false,
    toPNG: () => Buffer.alloc(opts.pngLen ?? 16, 1),
    toDataURL: () => 'data:image/png;base64,AAA=',
    getSize: () => opts.size ?? { width: 320, height: 180 },
    crop: vi.fn(() => opts.cropResult ?? makeThumbnail())
  }
}

function makeDisplay(over: Partial<{ id: number; scaleFactor: number; bounds: { x: number; y: number; width: number; height: number }; size: { width: number; height: number } }> = {}) {
  const id = over.id ?? 1
  const size = over.size ?? { width: 1920, height: 1080 }
  return {
    id,
    label: `Display ${id}`,
    scaleFactor: over.scaleFactor ?? 1,
    bounds: over.bounds ?? { x: 0, y: 0, ...size },
    size
  }
}

/**
 * Stub overlay constructor-injected into the capturer. Tests resolve or
 * reject the underlying `selectArea()` promise as needed.
 */
function makeOverlayStub(impl: () => Promise<unknown>) {
  return { selectArea: vi.fn(impl) }
}

describe('DesktopCapturerScreenshotCapturer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockTmpdir.mockReturnValue(REAL_TMPDIR)
    mockGetAllDisplays.mockReturnValue([makeDisplay()])
    mockGetPrimaryDisplay.mockReturnValue(makeDisplay())
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('captureScreen', () => {
    it('writes the matched source PNG to a temp file', async () => {
      const display = makeDisplay({ id: 7, scaleFactor: 2 })
      mockGetAllDisplays.mockReturnValue([display])
      mockGetPrimaryDisplay.mockReturnValue(display)
      mockGetSources.mockResolvedValueOnce([{ id: 'screen:7', display_id: '7', thumbnail: makeThumbnail() }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'screen', displayId: 7 })

      expect(result.success).toBe(true)
      expect(result.filePath).toMatch(/erfana-screenshot-\d+\.png$/)
      expect(mockWriteFile).toHaveBeenCalled()
    })

    it('requests the thumbnail at physical pixel size', async () => {
      const display = makeDisplay({ id: 7, scaleFactor: 2 })
      mockGetAllDisplays.mockReturnValue([display])
      mockGetSources.mockResolvedValueOnce([{ id: 'screen:7', display_id: '7', thumbnail: makeThumbnail() }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      await capturer.capture({ mode: 'screen', displayId: 7 })

      expect(mockGetSources).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ['screen'],
          thumbnailSize: { width: 3840, height: 2160 }
        })
      )
    })

    it('returns SCREENSHOT_DISPLAY_NOT_FOUND when display vanished', async () => {
      mockGetAllDisplays.mockReturnValue([makeDisplay({ id: 1 })])
      mockGetPrimaryDisplay.mockReturnValue(makeDisplay({ id: 1 }))

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'screen', displayId: 999 })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_DISPLAY_NOT_FOUND')
    })

    it('returns SCREENSHOT_DISPLAY_NOT_FOUND when no source matches', async () => {
      mockGetSources.mockResolvedValueOnce([])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'screen' })

      expect(result.errorCode).toBe('SCREENSHOT_DISPLAY_NOT_FOUND')
    })

    it('falls back to the single available source when display_id is absent', async () => {
      mockGetSources.mockResolvedValueOnce([{ id: 'screen:only', display_id: '', thumbnail: makeThumbnail() }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'screen' })

      expect(result.success).toBe(true)
    })
  })

  describe('captureWindow', () => {
    it('returns SCREENSHOT_WINDOW_NOT_FOUND when window vanished', async () => {
      mockGetSources.mockResolvedValueOnce([{ id: 'window:1', thumbnail: makeThumbnail() }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'window', windowId: 'window:42' })

      expect(result.errorCode).toBe('SCREENSHOT_WINDOW_NOT_FOUND')
    })

    it('writes the matching window thumbnail PNG', async () => {
      const thumb = makeThumbnail()
      mockGetSources.mockResolvedValueOnce([{ id: 'window:42:0', name: 'VS Code', thumbnail: thumb }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'window', windowId: 'window:42:0' })

      expect(result.success).toBe(true)
      expect(mockWriteFile).toHaveBeenCalled()
    })

    it('rejects empty thumbnails as SCREENSHOT_FAILED', async () => {
      mockGetSources.mockResolvedValueOnce([{ id: 'window:42:0', name: 'X', thumbnail: makeThumbnail({ isEmpty: true }) }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'window', windowId: 'window:42:0' })

      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })

    it('returns SCREENSHOT_FAILED when getSources throws', async () => {
      mockGetSources.mockRejectedValueOnce(new Error('desktopCapturer unavailable'))

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({
        mode: 'window',
        windowId: 'window:42:0'
      })

      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })

    it('rejects empty PNG buffers as SCREENSHOT_FAILED', async () => {
      mockGetSources.mockResolvedValueOnce([
        { id: 'window:42:0', name: 'X', thumbnail: makeThumbnail({ pngLen: 0 }) }
      ])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({
        mode: 'window',
        windowId: 'window:42:0'
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })

    it('returns SCREENSHOT_FAILED when writeFile rejects with EACCES', async () => {
      mockGetSources.mockResolvedValueOnce([
        { id: 'window:42:0', name: 'X', thumbnail: makeThumbnail() }
      ])
      mockWriteFile.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({
        mode: 'window',
        windowId: 'window:42:0'
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
      expect(result.error).toBe('EACCES')
    })
  })

  describe('captureArea', () => {
    it('returns SCREENSHOT_CANCELLED when overlay resolves null', async () => {
      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      )
      const result = await capturer.capture({ mode: 'area' })

      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })

    it('returns SCREENSHOT_OVERLAY_FAILED when overlay rejects', async () => {
      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => {
          throw new Error('Could not load overlay')
        }) as never
      )
      const result = await capturer.capture({ mode: 'area' })

      expect(result.errorCode).toBe('SCREENSHOT_OVERLAY_FAILED')
    })

    it('crops the source by scaled selection coordinates and writes PNG', async () => {
      const display = makeDisplay({ id: 1, scaleFactor: 2 })
      mockGetAllDisplays.mockReturnValue([display])
      mockGetPrimaryDisplay.mockReturnValue(display)

      const cropResult = makeThumbnail()
      const sourceThumb = makeThumbnail({ cropResult })
      mockGetSources.mockResolvedValueOnce([{ id: 'screen:1', display_id: '1', thumbnail: sourceThumb }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => ({ displayId: 1, x: 10, y: 20, width: 100, height: 50 })) as never
      )
      const result = await capturer.capture({ mode: 'area' })

      expect(result.success).toBe(true)
      expect(sourceThumb.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 200, height: 100 })
    })

    it('returns SCREENSHOT_FAILED when cropped image is empty', async () => {
      const display = makeDisplay({ id: 1 })
      mockGetAllDisplays.mockReturnValue([display])
      mockGetPrimaryDisplay.mockReturnValue(display)

      const cropResult = makeThumbnail({ isEmpty: true })
      const sourceThumb = makeThumbnail({ cropResult })
      mockGetSources.mockResolvedValueOnce([{ id: 'screen:1', display_id: '1', thumbnail: sourceThumb }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capturer = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => ({ displayId: 1, x: 0, y: 0, width: 1, height: 1 })) as never
      )
      const result = await capturer.capture({ mode: 'area' })

      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })
  })

  describe('enumerateWindowsRaw', () => {
    it('maps sources into WindowSource records (incl. width/height from getSize)', async () => {
      mockGetSources.mockResolvedValueOnce([
        { id: 'window:1:0', name: 'A', thumbnail: makeThumbnail({ size: { width: 400, height: 225 } }) },
        { id: 'window:2:0', name: 'B', thumbnail: makeThumbnail() }
      ])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const sources = await new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).enumerateWindowsRaw()

      expect(sources).toHaveLength(2)
      expect(sources[0]).toMatchObject({ id: 'window:1:0', name: 'A', width: 400, height: 225 })
      expect(sources[0].thumbnailDataUrl).toMatch(/^data:image\/png/)
    })

    it('drops sources with empty thumbnails', async () => {
      mockGetSources.mockResolvedValueOnce([
        { id: 'window:1:0', name: 'A', thumbnail: makeThumbnail({ isEmpty: true }) },
        { id: 'window:2:0', name: 'B', thumbnail: makeThumbnail() }
      ])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const sources = await new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).enumerateWindowsRaw()

      expect(sources).toHaveLength(1)
      expect(sources[0].id).toBe('window:2:0')
    })

    it('substitutes a default name when source name is missing', async () => {
      mockGetSources.mockResolvedValueOnce([{ id: 'window:1:0', name: '', thumbnail: makeThumbnail() }])

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const sources = await new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).enumerateWindowsRaw()

      expect(sources[0].name).toBe('Untitled window')
    })

    it('returns empty list on failure (logged, not thrown)', async () => {
      mockGetSources.mockRejectedValueOnce(new Error('IPC down'))

      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const sources = await new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).enumerateWindowsRaw()

      expect(sources).toEqual([])
    })

    // #164 round-2 F#38: assert the explicit `thumbnailSize` argv defaults
    // here so the picker contract stays in sync with the constants module.
    it('requests picker-default thumbnail size by default', async () => {
      mockGetSources.mockResolvedValueOnce([])
      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      await new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).enumerateWindowsRaw()
      expect(mockGetSources).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ['window'],
          fetchWindowIcons: false,
          thumbnailSize: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
        })
      )
    })
  })

  describe('getCapabilities', () => {
    it('reports overlay-mode + no-native-picker (#164 round-2 F#6)', async () => {
      const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
      const capabilities = new DesktopCapturerScreenshotCapturer(
        makeOverlayStub(async () => null) as never
      ).getCapabilities()
      expect(capabilities).toEqual({
        supported: true,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'overlay'
      })
    })
  })

  it('path helper places files under os.tmpdir()', async () => {
    mockGetSources.mockResolvedValueOnce([{ id: 'screen:1', display_id: '1', thumbnail: makeThumbnail() }])

    const { DesktopCapturerScreenshotCapturer } = await import('./DesktopCapturerScreenshotCapturer')
    const capturer = new DesktopCapturerScreenshotCapturer(
      makeOverlayStub(async () => null) as never
    )
    const result = await capturer.capture({ mode: 'screen' })

    expect(result.filePath?.startsWith(REAL_TMPDIR)).toBe(true)
    expect(path.extname(result.filePath ?? '')).toBe('.png')
  })
})
