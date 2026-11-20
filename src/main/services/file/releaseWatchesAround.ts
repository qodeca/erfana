// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * releaseWatchesAround - the project tree's Delete runs with Erfana's own
 * watch handles under the item let go (#486).
 *
 * On Windows a handle anywhere below a folder blocks renaming it, and the
 * Recycle Bin moves a folder by renaming it; the in-use probe (`entryProbe.ts`)
 * renames too. Erfana itself holds such handles: a tab's file watch (libuv
 * watches a file through its folder) and the native directory watcher's
 * handles on a split folder's children. Without this wrapper a folder with an
 * open file in it answered "in use" and could not be deleted from the tree.
 *
 * {@link releasingWatches} wraps a remover: each owner releases its handles
 * under the item, the remover runs (trash, probe, permanent delete), and each
 * owner re-arms, whether the remover succeeded or not. Every step is
 * time-boxed: a release that does not answer in time does not hold the delete
 * up (its re-arm still runs once it answers), and a slow re-arm goes on in the
 * background. After this, only handles held by other programs – a terminal
 * whose working folder is inside, an editor with a file open – answer IN_USE.
 */
import { logger } from '../LoggingService'
import { redactPath, redactedLogError } from '../../utils/redactUserInput'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import type { EntryRemover } from './entryRemoval'

/** Arms again what a release let go. */
export type ReArm = () => Promise<void>

/** A watcher that can let go of its handles under a path. */
export interface WatchHandleOwner {
  /**
   * Close the handles that would stop `realPath` from being moved, until the
   * returned re-arm runs.
   */
  releaseUnder(realPath: string): Promise<ReArm>
}

/** How long one release or one re-arm may take before the delete goes on without it. */
export const WATCH_RELEASE_TIMEOUT_MS = 2_000

type Released =
  | { readonly kind: 'held'; readonly rearm: ReArm }
  | { readonly kind: 'late'; readonly pending: Promise<ReArm> }
  | { readonly kind: 'none' }

/**
 * `remove`, with every owner's watch handles under the entry let go while it
 * runs. Rejects as `remove` does; a release or re-arm failure is logged only.
 */
export function releasingWatches(
  remove: EntryRemover,
  owners: readonly WatchHandleOwner[],
  timeoutMs: number = WATCH_RELEASE_TIMEOUT_MS
): EntryRemover {
  return async (entryPath) => {
    const released = await Promise.all(owners.map((owner) => release(owner, entryPath, timeoutMs)))
    try {
      await remove(entryPath)
    } finally {
      await Promise.all(released.map((held) => rearm(held, entryPath, timeoutMs)))
    }
  }
}

async function release(owner: WatchHandleOwner, entryPath: string, timeoutMs: number): Promise<Released> {
  // Inside a promise, so an owner that throws at once is caught here as well
  const pending = Promise.resolve().then(() => owner.releaseUnder(entryPath))
  try {
    return { kind: 'held', rearm: await withTimeout(pending, timeoutMs, 'Watch release') }
  } catch (error) {
    if (error instanceof TimeoutError) {
      logger.warn('Watch release timed out; deleting anyway', { entry: redactPath(entryPath), timeoutMs })
      return { kind: 'late', pending }
    }
    logger.error('Watch release failed; deleting anyway', redactedLogError(error))
    return { kind: 'none' }
  }
}

async function rearm(released: Released, entryPath: string, timeoutMs: number): Promise<void> {
  if (released.kind === 'none') return
  if (released.kind === 'late') {
    // The release answered after the delete went on: re-arm whenever it does
    void released.pending.then((late) => late()).catch(logRearmFailure)
    return
  }
  const running = Promise.resolve().then(() => released.rearm())
  try {
    await withTimeout(running, timeoutMs, 'Watch re-arm')
  } catch (error) {
    if (!(error instanceof TimeoutError)) {
      logRearmFailure(error)
      return
    }
    logger.warn('Watch re-arm after a delete is slow; it goes on in the background', {
      entry: redactPath(entryPath),
      timeoutMs
    })
    running.catch(logRearmFailure)
  }
}

function logRearmFailure(error: unknown): void {
  logger.error('Re-arming watches after a delete failed', redactedLogError(error))
}
