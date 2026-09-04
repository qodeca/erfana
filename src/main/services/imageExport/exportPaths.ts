// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where an exported image is suggested to go, and whether it may go there.
 *
 * Two pure functions and one filesystem check:
 *
 * - `suggestExportFilename` builds the `defaultPath` the native save dialog
 *   opens on — same folder, same base name, safe on every platform.
 * - `forceExtension` makes sure the user's chosen path really ends in the
 *   format they asked for, because macOS's save panel lets them type anything.
 * - `isSameExistingFile` is the guard that stops an export overwriting the
 *   very image it is exporting.
 *
 * The destination is deliberately NOT confined to the project: it comes from
 * the native save dialog, so it is the user's own explicit choice (the same
 * asymmetry `PdfService` and `DocxService` already ship). The one thing the
 * user cannot be allowed to do by accident is destroy their source, which is
 * what the collision guard exists for.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { basename, dirname, extname, join } from 'path'
import { realpath } from 'fs/promises'
import { deriveSafeFilename } from '../../utils/validateFilename'

/** Suffix added when the suggested name would collide with the source file. */
const COLLISION_SUFFIX = '-export'

/** Fallback base name when the source name sanitizes away to nothing. */
const FALLBACK_BASENAME = 'image'

/**
 * Build the path the save dialog should open on.
 *
 * The source folder, the source base name, and the target extension. The base
 * name goes through `deriveSafeFilename`, which handles Windows-reserved
 * basenames (`CON` → `_CON`), invalid characters, C0 controls, bidi overrides
 * and leading dots — so a legal-on-macOS name cannot produce an unsaveable
 * suggestion on Windows.
 *
 * `-export` is appended only when the sanitized suggestion would land on the
 * source file itself (comparing case-insensitively, because both macOS and
 * Windows have case-insensitive filesystems by default). That is why
 * `CON.png` becomes `_CON.png` and not `_CON-export.png`: once sanitized, the
 * name no longer collides.
 *
 * @param sourcePath - Absolute path to the image being exported.
 * @param targetExtension - `.png` or `.pdf`, including the dot.
 * @returns An absolute path in the source's folder.
 *
 * @example
 * ```ts
 * suggestExportFilename('/p/a.png', '.png') // '/p/a-export.png'
 * suggestExportFilename('/p/a.gif', '.png') // '/p/a.png'
 * ```
 */
export function suggestExportFilename(sourcePath: string, targetExtension: string): string {
  const sourceName = basename(sourcePath)
  const sourceExtension = extname(sourcePath)
  const safeBase = deriveSafeFilename(
    basename(sourcePath, sourceExtension),
    FALLBACK_BASENAME
  )

  const candidate = `${safeBase}${targetExtension}`
  const name =
    candidate.toLowerCase() === sourceName.toLowerCase()
      ? `${safeBase}${COLLISION_SUFFIX}${targetExtension}`
      : candidate

  return join(dirname(sourcePath), name)
}

/**
 * Guarantee the chosen path ends in the target extension.
 *
 * Matches the existing `PdfService` behaviour: compare case-insensitively and
 * APPEND rather than replace, so `report.v2` becomes `report.v2.png` instead
 * of losing the `.v2`.
 *
 * @param chosenPath - Whatever the save dialog returned.
 * @param targetExtension - `.png` or `.pdf`, including the dot.
 */
export function forceExtension(chosenPath: string, targetExtension: string): string {
  return chosenPath.toLowerCase().endsWith(targetExtension.toLowerCase())
    ? chosenPath
    : `${chosenPath}${targetExtension}`
}

/** `true` for the one errno that means "this path simply is not there yet". */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Would writing to `chosenPath` overwrite `sourcePath`?
 *
 * Both ends go through `realpath`, so a symlink, a `..` segment, a macOS
 * `/tmp` → `/private/tmp` alias or a Windows 8.3 short name cannot smuggle the
 * source in under another spelling.
 *
 * **Fails closed.** ENOENT on either side means the path is not there, which
 * for a save target is the normal case and is safe (`false`). Any other errno
 * — EACCES, ELOOP, ENOTDIR — means the question could not be ANSWERED, and the
 * caller must refuse rather than risk destroying the user's original. This is
 * the same fail-closed rule `projectConfinement.classifyConfinement` applies
 * to its `unverifiable` verdict.
 *
 * @param chosenPath - Where the user asked to write.
 * @param sourcePath - The image being exported.
 * @returns `true` when the write must be refused.
 */
export async function isSameExistingFile(
  chosenPath: string,
  sourcePath: string
): Promise<boolean> {
  let realSource: string
  try {
    realSource = await realpath(sourcePath)
  } catch (error) {
    return !isNotFound(error)
  }

  let realChosen: string
  try {
    realChosen = await realpath(chosenPath)
  } catch (error) {
    return !isNotFound(error)
  }

  return realChosen === realSource
}
