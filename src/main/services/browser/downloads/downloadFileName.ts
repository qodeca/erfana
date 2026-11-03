// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file name a download is offered under (spec 025, 025-FR-020; spec
 * change S-18; panel finding S15).
 *
 * The page – through `Content-Disposition`, the `download` attribute or the
 * address – chooses the name. Before it reaches the save dialog it is made
 * safe on every platform:
 *
 * - **No path parts.** Only the last segment after `/` or `\` is kept, so a
 *   name cannot climb out of the folder the user picks.
 * - **Nothing hidden or reversed.** Control, bidi and invisible characters are
 *   removed (`sanitizePageText`), so "…txt.exe" cannot be drawn as
 *   "…exe.txt" (S-18).
 * - **Windows rules everywhere.** `deriveSafeFilename`: no leading dots, no
 *   `<>:"/\|?*`, no trailing dots or spaces, reserved names (`CON`, `NUL`,
 *   `COM1`…) prefixed with `_` – also when a space ends the stem, as in
 *   `CON .txt`, which Windows reads as `CON`.
 * - **Length.** At most {@link DOWNLOAD_NAME_MAX_CHARS}; a long name is cut in
 *   its stem, so the extension survives.
 * - An empty result is {@link DOWNLOAD_FALLBACK_NAME}.
 */
import { sanitizePageText } from '../../../../shared/browser/pageText'
import { cutAtCodeUnits } from '../../../../shared/browser/textCut'
import { deriveSafeFilename } from '../../../utils/validateFilename'

export const DOWNLOAD_FALLBACK_NAME = 'download'
export const DOWNLOAD_NAME_MAX_CHARS = 200
/** The longest extension kept whole when a name is cut. */
const MAX_EXTENSION_CHARS = 20
const RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s+$/i

/** `name` as a safe, single-segment file name. */
export function sanitizeDownloadName(name: string): string {
  const lastSegment = name.split(/[/\\]/).pop() ?? ''
  const cleaned = cutKeepingExtension(sanitizePageText(lastSegment, 4 * DOWNLOAD_NAME_MAX_CHARS))
  // Windows drops trailing dots and spaces in any mix ("name. ."), not just one run of each.
  let safe = deriveSafeFilename(cleaned, DOWNLOAD_FALLBACK_NAME).replace(/[\s.]+$/, '')
  if (safe === '') return DOWNLOAD_FALLBACK_NAME
  const stem = safe.split('.')[0]
  if (RESERVED_STEM.test(stem)) safe = `_${safe}`
  return safe
}

function cutKeepingExtension(name: string): string {
  if (name.length <= DOWNLOAD_NAME_MAX_CHARS) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= MAX_EXTENSION_CHARS ? name.slice(dot) : ''
  const stem = cutAtCodeUnits(name, DOWNLOAD_NAME_MAX_CHARS - extension.length).replace(/[\s.]+$/, '')
  return `${stem === '' ? DOWNLOAD_FALLBACK_NAME : stem}${extension}`
}
