// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathPresence - is a watched path still there?
 *
 * Every watcher that turns "the file is gone" into a deleted banner asks this
 * one question, so they all answer it the same way: only an error that says
 * the path does not exist counts as gone. A file that is locked (`EBUSY`,
 * Windows), not readable for now (`EACCES`, `EPERM`) or on a drive that failed
 * in some other way is still there as far as the user is concerned, and a
 * false "deleted" banner over it is worse than a late one (#252).
 */
import { stat } from 'fs/promises'

/** Errors that mean the path is gone, rather than unreadable for now. */
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/**
 * True unless `stat` says the path is gone (`ENOENT`, or `ENOTDIR` when a
 * folder on the way is now a file). Any other failure counts as present.
 * Never throws.
 */
export async function pathIsPresent(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    return !(typeof code === 'string' && MISSING_CODES.has(code))
  }
}
