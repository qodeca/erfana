// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the address bar's in-use chips are fed (025-FR-019: an indicator that
 * stays for as long as a camera, microphone or screen capture lasts).
 *
 * Electron 44 tells the main process when a page asks for a capture (the
 * session's permission request handler and display-media handler), but not
 * when the capture ends: `webContents` has no capture event
 * (`media-started-playing`, `audio-state-changed` and `isBeingCaptured()` are
 * about playback and about the page being captured, not about the page
 * capturing), the DevTools protocol has no capture domain, and Chromium's
 * capture indicator is not exposed. Showing a chip from the grant until the
 * page navigates would outlast the capture; that is the owner's call, not
 * this module's (spec 025 owner queue).
 *
 * Until a producer exists, the app passes {@link MEDIA_CAPTURE_UNOBSERVED},
 * named, at the one place the tab service is built (`browserAppSetup.ts`):
 * `BrowserTab` and `BrowserTabService` require a producer, so no other code
 * can ship a placeholder.
 */
import type { TabMediaInUse } from '../../../../shared/ipc/browser-tab-schema'

/** No capture is reported: Electron 44 cannot say when one ends (see the module header). */
export const MEDIA_CAPTURE_UNOBSERVED: TabMediaInUse = Object.freeze({ camera: false, microphone: false, screen: false })
