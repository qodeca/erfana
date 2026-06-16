// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Area-selection overlay window for the cross-platform screenshot capturer.
 *
 * On platforms without an OS-level interactive area-select (Windows), we
 * spawn one frameless transparent always-on-top BrowserWindow per attached
 * display, each rendering the area-select React surface inside its own
 * viewport. Whichever overlay the user drags on first resolves the
 * selection; the rest are destroyed synchronously (#164 finding [2]).
 *
 * ## Security boundary (#164 Phase 2)
 *
 * - **Dedicated preload bundle** (`out/preload/screenshotOverlay.js`).
 *   The main editor renderer's preload does NOT expose the overlay verbs,
 *   so a compromised main renderer cannot forge `areaSelected` payloads
 *   even by directly calling `ipcRenderer.send` (F[6]).
 * - **Per-capture nonce token**. Every `selectArea()` mints a fresh UUID,
 *   passes it via `additionalArguments: ['--overlay-token=<uuid>']`, and
 *   the overlay preload reads it from `process.argv`. The main listener
 *   rejects any payload whose token does not match. This blocks the race
 *   where another renderer attaches to the global channel between listener
 *   attach and overlay load (F[5], F[7]).
 * - **Frame-scoped IPC**. The listeners are attached to each overlay's
 *   `webContents.mainFrame.ipc` rather than to the global `ipcMain`, so
 *   they cannot fire for sends from any other webContents (F[5]).
 * - **`will-navigate` guard** on each overlay window (defence-in-depth). The
 *   overlay can only ever be on its initial URL; a non-hash navigation
 *   attempt is denied. Note: per Electron docs `will-navigate` does NOT fire
 *   for `location.hash` changes — the renderer's `window.overlayApi`
 *   presence check (`main.tsx`) is the actual mount discriminator
 *   (#164 round-2 F#2). The hash is content, not a trust signal.
 * - **Explicit `webPreferences` hardening** (F[25] overlay-only).
 * - **Preload existence assertion** at construction time so a packaging
 *   regression is caught immediately instead of silently degrading to a
 *   no-preload overlay (F[26]).
 * - **Centralised cleanup** via `settle()` — no duplicated teardown code
 *   between the success path and the load-failure path (F[38]).
 *
 * Concurrency: a per-instance `isActive` field rejects overlapping
 * `selectArea()` calls. A `try/finally` guarantees the flag is cleared
 * even on a throw-before-listener-wiring path (#164 finding [9]).
 *
 * Lifecycle: create-per-capture, destroy-on-completion. The 60s shared
 * timeout (`SCREENSHOT.OVERLAY_TIMEOUT_MS`) covers every overlay in the
 * round so the user is never left with an invisible always-on-top window.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import { BrowserWindow, screen, type Display } from 'electron'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { SCREENSHOT } from '../../../shared/constants'
import {
  SCREENSHOT_CHANNELS,
  buildOverlayHash,
  buildDevOverlayUrl
} from '../../../shared/ipc/screenshot-channels'
import { AreaSelectionSchema, type AreaSelection } from '../../../shared/ipc/screenshot-schema'
import { logger } from '../LoggingService'

const OVERLAY_PRELOAD_RELATIVE = '../preload/screenshotOverlay.js'

/** Bounds the wait between BrowserWindow creation and `did-finish-load`. */
const PER_OVERLAY_LOAD_BUDGET_MS = 5_000

/**
 * Per-call lifecycle for a single multi-display area-select round.
 */
interface OverlayRound {
  overlays: BrowserWindow[]
  /** Per-overlay frame-scoped listener disposers. */
  disposers: Array<() => void>
  /** Round-wide cancel-after-timeout handle. */
  timeoutHandle: NodeJS.Timeout
  /** Per-overlay did-finish-load watchdogs, cleared once each load settles. */
  perOverlayLoadTimers: Array<NodeJS.Timeout>
  /** UUID minted at the start of the round and matched against every send. */
  token: string
}

export class AreaSelectOverlay {
  private isActive = false

  /**
   * Show overlays on every display and wait for the user to either drag-
   * select a rectangle on one of them or cancel (Escape / close / blur).
   *
   * Resolves with the selection (in CSS pixels relative to the chosen
   * overlay's viewport, plus the targeted `displayId`) or `null` on cancel
   * or timeout. Rejects only when an overlay window fails to load.
   */
  selectArea(): Promise<AreaSelection | null> {
    if (this.isActive) {
      logger.warn('selectArea called while another area-select is in progress')
      return Promise.resolve(null)
    }

    return new Promise<AreaSelection | null>((resolve, reject) => {
      this.isActive = true

      // Fail fast if the overlay preload is missing — without it, the
      // overlay window cannot communicate back and would hang for the full
      // 60s timeout (#164 F[26]).
      const preloadPath = join(__dirname, OVERLAY_PRELOAD_RELATIVE)
      if (!existsSync(preloadPath)) {
        this.isActive = false
        const err = new Error(`Screenshot overlay preload not found at ${preloadPath}`)
        logger.error('Overlay preload missing', err)
        reject(err)
        return
      }

      const displays = screen.getAllDisplays()
      if (displays.length === 0) {
        this.isActive = false
        resolve(null)
        return
      }

      let round: OverlayRound | null = null
      let settled = false

      const settle = (value: AreaSelection | null, error?: Error): void => {
        if (settled) return
        settled = true
        this.teardown(round)
        this.isActive = false
        if (error) reject(error)
        else resolve(value)
      }

      try {
        round = this.createRound(displays, preloadPath, settle)
      } catch (error) {
        this.isActive = false
        logger.error('Failed to create area-select overlays', error instanceof Error ? error : undefined)
        reject(error)
        return
      }

      const overlays = round.overlays
      // Per-overlay load promises (#164 round-2 F#5, F#15). Each overlay
      // gets its own watchdog so a slow GPU / antivirus first-load on one
      // display doesn't block the entire round. If at least one overlay
      // loads we proceed; failed siblings are destroyed silently with a
      // warn log.
      const loadPromises = overlays.map((overlay, idx) => {
        const displayId = displays[idx].id
        return new Promise<{ overlay: BrowserWindow; ok: boolean }>((resolveOne) => {
          const watchdog = setTimeout(() => {
            if (settled) return
            logger.warn(
              `Overlay for display ${displayId} did not finish loading within ${PER_OVERLAY_LOAD_BUDGET_MS}ms — destroying`
            )
            if (!overlay.isDestroyed()) overlay.destroy()
            resolveOne({ overlay, ok: false })
          }, PER_OVERLAY_LOAD_BUDGET_MS)
          round!.perOverlayLoadTimers.push(watchdog)

          this.loadOverlay(overlay, displayId)
            .then(() => {
              clearTimeout(watchdog)
              resolveOne({ overlay, ok: true })
            })
            .catch((error) => {
              clearTimeout(watchdog)
              logger.error(
                `Failed to load overlay for display ${displayId}`,
                error instanceof Error ? error : undefined
              )
              if (!overlay.isDestroyed()) overlay.destroy()
              resolveOne({ overlay, ok: false })
            })
        })
      })

      Promise.allSettled(loadPromises).then((results) => {
        // Belt-and-braces: clear any stragglers before showing.
        for (const t of round!.perOverlayLoadTimers) clearTimeout(t)
        round!.perOverlayLoadTimers = []
        if (settled) return

        const ready = results
          .map((r) => (r.status === 'fulfilled' ? r.value : null))
          .filter((r): r is { overlay: BrowserWindow; ok: boolean } => r !== null && r.ok && !r.overlay.isDestroyed())

        if (ready.length === 0) {
          logger.error('All area-select overlays failed to load')
          settle(null, new Error('All area-select overlays failed to load'))
          return
        }

        // Round-2 F#5: `setFullScreen(true)` after `show()` is non-atomic on
        // Windows and could force the transparent overlay opaque. The
        // `screen-saver` always-on-top level set in `createOverlayForDisplay`
        // is already sufficient on every supported platform; drop the
        // fullscreen escalation.
        for (const { overlay } of ready) overlay.show()
        ready[0].overlay.focus()
      })
    })
  }

  /**
   * Spawn one overlay BrowserWindow per display, wire frame-scoped IPC
   * listeners, and arm the shared timeout. The listeners filter by the
   * per-call token so any cross-renderer cross-talk is silently ignored.
   */
  private createRound(
    displays: Display[],
    preloadPath: string,
    settle: (value: AreaSelection | null) => void
  ): OverlayRound {
    const token = randomUUID()
    const overlays = displays.map((display) =>
      this.createOverlayForDisplay(display, preloadPath, token)
    )
    const disposers: Array<() => void> = []

    const handlePayload = (
      overlay: BrowserWindow,
      event: Electron.IpcMainEvent,
      kind: 'selected' | 'cancelled',
      payload: unknown
    ): void => {
      // Sender-frame validation (#164 round-2 F#13): even with frame-scoped
      // listeners, only accept payloads whose senderFrame URL exactly
      // matches the URL we asked the overlay to load. Closes the gap where
      // an unexpected navigation within the overlay process (or a future
      // multi-frame load) could spoof a selection.
      const expected = overlay.webContents.getURL()
      const senderUrl = event.senderFrame?.url
      if (!senderUrl || senderUrl !== expected) {
        logger.warn(`Overlay ${kind} payload rejected: sender frame mismatch`, {
          expected,
          got: senderUrl
        })
        return
      }
      if (!this.tokenMatches(payload, token)) {
        logger.warn(`Overlay ${kind} payload rejected: token mismatch`)
        return
      }
      if (kind === 'cancelled') {
        settle(null)
        return
      }
      const selection = (payload as { selection?: unknown }).selection
      const parsed = AreaSelectionSchema.safeParse(selection)
      if (!parsed.success) {
        logger.warn('Overlay sent malformed area selection', {
          issue: parsed.error.issues[0]?.message
        })
        settle(null)
        return
      }
      settle(parsed.data)
    }

    for (const overlay of overlays) {
      const ipc = overlay.webContents.mainFrame.ipc
      const onSelected = (event: Electron.IpcMainEvent, payload: unknown): void =>
        handlePayload(overlay, event, 'selected', payload)
      const onCancelled = (event: Electron.IpcMainEvent, payload: unknown): void =>
        handlePayload(overlay, event, 'cancelled', payload)
      ipc.on(SCREENSHOT_CHANNELS.AREA_SELECTED, onSelected)
      ipc.on(SCREENSHOT_CHANNELS.AREA_CANCELLED, onCancelled)
      disposers.push(() => {
        ipc.removeListener(SCREENSHOT_CHANNELS.AREA_SELECTED, onSelected)
        ipc.removeListener(SCREENSHOT_CHANNELS.AREA_CANCELLED, onCancelled)
      })
      overlay.on('closed', () => settle(null))
    }

    const timeoutHandle = setTimeout(() => {
      logger.warn('Area-select overlay timed out')
      settle(null)
    }, SCREENSHOT.OVERLAY_TIMEOUT_MS)

    return {
      overlays,
      disposers,
      timeoutHandle,
      perOverlayLoadTimers: [],
      token
    }
  }

  /**
   * Create a frameless transparent always-on-top overlay covering one display.
   * Hardened `webPreferences` so the default-tightening from finding [25]
   * applies at least to the overlay surface.
   */
  private createOverlayForDisplay(
    display: Display,
    preloadPath: string,
    token: string
  ): BrowserWindow {
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      fullscreenable: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: preloadPath,
        additionalArguments: [`--overlay-token=${token}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        nodeIntegrationInSubFrames: false
      }
    })
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // `will-navigate` guard: the overlay can only ever load its initial URL.
    // A planted href in markdown, a deep-link, or anything else trying to
    // navigate the overlay window away from the area-select route is denied
    // (#164 F[7]).
    overlay.webContents.on('will-navigate', (event, url) => {
      const current = overlay.webContents.getURL()
      if (url !== current) {
        logger.warn('Blocked overlay will-navigate', { from: current, to: url })
        event.preventDefault()
      }
    })

    return overlay
  }

  /**
   * Load the overlay route into a single overlay window. In dev the route
   * comes from the Vite dev server; in production the `loadFile` form with
   * `hash:` is used.
   */
  private loadOverlay(overlay: BrowserWindow, displayId: number): Promise<void> {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return overlay.loadURL(
        buildDevOverlayUrl(process.env['ELECTRON_RENDERER_URL'], displayId)
      )
    }
    return overlay.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: buildOverlayHash(displayId)
    })
  }

  /**
   * `true` iff the payload carries the expected per-call token.
   * Defensive type checks because the payload comes over the IPC bridge as
   * an unknown JSON value.
   */
  private tokenMatches(payload: unknown, expected: string): boolean {
    if (typeof payload !== 'object' || payload === null) return false
    const carried = (payload as { token?: unknown }).token
    return typeof carried === 'string' && carried === expected
  }

  /**
   * Centralised cleanup. Disposes per-overlay IPC listeners, clears the
   * round-wide timeout and any straggling per-overlay load watchdogs, then
   * destroys every overlay window in this round. Safe to call twice.
   */
  private teardown(round: OverlayRound | null): void {
    if (!round) return
    clearTimeout(round.timeoutHandle)
    for (const t of round.perOverlayLoadTimers) clearTimeout(t)
    round.perOverlayLoadTimers = []
    for (const dispose of round.disposers) dispose()
    for (const overlay of round.overlays) {
      overlay.removeAllListeners('closed')
      if (!overlay.isDestroyed()) {
        overlay.destroy()
      }
    }
  }
}

// #164 round-2 F#25: the module-level `areaSelectOverlay` singleton and the
// `selectArea()` free function were retired. `DesktopCapturerScreenshotCapturer`
// owns its overlay via constructor injection; tests pass a stub directly.
