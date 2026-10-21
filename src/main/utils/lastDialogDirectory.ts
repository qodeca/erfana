// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Remember the folder the user last picked in a native open/save dialog.
 *
 * Electron 43+ starts every `dialog.showOpenDialog` / `showSaveDialog` that
 * has no absolute `defaultPath` in the Downloads folder, and the OS no longer
 * restores the last-used folder on its own (Electron breaking changes,
 * "Dialog methods default to Downloads directory"). Electron's documented
 * remedy is to track the last folder in the app and pass it back, which is
 * what this module does – for the lifetime of the process, shared by every
 * dialog, as the OS did before.
 */

import { dirname, isAbsolute, join } from 'path'

let lastDirectory: string | undefined

/**
 * Return `options` with `defaultPath` pointed at the last-used folder.
 *
 * - no `defaultPath` → the last folder;
 * - a bare file name (`report.pdf`) → that name inside the last folder;
 * - an absolute `defaultPath` → left alone (the caller chose a place).
 *
 * Before any dialog has completed, `options` is returned unchanged.
 */
export function withLastDirectory<T extends { defaultPath?: string }>(options: T): T {
  if (lastDirectory === undefined) return options
  const { defaultPath } = options
  if (defaultPath === undefined || defaultPath === '') {
    return { ...options, defaultPath: lastDirectory }
  }
  if (isAbsolute(defaultPath)) return options
  return { ...options, defaultPath: join(lastDirectory, defaultPath) }
}

/**
 * Record the folder of a completed dialog. A cancelled or empty result
 * leaves the remembered folder as it was.
 *
 * @param picked - the chosen path (save dialog) or paths (open dialog)
 * @param isDirectory - true when the picked path IS the folder
 *   (an `openDirectory` dialog), so it is remembered as is
 */
export function rememberDialogResult(
  picked: string | readonly string[] | undefined,
  isDirectory = false
): void {
  const first = typeof picked === 'string' ? picked : picked?.[0]
  if (!first || !isAbsolute(first)) return
  lastDirectory = isDirectory ? first : dirname(first)
}

/** Test-only: forget the remembered folder. */
export function resetLastDialogDirectory(): void {
  lastDirectory = undefined
}
