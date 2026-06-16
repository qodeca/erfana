// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot capturer strategy interface (#164 Phase 3).
 *
 * Each implementation handles every mode for one platform family:
 * - `MacScreenshotCapturer` uses the native /usr/sbin/screencapture binary.
 * - `DesktopCapturerScreenshotCapturer` uses Electron's `desktopCapturer` API
 *   plus a renderer-driven overlay for area-select.
 *
 * The `ScreenshotService` picks one strategy at construction time based on
 * `process.platform` and delegates every call to it.
 *
 * The previous interface had three methods (`captureScreen` / `captureWindow`
 * / `captureArea`) with inconsistent argument requirements per platform —
 * macOS ignored `windowId`, Windows required it. The lens review flagged this
 * as an ISP/OCP violation (F[10]). Collapsing to a single `capture(request)`
 * that switches on the discriminated-union `mode` keeps each implementation
 * cohesive and makes the contract enforced by TypeScript.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import type {
  EnumerateWindowsRequest,
  ScreenshotCapabilities,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResponse,
  WindowSource
} from '../../../shared/ipc/screenshot-schema'

export interface IScreenshotCapturer {
  /**
   * Describe what this capturer can do (#164 round-2 F#6). The dispatcher
   * delegates `getCapabilities()` straight to the capturer instead of
   * branching on `process.platform` a second time, so any platform-routing
   * logic lives in exactly one place (the factory in `ScreenshotService.ts`).
   */
  getCapabilities(): ScreenshotCapabilities

  /**
   * List capturable windows for the picker UI — raw, unbounded, options-less.
   * The dispatcher applies pagination / `includeThumbnails` filtering and
   * annotates the result with the platform-level `availability` discriminator
   * (#164 round-2 F#8).
   *
   * The macOS capturer returns an empty list because the native screencapture
   * binary provides its own OS-level picker (`-iw`). The desktopCapturer
   * capturer returns the full list of window thumbnails for the picker.
   */
  enumerateWindowsRaw(): Promise<WindowSource[]>

  /**
   * Capture a screenshot according to the request's `mode`.
   *
   * The discriminated union (`'screen'` / `'window'` / `'window-native'` /
   * `'area'`) guarantees `windowId` is present exactly when needed
   * (#164 round-2 D4), so capturer implementations can switch on
   * `request.mode` without runtime existence checks.
   */
  capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse>
}

// Backwards-compat type re-export for any consumer still importing the old
// name (was used by the dispatcher pre-round-2). Re-exported through the
// minimal new shape so a future grep finds it.
export type LegacyEnumerateWindowsResult = { sources: WindowSource[]; truncated: boolean }
export type { EnumerateWindowsRequest }
