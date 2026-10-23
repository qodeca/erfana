// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathPresence - is a watched path still there?
 *
 * Every watcher that turns "the file is gone" into a deleted banner asks this
 * one question, so they all answer it the same way. A `stat` has three
 * outcomes, not two (#252):
 *
 * - `present` - it succeeded;
 * - `missing` - ENOENT, or ENOTDIR when a folder on the way is now a file;
 * - `unreadable` - any other failure: a file Windows has locked for a moment
 *   (EBUSY), one we may not look at (EPERM, EACCES), a drive that failed (EIO).
 *
 * Which way `unreadable` falls depends on the caller. The unseen-file probe
 * only polls, so for it an unreadable file is still there: a false banner is
 * worse than a late one. The unlink branch has just heard the file go away, so
 * it asks once more after a short wait and then takes a still-unreadable file
 * as gone: on Windows that is the usual sign of a file deleted while another
 * process held it open (delete pending), and keeping a watch on it would keep
 * its folder from being deleted at all.
 */
import { stat } from 'fs/promises'

/** Errors that mean the path is gone, rather than unreadable for now. */
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/** How long the unlink branch waits before asking again about an unreadable path. */
export const UNREADABLE_RECHECK_MS = 250

/** What one `stat` says about a path. */
export type PathPresence = 'present' | 'missing' | 'unreadable'

/** One `stat`, classified. Never throws. */
export async function probePath(filePath: string): Promise<PathPresence> {
  try {
    await stat(filePath)
    return 'present'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    return typeof code === 'string' && MISSING_CODES.has(code) ? 'missing' : 'unreadable'
  }
}

/** True unless `stat` says the path is gone: an unreadable path counts as present. Never throws. */
export async function pathIsPresent(filePath: string): Promise<boolean> {
  return (await probePath(filePath)) !== 'missing'
}

/**
 * For the unlink branch: true when the path is there, asking once more after
 * {@link UNREADABLE_RECHECK_MS} when it is unreadable, and false when it is
 * missing or still unreadable. Never throws.
 */
export async function isPresentAfterSettle(filePath: string): Promise<boolean> {
  const first = await probePath(filePath)
  if (first !== 'unreadable') return first === 'present'
  await new Promise(resolve => setTimeout(resolve, UNREADABLE_RECHECK_MS))
  return (await probePath(filePath)) === 'present'
}
