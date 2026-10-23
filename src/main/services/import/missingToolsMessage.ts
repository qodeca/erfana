// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { DependencyStatus } from './types'

/**
 * The note the native file picker shows (macOS only – `message` is ignored
 * elsewhere) when Office documents cannot be imported: their formats are left
 * out of "All importable files", and this says why. Null when LibreOffice is
 * found or detection has not finished.
 */
export function missingToolsDialogMessage(deps: DependencyStatus | null): string | null {
  if (!deps || deps.libreOffice === 'found') return null
  if (deps.libreOffice === 'unsafe') {
    return 'Office documents are not listed: the LibreOffice Erfana would run is in an unsafe location. Settings → Import tools has details.'
  }
  return 'Office documents need LibreOffice, so they are not listed. Settings → Import tools shows how to install it.'
}
