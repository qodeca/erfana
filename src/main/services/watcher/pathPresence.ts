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
 * - `unreadable` - any other failure: a file locked for a moment (EBUSY), one
 *   we may not look at (EPERM, EACCES), a drive that failed (EIO).
 *
 * An unreadable file counts as present: a false banner is worse than a late
 * one. There is one exception, in the unlink branch only
 * ({@link isPresentAfterSettle}). On Windows a file deleted while another
 * process holds it open answers EPERM or EBUSY until the last handle closes
 * (delete pending). Just after an unlink, such a file is asked once more after
 * a short wait and, if it answers the same way, taken as gone: keeping a watch
 * on it would keep its folder from being deleted at all. On other platforms,
 * and for every other code, an unreadable file stays present.
 */
import { stat } from 'fs/promises'

/** Errors that mean the path is gone, rather than unreadable for now. */
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/** What a Windows file answers while it is deleted under another process's open handle. */
const DELETE_PENDING_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY'])

/** How long the unlink branch waits before asking again about a possible delete pending. */
export const UNREADABLE_RECHECK_MS = 250

/** What one `stat` says about a path. */
export type PathPresence = 'present' | 'missing' | 'unreadable'

/** One `stat`'s outcome, with the errno code when it failed. */
interface StatOutcome {
  presence: PathPresence
  code?: string
}

/** One `stat`, classified, keeping the code. Never throws. */
async function statPath(filePath: string): Promise<StatOutcome> {
  try {
    await stat(filePath)
    return { presence: 'present' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (typeof code !== 'string') return { presence: 'unreadable' }
    return { presence: MISSING_CODES.has(code) ? 'missing' : 'unreadable', code }
  }
}

/** One `stat`, classified. Never throws. */
export async function probePath(filePath: string): Promise<PathPresence> {
  return (await statPath(filePath)).presence
}

/** True unless `stat` says the path is gone: an unreadable path counts as present. Never throws. */
export async function pathIsPresent(filePath: string): Promise<boolean> {
  return (await probePath(filePath)) !== 'missing'
}

/** Could this answer be a Windows delete pending? The platform is read per call, so tests can play either host. */
function mayBeDeletePending(outcome: StatOutcome): boolean {
  return process.platform === 'win32' && outcome.code !== undefined && DELETE_PENDING_CODES.has(outcome.code)
}

/**
 * For the unlink branch: is the file there? The same answer as
 * {@link pathIsPresent}, except for a possible Windows delete pending (EPERM or
 * EBUSY on win32). That file is asked once more after
 * {@link UNREADABLE_RECHECK_MS}, and is gone if it answers the same way again.
 * Never throws.
 */
export async function isPresentAfterSettle(filePath: string): Promise<boolean> {
  const first = await statPath(filePath)
  if (!mayBeDeletePending(first)) return first.presence !== 'missing'
  await new Promise(resolve => setTimeout(resolve, UNREADABLE_RECHECK_MS))
  const second = await statPath(filePath)
  return second.presence !== 'missing' && !mayBeDeletePending(second)
}
