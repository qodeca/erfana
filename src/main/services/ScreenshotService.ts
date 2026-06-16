// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot Service
 *
 * Thin dispatcher: picks a platform-appropriate `IScreenshotCapturer` at
 * construction time and routes every method through it. The interesting
 * code lives in `screenshot/MacScreenshotCapturer` (native /usr/sbin/screencapture)
 * and `screenshot/DesktopCapturerScreenshotCapturer` (Electron desktopCapturer
 * + overlay window for area selection).
 *
 * Platform routing (#164 Phase 3):
 * - `darwin` → MacScreenshotCapturer (preserves the polished native UX)
 * - `win32` → DesktopCapturerScreenshotCapturer
 * - other → `UnsupportedCapturer` (Linux has been dropped from Erfana per
 *   CHANGELOG v0.11.2; macOS x64 was retired in v0.11.2).
 *
 * Use `createScreenshotService(capturer?)` instead of the previous module-eval
 * singleton so:
 * - Tests inject a stub `IScreenshotCapturer` without `vi.mock('process')`.
 * - The IPC handler registration accepts the service as a parameter, matching
 *   the project's `register*Handlers(service?)` convention (cf. `registerProjectLockHandlers`).
 *
 * @see Issue #86 - original macOS implementation
 * @see Issue #164 - Windows Phase 3 parity
 * @see Issue #164 lens-review F[8], F[10], F[16], F[31] - Phase 3 refactor
 */

import { ErrorCode } from '../../shared/errors'
import { WINDOW_PICKER } from '../../shared/constants'
import type {
  DisplayInfo,
  EnumerateWindowsRequest,
  EnumerateWindowsResponse,
  ScreenshotCapabilities,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  WindowSource
} from '../../shared/ipc/screenshot-schema'
import { DesktopCapturerScreenshotCapturer } from './screenshot/DesktopCapturerScreenshotCapturer'
import { MacScreenshotCapturer } from './screenshot/MacScreenshotCapturer'
import { listDisplays } from './screenshot/sharedHelpers'
import type { IScreenshotCapturer } from './screenshot/types'

/**
 * Sentinel capturer used on unsupported platforms (Linux, and anything else
 * that isn't darwin or win32). Every method short-circuits with
 * `SCREENSHOT_NOT_SUPPORTED` so the renderer cannot accidentally invoke a
 * capture that can never succeed (#164 F[16]).
 */
class UnsupportedCapturer implements IScreenshotCapturer {
  getCapabilities(): ScreenshotCapabilities {
    return { supported: false, hasNativeWindowPicker: false, areaCaptureMode: 'unsupported' }
  }
  async enumerateWindowsRaw(): Promise<WindowSource[]> {
    return []
  }
  async capture(_request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse> {
    return {
      success: false,
      error: 'Screenshot capture is not supported on this platform',
      errorCode: ErrorCode.SCREENSHOT_NOT_SUPPORTED
    }
  }
}

export interface IScreenshotService {
  getDisplays(): DisplayInfo[]
  getCapabilities(): ScreenshotCapabilities
  enumerateWindows(options?: EnumerateWindowsRequest): Promise<EnumerateWindowsResponse>
  capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse>
}

class ScreenshotService implements IScreenshotService {
  constructor(private readonly capturer: IScreenshotCapturer) {}

  getDisplays(): DisplayInfo[] {
    return listDisplays()
  }

  /**
   * Delegates straight to the capturer (#164 round-2 F#6). Pre-round-2 this
   * called a separate `computeCapabilities(process.platform)` which made
   * `process.platform` reachable from two code paths (here and `pickCapturer`).
   * Now the capturer owns its own capability description; the factory is the
   * only platform-routing site.
   */
  getCapabilities(): ScreenshotCapabilities {
    return this.capturer.getCapabilities()
  }

  /**
   * Apply pagination, the `includeThumbnails` opt-out, and the
   * availability discriminator at the service layer (#164 round-2 F#8).
   * Capturers stay focused on producing the raw list; policy lives here.
   */
  async enumerateWindows(options?: EnumerateWindowsRequest): Promise<EnumerateWindowsResponse> {
    const capabilities = this.capturer.getCapabilities()
    if (!capabilities.supported) {
      return { availability: 'unsupported', sources: [], truncated: false }
    }
    if (capabilities.hasNativeWindowPicker) {
      // macOS — `screencapture -iw` handles selection inside the binary.
      return { availability: 'native-picker', sources: [], truncated: false }
    }

    const includeThumbnails = options?.includeThumbnails ?? true
    const cap = options?.maxSources ?? WINDOW_PICKER.MAX_SOURCES

    const raw = await this.capturer.enumerateWindowsRaw()
    const truncated = raw.length > cap
    const limited = truncated ? raw.slice(0, cap) : raw
    const sources = includeThumbnails
      ? limited
      : limited.map((s) => ({ ...s, thumbnailDataUrl: '' }))

    return { availability: 'enumerable', sources, truncated }
  }

  capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse> {
    return this.capturer.capture(request)
  }
}

/**
 * Pick the right capturer for the running platform. Exported separately so
 * tests can inspect the choice without re-implementing the switch.
 */
export function pickCapturer(platform: NodeJS.Platform): IScreenshotCapturer {
  if (platform === 'darwin') return new MacScreenshotCapturer()
  if (platform === 'win32') return new DesktopCapturerScreenshotCapturer()
  return new UnsupportedCapturer()
}

/**
 * Factory: build a service either with an explicit capturer (tests) or by
 * picking based on `process.platform` (production).
 *
 * Replaces the module-eval singleton that previously froze the platform
 * choice at import time (#164 F[8]).
 */
export function createScreenshotService(capturer?: IScreenshotCapturer): IScreenshotService {
  return new ScreenshotService(capturer ?? pickCapturer(process.platform))
}

export { ScreenshotService }
