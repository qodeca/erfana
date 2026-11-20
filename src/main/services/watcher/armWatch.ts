// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * armWatch - the one place a native file watcher is created or re-created
 * (#478, plan decision 12): subscribe, the atomic-save re-arm, the error
 * re-arm, the health round, waitlist promotion, resume after a project-switch
 * suspend and the wake re-arm all come through here.
 *
 * Every arm first checks the file again, because whoever replaced it may have
 * left something else under its name:
 *
 * 1. `realpath` and `isInsideRoot(real, session.realRoot, caseSensitive)` – an
 *    in-project name that is now a link out of the project is refused
 *    (`outside-project`); a link to another in-project file passes (N2);
 * 2. `stat` of that resolved file must say `isFile()` (else `unsupported`).
 *
 * One arm runs per entry at a time: a second request while one is in flight
 * gets the running one's outcome instead of starting another, so the old
 * watcher is closed exactly once and one live watcher is left (F22, F46).
 */
import type { FSWatcher } from 'chokidar'
import { realpath as fsRealpath, stat as fsStat } from 'fs/promises'
import { isInsideRoot } from '../../utils/pathCompare'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'
import type { ArmOutcome, WatchEntry, WatchIdentity } from './watchTypes'

/** The file facts `armWatch` reads; `fs/promises` by default. */
export interface ArmFs {
  realpath(filePath: string): Promise<string>
  stat(filePath: string): Promise<{
    isFile(): boolean
    dev?: number
    ino?: number
    birthtimeMs?: number
  }>
}

/** What `armWatch` needs from `FileWatcherService`. */
export interface ArmWatchDeps {
  /** The open project, or null (no boundary to enforce, as the legacy entry check had none). */
  session(): ProjectSessionSnapshot | null
  /** The entry is still the one the service holds for its key. */
  isCurrent(entry: WatchEntry): boolean
  /** Build the watcher; `onReady` is called on its `ready`. */
  createWatcher(entry: WatchEntry, onReady: () => void): FSWatcher
  fs?: ArmFs
}

const defaultFs: ArmFs = { realpath: fsRealpath, stat: fsStat }

/**
 * (Re-)arm `entry`. With an arm already in flight, resolves with its outcome.
 * On anything but `armed`, the old watcher has not been replaced: the caller
 * decides how the watch ends.
 */
export function armWatch(entry: WatchEntry, deps: ArmWatchDeps): Promise<ArmOutcome> {
  if (entry.arming) return entry.arming
  const running = armOnce(entry, deps).finally(() => {
    if (entry.arming === running) entry.arming = null
  })
  entry.arming = running
  return running
}

async function armOnce(entry: WatchEntry, deps: ArmWatchDeps): Promise<ArmOutcome> {
  const checked = await checkTarget(entry.filePath, deps.session(), deps.fs)
  if (typeof checked === 'string') return checked
  if (!deps.isCurrent(entry)) return 'stale'

  // Close the old watcher before binding a new one: two watchers on one path
  // would overlap, and a single-file watcher costs a file handle
  const old = entry.watcher
  entry.watcher = null
  if (old) await closeQuietly(old)
  if (!deps.isCurrent(entry)) return 'stale'

  let markReady: (ready: boolean) => void = () => {}
  entry.ready = new Promise<boolean>(resolve => {
    markReady = resolve
  })
  try {
    entry.watcher = deps.createWatcher(entry, () => markReady(true))
  } catch {
    markReady(false)
    return 'failed'
  }
  entry.identity = checked.identity
  return 'armed'
}

/** A file that may be watched: its real path and the identity it has now. */
export interface CheckedTarget {
  readonly real: string
  /** `null` when the disk reports none, or `stat` could not answer. */
  readonly identity: WatchIdentity | null
}

/** Why a path may not be watched. */
export type TargetRefusal = Exclude<ArmOutcome, 'armed' | 'stale' | 'failed'>

/**
 * The re-check's answer (`inspectTarget`): `unresolved` is a `realpath` that
 * failed with something other than ENOENT – the path could not be resolved, so
 * it is neither shown inside nor shown outside the project.
 */
export type RecheckAnswer = CheckedTarget | TargetRefusal | 'unresolved'

/**
 * May `filePath` be watched? Its real path must be inside the session's real
 * root, by the session's case rule, and name a regular file.
 *
 * - `realpath` failing with ENOENT is `missing`; any other failure (EACCES,
 *   ELOOP, a Windows EPERM while the file is deleted) cannot be shown to be
 *   inside, so it is `outside-project` and the caller tells a delete from an
 *   escape.
 * - `stat` failing with ENOENT or ENOTDIR is `missing`; another failure (a
 *   lock, a denied stat) leaves the identity unknown and the arm goes on – the
 *   confinement check, which is the security property, has passed.
 */
export async function checkTarget(
  filePath: string,
  session: ProjectSessionSnapshot | null,
  fs: ArmFs = defaultFs
): Promise<CheckedTarget | TargetRefusal> {
  const answer = await inspectTarget(filePath, session, fs)
  return answer === 'unresolved' ? 'outside-project' : answer
}

/**
 * `checkTarget` without folding an unresolvable path into `outside-project`
 * (R2-1): a probe or read re-check must not end a watch over a Windows
 * delete-pending file (`realpath` EPERM), only over a path shown to escape.
 * Nothing is opened for `unresolved` either – it is not a pass.
 */
export async function inspectTarget(
  filePath: string,
  session: ProjectSessionSnapshot | null,
  fs: ArmFs = defaultFs
): Promise<RecheckAnswer> {
  let real: string
  try {
    real = await fs.realpath(filePath)
  } catch (error) {
    return errnoOf(error) === 'ENOENT' ? 'missing' : 'unresolved'
  }
  if (session && !isInsideRoot(real, session.realRoot, session.caseSensitive)) return 'outside-project'
  try {
    const stats = await fs.stat(real)
    if (!stats.isFile()) return 'unsupported'
    return { real, identity: identityOf(stats) }
  } catch (error) {
    const code = errnoOf(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
    return { real, identity: null }
  }
}

/** The identity a stat reports, or `null` when it reports none (a fake, or a volume without inodes). */
export function identityOf(stats: { dev?: number; ino?: number; birthtimeMs?: number }): WatchIdentity | null {
  if (typeof stats.ino !== 'number' || typeof stats.dev !== 'number') return null
  return { dev: stats.dev, ino: stats.ino, birthtimeMs: stats.birthtimeMs ?? 0 }
}

/** Close a watcher, ignoring a failure there is nobody left to act on. */
export async function closeQuietly(watcher: FSWatcher): Promise<void> {
  try {
    await watcher.close()
  } catch {
    // A watcher that refuses to close is already gone for our purposes
  }
}

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}
