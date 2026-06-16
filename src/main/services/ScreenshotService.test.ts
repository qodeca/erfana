// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ScreenshotService (dispatcher + factory).
 *
 * Verifies that:
 * - `pickCapturer` returns the right `IScreenshotCapturer` per `process.platform`.
 * - `createScreenshotService(stub)` routes every method through the injected
 *   capturer so tests can run without touching `process.platform`.
 *
 * #164 round-2 F#21: `vi.resetAllMocks` is used so `mockResolvedValueOnce`
 * queues don't leak across cases.
 *
 * Mode-specific behaviour lives in the per-capturer suites:
 * - `screenshot/MacScreenshotCapturer.test.ts`
 * - `screenshot/DesktopCapturerScreenshotCapturer.test.ts`
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity (Phase 3 refactor)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const macCapabilities = {
  supported: true,
  hasNativeWindowPicker: true,
  areaCaptureMode: 'native' as const
}
const desktopCapabilities = {
  supported: true,
  hasNativeWindowPicker: false,
  areaCaptureMode: 'overlay' as const
}

const macCapturer = {
  getCapabilities: vi.fn(() => macCapabilities),
  enumerateWindowsRaw: vi.fn(async () => []),
  capture: vi.fn(async () => ({ success: true, filePath: '/tmp/mac.png' }))
}

const desktopCapturer = {
  getCapabilities: vi.fn(() => desktopCapabilities),
  enumerateWindowsRaw: vi.fn(async () => []),
  capture: vi.fn(async () => ({ success: true, filePath: '/tmp/desktop.png' }))
}

const MacCtor = vi.fn().mockImplementation(() => macCapturer)
const DesktopCtor = vi.fn().mockImplementation(() => desktopCapturer)

vi.mock('./screenshot/MacScreenshotCapturer', () => ({
  MacScreenshotCapturer: MacCtor
}))

vi.mock('./screenshot/DesktopCapturerScreenshotCapturer', () => ({
  DesktopCapturerScreenshotCapturer: DesktopCtor
}))

vi.mock('./screenshot/sharedHelpers', () => ({
  listDisplays: vi.fn(() => [
    { id: 1, label: 'Primary', isPrimary: true, bounds: { x: 0, y: 0, width: 2560, height: 1600 } }
  ])
}))

function stubCapturer(capabilities = desktopCapabilities) {
  return {
    getCapabilities: vi.fn(() => capabilities),
    enumerateWindowsRaw: vi.fn(async () => []),
    capture: vi.fn(async () => ({ success: true, filePath: '/tmp/stub.png' }))
  }
}

describe('ScreenshotService dispatcher + factory', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    MacCtor.mockImplementation(() => macCapturer)
    DesktopCtor.mockImplementation(() => desktopCapturer)
    macCapturer.getCapabilities.mockReturnValue(macCapabilities)
    macCapturer.enumerateWindowsRaw.mockResolvedValue([])
    macCapturer.capture.mockResolvedValue({ success: true, filePath: '/tmp/mac.png' })
    desktopCapturer.getCapabilities.mockReturnValue(desktopCapabilities)
    desktopCapturer.enumerateWindowsRaw.mockResolvedValue([])
    desktopCapturer.capture.mockResolvedValue({ success: true, filePath: '/tmp/desktop.png' })
  })

  describe('pickCapturer', () => {
    it('returns MacScreenshotCapturer on darwin', async () => {
      const { pickCapturer } = await import('./ScreenshotService')
      pickCapturer('darwin')

      expect(MacCtor).toHaveBeenCalledTimes(1)
      expect(DesktopCtor).not.toHaveBeenCalled()
    })

    it('returns DesktopCapturerScreenshotCapturer on win32', async () => {
      const { pickCapturer } = await import('./ScreenshotService')
      pickCapturer('win32')

      expect(DesktopCtor).toHaveBeenCalledTimes(1)
      expect(MacCtor).not.toHaveBeenCalled()
    })

    it('returns an UnsupportedCapturer on linux (Erfana dropped Linux)', async () => {
      const { pickCapturer } = await import('./ScreenshotService')
      const capturer = pickCapturer('linux')

      expect(MacCtor).not.toHaveBeenCalled()
      expect(DesktopCtor).not.toHaveBeenCalled()
      const result = await capturer.capture({ mode: 'screen' })
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_NOT_SUPPORTED')
    })

    it('unsupported capturer reports supported: false', async () => {
      const { pickCapturer } = await import('./ScreenshotService')
      const capturer = pickCapturer('freebsd' as NodeJS.Platform)
      expect(capturer.getCapabilities()).toEqual({
        supported: false,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'unsupported'
      })
    })
  })

  describe('createScreenshotService (factory + injection)', () => {
    it('routes capture through the injected capturer', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer()
      const service = createScreenshotService(stub)

      const result = await service.capture({ mode: 'screen', displayId: 42 })
      expect(stub.capture).toHaveBeenCalledWith({ mode: 'screen', displayId: 42 })
      expect(result.filePath).toBe('/tmp/stub.png')
    })

    it('annotates enumerateWindows with native-picker availability on macOS', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer(macCapabilities)
      const service = createScreenshotService(stub)

      const response = await service.enumerateWindows()
      expect(response.availability).toBe('native-picker')
      expect(response.sources).toEqual([])
      // The dispatcher MUST NOT call the capturer's raw enumerator when the
      // platform reports a native picker.
      expect(stub.enumerateWindowsRaw).not.toHaveBeenCalled()
    })

    it('annotates enumerateWindows with unsupported availability when capabilities.supported is false', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer({
        supported: false,
        hasNativeWindowPicker: false,
        areaCaptureMode: 'unsupported'
      })
      const service = createScreenshotService(stub)

      const response = await service.enumerateWindows()
      expect(response.availability).toBe('unsupported')
      expect(response.sources).toEqual([])
    })

    it('applies maxSources cap and surfaces truncated flag', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer()
      stub.enumerateWindowsRaw.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `window:${i}:0`,
          name: `W${i}`,
          thumbnailDataUrl: 'data:image/png;base64,AAA=',
          width: 320,
          height: 180
        }))
      )
      const service = createScreenshotService(stub)

      const response = await service.enumerateWindows({ maxSources: 3 })
      expect(response.availability).toBe('enumerable')
      expect(response.sources).toHaveLength(3)
      expect(response.truncated).toBe(true)
    })

    it('strips thumbnailDataUrl when includeThumbnails: false', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer()
      stub.enumerateWindowsRaw.mockResolvedValue([
        {
          id: 'window:1:0',
          name: 'A',
          thumbnailDataUrl: 'data:image/png;base64,AAA=',
          width: 320,
          height: 180
        }
      ])
      const service = createScreenshotService(stub)

      const response = await service.enumerateWindows({ includeThumbnails: false })
      expect(response.availability).toBe('enumerable')
      if (response.availability === 'enumerable') {
        expect(response.sources[0].thumbnailDataUrl).toBe('')
      }
    })

    it('getDisplays uses the shared listDisplays helper (single source of truth)', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const service = createScreenshotService(stubCapturer())

      const displays = service.getDisplays()
      expect(displays).toHaveLength(1)
      expect(displays[0].isPrimary).toBe(true)
    })

    it('getCapabilities delegates to the injected capturer (#164 round-2 F#6)', async () => {
      const { createScreenshotService } = await import('./ScreenshotService')
      const stub = stubCapturer({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
      const service = createScreenshotService(stub)

      expect(service.getCapabilities()).toEqual({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
      expect(stub.getCapabilities).toHaveBeenCalled()
    })
  })
})
