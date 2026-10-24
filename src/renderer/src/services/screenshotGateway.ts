// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer screenshot gateway: the one place `window.api.screenshot` is read.
 *
 * Renderer code calls `screenshotGateway.<method>`, which forwards to the
 * preload bridge with the same contract ({@link ScreenshotBridge}). Keeping the
 * access in one module gives the renderer a single seam to change or fake.
 */
import type { ScreenshotBridge } from '../../../shared/ipc/screenshot-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` still lists this bridge, for the TerminalPanel files only (see preload/index.d.ts)
const bridge = (): ScreenshotBridge =>
  (window as unknown as { api: { screenshot: ScreenshotBridge } }).api.screenshot

export const screenshotGateway: ScreenshotBridge = {
  getDisplays: (...args) => bridge().getDisplays(...args),
  enumerateWindows: (...args) => bridge().enumerateWindows(...args),
  capture: (...args) => bridge().capture(...args),
  getCapabilities: (...args) => bridge().getCapabilities(...args),
  getScreenPermission: (...args) => bridge().getScreenPermission(...args)
}
