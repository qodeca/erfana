// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload screenshot bridge: the whole `window.api.screenshot` surface in its
 * own module, typed as {@link ScreenshotBridge} (the shared contract in
 * `screenshot-schema.ts`).
 *
 * The channel names are written out rather than imported from
 * `screenshot-channels.ts`: `screenshotOverlay.ts`, a second preload entry,
 * imports that module as a value, and a module both entries import becomes a
 * shared chunk that a sandboxed preload cannot `require` (the build refuses
 * it, `preload-self-contained`).
 *
 * The overlay-only verbs (`areaSelected` / `areaCancelled`) are intentionally
 * NOT here (#164 lens-review F[6]). They live in `screenshotOverlay.ts`, which
 * only the per-display area-select overlay windows load: exposing them to
 * every renderer would let any compromised window forge a selection or stall
 * an active capture.
 *
 * @see Issue #86 - original macOS screenshot capture
 * @see Issue #164 - Windows Phase 3 parity
 */
import { ipcRenderer } from 'electron'
import type { ScreenshotBridge } from '../shared/ipc/screenshot-schema'

export const screenshotBridge: ScreenshotBridge = {
  getDisplays: () => ipcRenderer.invoke('screenshot:getDisplays'),
  enumerateWindows: (request) => ipcRenderer.invoke('screenshot:enumerateWindows', request),
  capture: (request) => ipcRenderer.invoke('screenshot:capture', request),
  getCapabilities: () => ipcRenderer.invoke('screenshot:getCapabilities'),
  getScreenPermission: () => ipcRenderer.invoke('screenshot:getScreenPermission')
}
