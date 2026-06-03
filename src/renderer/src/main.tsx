import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { ScreenshotOverlay } from './components/Screenshot/ScreenshotOverlay'

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
  root.render(
    <React.StrictMode>
      <ScreenshotOverlay />
    </React.StrictMode>
  )
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
