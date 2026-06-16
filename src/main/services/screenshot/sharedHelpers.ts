// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared helpers used by both screenshot capturer strategies.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import { access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SCREENSHOT } from '../../../shared/constants'
import { screen, type Display } from 'electron'
import type { DisplayInfo } from '../../../shared/ipc/screenshot-schema'

/**
 * Generate an absolute temp-file path for a single screenshot.
 *
 * Output paths look like `<os-tmp>/erfana-screenshot-1717420800123.png`.
 * The timestamp prevents collisions between rapid back-to-back captures.
 */
export function generateScreenshotPath(): string {
  return join(
    tmpdir(),
    `${SCREENSHOT.TEMP_PREFIX}${Date.now()}${SCREENSHOT.FILE_EXTENSION}`
  )
}

/**
 * Promisified `setTimeout` for sequencing async waits.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `true` if the file at `filePath` exists and is readable.
 * Distinguishes "user cancelled capture" (no file) from "capture succeeded".
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a `displayId` to an Electron `Display`.
 *
 * Returns the primary display when `displayId` is undefined, mirroring the
 * "no display picked → use primary" UX the macOS capturer relies on.
 * Returns `null` when `displayId` is provided but not found — callers should
 * surface `SCREENSHOT_DISPLAY_NOT_FOUND` to the user rather than silently
 * fall back, because a vanished display usually means the user unplugged a
 * monitor mid-capture.
 */
export function resolveDisplay(displayId?: number): Display | null {
  if (displayId === undefined) {
    return screen.getPrimaryDisplay()
  }
  const match = screen.getAllDisplays().find((d) => d.id === displayId)
  return match ?? null
}

/**
 * Enumerate all attached displays in the renderer-friendly `DisplayInfo`
 * shape. Single source of truth for display listing — both capturers used
 * to copy this code, which the lens review flagged as `Copy-Paste Programming`
 * (#164 F[30]).
 */
export function listDisplays(): DisplayInfo[] {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  return displays.map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    isPrimary: display.id === primaryId,
    bounds: display.bounds
  }))
}
