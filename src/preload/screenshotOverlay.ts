// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dedicated preload for the area-select overlay BrowserWindow.
 *
 * Loaded only by the per-display overlay windows spawned by
 * `AreaSelectOverlay` (main). Keeping this surface separate from the main
 * `preload/index.ts` means the main editor window's renderer cannot reach
 * the overlay-only IPC verbs (#164 lens-review F[6]).
 *
 * The per-capture token (#164 F[7]) is read once from `process.argv`
 * (`--overlay-token=<uuid>`) and included on every outbound send. The
 * main-process listener in `AreaSelectOverlay` rejects any payload whose
 * token does not match the in-flight token, blocking the cross-renderer
 * cross-talk that the prior single-channel design left unguarded.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { SCREENSHOT_CHANNELS } from '../shared/ipc/screenshot-channels'
import type { AreaSelection } from '../shared/ipc/screenshot-schema'

const OVERLAY_TOKEN_ARG_PREFIX = '--overlay-token='

/**
 * Strict v4 UUID — what {@link crypto.randomUUID} on the main side emits.
 * We accept v1–v5 to remain compatible with any future change in the main
 * process while still rejecting arbitrary attacker-supplied junk.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Extract the per-capture overlay token from `process.argv`. Returns `null`
 * if the flag is absent or malformed, in which case the overlay window has
 * been launched outside the supported main-process flow and its IPC sends
 * will be rejected by the listener.
 *
 * Defence-in-depth (#164 round-2 F#39): walk argv in reverse and accept only
 * a syntactically-valid UUID. A `process.argv` with multiple `--overlay-token=`
 * entries — for example because a parent process injected its own before
 * Electron appended ours — picks up the last one (Electron's own
 * `additionalArguments` are appended last). Arbitrary attacker text after
 * the prefix is rejected by the UUID check before it can leak into IPC.
 */
function readOverlayToken(): string | null {
  for (let i = process.argv.length - 1; i >= 0; i--) {
    const arg = process.argv[i]
    if (!arg.startsWith(OVERLAY_TOKEN_ARG_PREFIX)) continue
    const token = arg.slice(OVERLAY_TOKEN_ARG_PREFIX.length)
    return UUID_PATTERN.test(token) ? token : null
  }
  return null
}

const overlayToken = readOverlayToken()

contextBridge.exposeInMainWorld('overlayApi', {
  /**
   * Post the chosen area rectangle back to main, tagged with the per-capture
   * token. Selection coords are in CSS pixels relative to the overlay
   * window's viewport.
   */
  areaSelected: (selection: AreaSelection): void => {
    ipcRenderer.send(SCREENSHOT_CHANNELS.AREA_SELECTED, { token: overlayToken, selection })
  },

  /**
   * Tell main the user cancelled (Escape / blur / close-without-drag).
   */
  areaCancelled: (): void => {
    ipcRenderer.send(SCREENSHOT_CHANNELS.AREA_CANCELLED, { token: overlayToken })
  }
})
