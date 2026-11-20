// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Settle before every triggered read (#478, plan decision 34, F8).
 *
 * A catch-up, safety-net, file-back or forced-change read first waits until
 * two probes `settleMs` apart show the same size and mtime, then reads; the
 * read itself verifies (main `fstat`s before and after), and one more probe
 * after it must still show the settled size and mtime – a writer that started
 * between the last probe and the read is otherwise read whole but partial. A
 * `busy` read, or a file that moved around the read, goes back to settling; it
 * is not a failure and does not count as a read retry. So a writer that keeps streaming is
 * never read half-way (P3): the result is the complete file once it holds
 * still.
 *
 * The wait is time-boxed at `capMs` (the profile's 5 s gate cap, QG-11a K1/V1).
 * A file that does not hold still by then – an endless stream, or a path whose
 * probe and read keep answering "cannot tell" / `busy` (a dead share) – is not
 * read: the attempt answers `failed`, which the read retries and, if it still
 * moves, shows as "cannot be read right now".
 *
 * @module shared/freshness/settleRead
 */
import type { Clock } from '../clock'
import type { ReadOutcome } from './freshnessTypes'

/** What a settle probe sees: the file's size and mtime, or that it is gone. */
export type SettleProbe =
  | { readonly status: 'present'; readonly size: number; readonly mtimeMs: number }
  | { readonly status: 'missing' }
  /** The probe could not tell (unreadable, unsupported): the read decides. */
  | { readonly status: 'unknown' }

/** What {@link settleRead} needs. */
export interface SettleReadDeps<V> {
  readonly clock: Clock
  readonly settleMs: number
  /** Longest wait for the file to hold still (ms); past it the attempt answers `failed`, never a read. */
  readonly capMs: number
  readonly probe: () => Promise<SettleProbe>
  readonly read: () => Promise<ReadOutcome<V>>
  /** `true` stops the loop (the tracker was disposed or the read is no longer wanted). */
  readonly isCancelled?: () => boolean
}

/** The read's outcome, or `null` when it was cancelled. */
export type SettledOutcome<V> = ReadOutcome<V> | null

/** Wait `ms` on `clock`. */
export function delay(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms)
  })
}

function sameSnapshot(a: SettleProbe, b: SettleProbe): boolean {
  if (a.status !== 'present' || b.status !== 'present') return a.status === b.status
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

/**
 * Settle, then read. Resolves `missing` as soon as a probe finds no file (the
 * caller confirms a delete), `failed` when the file has not held still within
 * `capMs`, and never reads while the file is still moving.
 */
export async function settleRead<V>(deps: SettleReadDeps<V>): Promise<SettledOutcome<V>> {
  const cancelled = (): boolean => deps.isCancelled?.() ?? false
  const start = deps.clock.now()
  const timedOut = (): boolean => deps.clock.now() - start >= deps.capMs
  let previous = await deps.probe()
  for (;;) {
    if (cancelled()) return null
    if (previous.status === 'missing') return { status: 'missing' }
    if (timedOut()) return { status: 'failed' }
    await delay(deps.clock, deps.settleMs)
    if (cancelled()) return null
    const current = await deps.probe()
    if (current.status === 'missing') return { status: 'missing' }
    if (!sameSnapshot(previous, current)) {
      previous = current
      continue
    }
    const outcome = await deps.read()
    if (cancelled()) return null
    if (outcome.status === 'busy') {
      previous = await deps.probe()
      continue
    }
    if (outcome.status !== 'ok') return outcome
    // The read opens the file after the last probe: a writer that started in
    // between (truncate, first chunk) reads as a whole, unmoving file. Only a
    // file still as it held still is the version that settled (P3).
    const after = await deps.probe()
    if (cancelled()) return null
    if (sameSnapshot(current, after)) return outcome
    previous = after
  }
}
