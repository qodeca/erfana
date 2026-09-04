// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image-export IPC channel names.
 *
 * Two audiences, deliberately kept in one file so the whole surface of the
 * feature is visible at a glance:
 *
 * - `RUN` is the ONLY channel the app renderer can reach. It is registered
 *   globally (`ipcMain.handle`) and gated by `isTrustedSender`.
 * - The three `HARNESS_*` channels belong to the hidden rasterize window and
 *   are NEVER registered globally. `ImageRasterizeWindow` attaches them to
 *   that window's `webContents.mainFrame.ipc`, exactly as the screenshot
 *   overlay does, so a send from any other webContents cannot reach them.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 * @see src/shared/ipc/image-export-schema.ts for the payload shapes
 */

/**
 * Channel names for the image-export flow.
 *
 * SCREAMING_SNAKE keys, matching `screenshot-channels.ts`,
 * `import-channels.ts`, `system-channels.ts` and the rest.
 */
export const IMAGE_EXPORT_CHANNELS = {
  /** renderer → main, `ipcMain.handle` → `ImageExportResponse`. */
  RUN: 'image-export:run',
  /** harness → main, frame-scoped send: the page's script has booted. */
  HARNESS_READY: 'image-export:harness-ready',
  /** main → harness, send: one rasterize instruction. */
  HARNESS_RENDER: 'image-export:harness-render',
  /** harness → main, frame-scoped send: the result of one instruction. */
  HARNESS_RESULT: 'image-export:harness-result'
} as const

/** Union of every image-export channel name. */
export type ImageExportChannel = (typeof IMAGE_EXPORT_CHANNELS)[keyof typeof IMAGE_EXPORT_CHANNELS]
