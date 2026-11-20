// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * writeFinishGate - hold a file's `change` until its writes have settled.
 *
 * It replaces chokidar's own `awaitWriteFinish` for single-file watches
 * (#464). chokidar 5.0.0 keeps a "pending write" entry per path while it polls
 * the file's size; when one of those `stat` calls fails – the file is briefly
 * missing or locked mid-write (a delete-then-rename writer, `git checkout`, an
 * antivirus scan on Windows) – it returns without clearing the entry, and from
 * then on every `change` for the path only touches that dead entry. The watch
 * looks alive and reports nothing again, so an open preview silently stops
 * refreshing.
 *
 * This gate does the same job and always ends a wait: a failed `stat` counts
 * as "still being written" and polling goes on, a wait longer than
 * `maxWaitMs` ends it (emitting the change unless the file is gone – the
 * unlink path reports a delete), and `cancel()` drops a wait outright.
 *
 * A change emitted at the cap is **forced** (#478, decision 34, F8): the file
 * may still be being written, so the reader settles before it reads rather
 * than showing a partial file. A settled change carries the stat-only stamp of
 * the last poll – the version the writes settled at – so the reader can tell
 * it from a file a new writer has started on since (P3).
 *
 * @module writeFinishGate
 */
import { stat as fsStat } from 'fs/promises'
import type { FileStamp } from '../../../shared/freshness/freshnessTypes'
import { stampFromStats } from '../freshness/stampStats'

/** Timings for {@link createWriteFinishGate}. */
export interface WriteFinishOptions {
  /** How long the file size must stay the same before the change is emitted. */
  stabilityThreshold: number
  /** How often the size is checked while waiting. */
  pollInterval: number
  /** The longest one wait may last before it ends on its own. Default 5000 ms. */
  maxWaitMs?: number
}

/** What the gate needs from the outside, injectable for tests. */
export interface WriteFinishDeps {
  /** `fs.stat` with a callback: `size` is compared; `stamp`, when given, goes with a settled change. */
  stat?: (
    path: string,
    cb: (err: NodeJS.ErrnoException | null, stats?: { size: number; stamp?: FileStamp }) => void
  ) => void
  /** Clock, in ms. */
  now?: () => number
  /** True once the watch is closed: a pending poll then stops quietly. */
  isClosed?: () => boolean
}

export interface WriteFinishGate {
  /** A change was seen: start a wait, or extend the running one. */
  trigger(): void
  /** Drop the running wait without emitting (an unlink, or the watch closing). */
  cancel(): void
  /** Whether a wait is running (for tests and diagnostics). */
  isPending(): boolean
}

/** Default bound on one wait. */
export const WRITE_FINISH_MAX_WAIT_MS = 5000

/**
 * Create a gate for one file.
 *
 * @param filePath - The watched file
 * @param options - Stability timings
 * @param emit - Called once per burst of writes; `forced` when the wait hit
 *   `maxWaitMs` before the writes settled, else with the stamp they settled at
 * @param deps - Injectable stat, clock and closed check
 */
export function createWriteFinishGate(
  filePath: string,
  options: WriteFinishOptions,
  emit: (forced: boolean, stamp?: FileStamp) => void,
  deps: WriteFinishDeps = {}
): WriteFinishGate {
  const stat =
    deps.stat ??
    ((path, cb) => {
      fsStat(path, { bigint: true }).then(
        // A stat without bigint fields (a fake, an odd volume) is compared as it came and sends
        // no stamp: the reader then reads as it did before stamps
        (st) => {
          if (typeof st.size === 'bigint' && typeof st.mtimeNs === 'bigint') {
            cb(null, { size: Number(st.size), stamp: stampFromStats(st) })
          } else {
            cb(null, { size: st.size as unknown as number })
          }
        },
        (err: NodeJS.ErrnoException) => cb(err)
      )
    })
  const now = deps.now ?? Date.now
  const isClosed = deps.isClosed ?? (() => false)
  const maxWait = options.maxWaitMs ?? WRITE_FINISH_MAX_WAIT_MS

  let pending: { startedAt: number; lastChange: number; prevSize?: number } | null = null
  let timer: NodeJS.Timeout | null = null

  const clear = (): void => {
    pending = null
    if (timer) clearTimeout(timer)
    timer = null
  }

  const schedule = (): void => {
    timer = setTimeout(poll, options.pollInterval)
    timer.unref?.()
  }

  function poll(): void {
    timer = null
    const wait = pending
    if (!wait) return
    if (isClosed()) {
      clear()
      return
    }
    stat(filePath, (err, stats) => {
      // A newer wait replaced this one, or it was cancelled meanwhile
      if (pending !== wait) return
      if (isClosed()) {
        clear()
        return
      }
      const t = now()
      if (err || !stats) {
        // Missing or locked mid-write: still being written. Never stuck – the
        // wait ends at maxWait; a file that is gone then is the unlink's job.
        if (t - wait.startedAt >= maxWait) {
          clear()
          if (err?.code !== 'ENOENT') emit(true)
          return
        }
        wait.lastChange = t
        wait.prevSize = undefined
        schedule()
        return
      }
      if (wait.prevSize !== undefined && stats.size !== wait.prevSize) wait.lastChange = t
      wait.prevSize = stats.size
      const settled = t - wait.lastChange >= options.stabilityThreshold
      if (settled || t - wait.startedAt >= maxWait) {
        clear()
        if (!settled) emit(true)
        else if (stats.stamp) emit(false, stats.stamp)
        else emit(false)
        return
      }
      schedule()
    })
  }

  return {
    trigger(): void {
      const t = now()
      if (pending) {
        pending.lastChange = t
        return
      }
      pending = { startedAt: t, lastChange: t }
      schedule()
    },
    cancel: clear,
    isPending: () => pending !== null
  }
}
