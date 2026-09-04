// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dedicated preload for the hidden image-rasterize window (issue #73).
 *
 * Loaded ONLY by the window `ImageRasterizeWindow` creates. Keeping this
 * surface separate from `preload/index.ts` is the point: the harness page
 * decodes bytes from the user's project, including SVG, so it must not be able
 * to reach the app's IPC verbs — and, symmetrically, the app renderer must not
 * be able to forge a rasterize result. Note what is NOT here: `imageExport.run`
 * (the harness cannot start an export, only answer one) and `logging:log` — an
 * ungated one-way channel is not granted to the page that decodes untrusted
 * bytes for a convenience nothing uses.
 *
 * The per-export token (`--image-export-token=<uuid>`) is read once from
 * `process.argv` and attached to every outbound send. Main rejects any message
 * whose token does not match the export in flight. Mirrors the area-select
 * overlay's preload, including the reverse-argv walk and the UUID shape check.
 *
 * @see src/main/services/imageExport/ImageRasterizeWindow.ts for the other end
 */

import { contextBridge, ipcRenderer } from 'electron'
// TYPE-ONLY on purpose — see the channel constants below. A type import is
// erased before Rollup ever sees it, so it cannot pull this module into the
// bundle. Do NOT turn it back into a value import.
import type { IMAGE_EXPORT_CHANNELS } from '../shared/ipc/image-export-channels'

/**
 * The three harness channel names, spelled out here instead of imported.
 *
 * WHY the duplication: a sandboxed preload script is loaded as a standalone
 * file and cannot `require()` a relative path. As soon as two preload entries
 * (`index.ts` and this file) import the SAME module as a value, Rollup hoists
 * it into `out/preload/chunks/*.js` and gives BOTH entries a relative
 * `require` that throws at load time — `window.api` never appears and every
 * built app opens on the root error screen. Three short strings are cheaper
 * than that failure mode.
 *
 * WHY the duplication is safe: each constant is typed against the matching
 * property of the canonical `IMAGE_EXPORT_CHANNELS`, so renaming a channel in
 * `shared/ipc/image-export-channels.ts` fails `npm run typecheck` right here.
 * `imageExport.test.ts` asserts the same equality at runtime, and
 * `electron.vite.config.ts` fails the build if a shared preload chunk ever
 * reappears.
 *
 * @see src/shared/ipc/image-export-channels.ts - the canonical definitions
 */
type ImageExportChannels = typeof IMAGE_EXPORT_CHANNELS

/** Inlined `IMAGE_EXPORT_CHANNELS.HARNESS_READY` — see the note above. */
const HARNESS_READY_CHANNEL: ImageExportChannels['HARNESS_READY'] = 'image-export:harness-ready'
/** Inlined `IMAGE_EXPORT_CHANNELS.HARNESS_RENDER` — see the note above. */
const HARNESS_RENDER_CHANNEL: ImageExportChannels['HARNESS_RENDER'] = 'image-export:harness-render'
/** Inlined `IMAGE_EXPORT_CHANNELS.HARNESS_RESULT` — see the note above. */
const HARNESS_RESULT_CHANNEL: ImageExportChannels['HARNESS_RESULT'] = 'image-export:harness-result'

const TOKEN_ARG_PREFIX = '--image-export-token='

/**
 * Strict v1–v5 UUID. `crypto.randomUUID` emits v4; the wider range keeps this
 * working if the main side ever changes generator, while still rejecting
 * arbitrary text injected ahead of Electron's own `additionalArguments`.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Read the per-export token from `process.argv`.
 *
 * Walks argv in REVERSE, because Electron appends `additionalArguments` last:
 * if a parent process injected its own `--image-export-token=`, the real one
 * still wins. Returns `null` when absent or malformed, in which case every
 * send this window makes will be rejected main-side — which is the correct
 * outcome for a window launched outside the supported flow.
 */
function readExportToken(): string | null {
  for (let i = process.argv.length - 1; i >= 0; i--) {
    const arg = process.argv[i]
    if (!arg.startsWith(TOKEN_ARG_PREFIX)) continue
    const token = arg.slice(TOKEN_ARG_PREFIX.length)
    return UUID_PATTERN.test(token) ? token : null
  }
  return null
}

const exportToken = readExportToken()

contextBridge.exposeInMainWorld('imageExportApi', {
  /** Tell main the page's script has booted and can accept an instruction. */
  ready: (): void => {
    ipcRenderer.send(HARNESS_READY_CHANNEL, { token: exportToken })
  },

  /**
   * Subscribe to rasterize instructions. Called once at boot; an export may
   * send more than one instruction (the ICO contingency re-renders a slice).
   */
  onRender: (callback: (instruction: unknown) => void): void => {
    ipcRenderer.on(HARNESS_RENDER_CHANNEL, (_event, instruction) => {
      callback(instruction)
    })
  },

  /** Post one result back, tagged with the per-export token. */
  postResult: (result: object): void => {
    ipcRenderer.send(HARNESS_RESULT_CHANNEL, { ...result, token: exportToken })
  }
})
