// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

/**
 * Mount the area-select overlay instead of the main app when this renderer
 * was loaded by the dedicated overlay BrowserWindow.
 *
 * The trust signal is the presence of `window.overlayApi`, which is only
 * exposed by `src/preload/screenshotOverlay.ts`. That preload is wired in
 * `AreaSelectOverlay.createOverlayForDisplay` via
 * `webPreferences.preload = <overlay-preload>` — so any other renderer
 * (including the main editor window) cannot have `overlayApi` defined.
 *
 * Pre-round-2 this discriminator was a `location.hash` prefix check, which
 * Electron's `will-navigate` guard cannot block (per docs, the event only
 * fires on `loadURL`/anchor/`window.location` changes, not hash-only
 * navigations). A planted markdown anchor could in principle drive the main
 * renderer into the overlay mount; the preload-presence check closes that
 * (#164 round-2 F#2).
 *
 * The hash still carries `displayId=…` for the overlay component to read;
 * it just no longer doubles as the trust signal.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */
function isOverlayRoute(): boolean {
  return typeof window.overlayApi !== 'undefined'
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

if (isOverlayRoute()) {
  // Load the overlay (and its `ScreenshotOverlay.css`) via a dynamic import so the
  // bundler emits it as a separate chunk. A static top-level import would fold the
  // overlay's global `html, body, #root { cursor: crosshair; … }` rule into the MAIN
  // window's single-entry CSS bundle, leaking a crosshair cursor across the whole app.
  // The overlay window is transparent until a selection starts, so the extra microtask
  // before first paint is immaterial.
  void import('./components/Screenshot/ScreenshotOverlay').then(({ ScreenshotOverlay }) => {
    root.render(
      <React.StrictMode>
        <ScreenshotOverlay />
      </React.StrictMode>
    )
  })
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
