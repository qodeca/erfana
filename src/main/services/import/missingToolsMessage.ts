// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { DependencyStatus } from './types'

/**
 * The note the native file picker shows (macOS only – `message` is ignored
 * elsewhere) when a tool is missing: its formats are left out of "All
 * importable files", and this says why. Null when nothing is missing or
 * detection has not finished.
 */
export function missingToolsDialogMessage(deps: DependencyStatus | null): string | null {
  if (!deps) return null
  const missing: string[] = []
  if (!deps.libreOffice) missing.push('Office documents need LibreOffice')
  if (!deps.imageMagick) missing.push('images need ImageMagick')
  if (missing.length === 0) return null
  const first = missing[0].charAt(0).toUpperCase() + missing[0].slice(1)
  const list = [first, ...missing.slice(1)].join(' and ')
  return `${list}, so they are not listed. Settings → Import tools shows how to install them.`
}
