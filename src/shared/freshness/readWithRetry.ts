// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Retry a failed read (#478 L2, plan decision 36).
 *
 * A read that fails – the file is locked by an editor or a virus scanner, or
 * access is briefly denied – is tried again after 100, 300 and 900 ms. Only
 * `failed` is retried: `missing`, a content refusal (`blocked`) and `ok` are
 * answers, and `busy` never gets here (the settle loop absorbs it). After the
 * last retry the outcome is still `failed`, and the tracker shows the
 * "cannot be read right now" notice.
 *
 * @module shared/freshness/readWithRetry
 */
import type { Clock } from '../clock'
import type { ReadOutcome } from './freshnessTypes'
import { delay } from './settleRead'

/** What {@link readWithRetry} needs. */
export interface ReadWithRetryDeps {
  readonly clock: Clock
  /** Waits before each retry, in order (three for every profile). */
  readonly delaysMs: readonly number[]
  readonly isCancelled?: () => boolean
}

/**
 * Run `attempt`, and again after each delay while it fails. Resolves the first
 * non-failed outcome, the last failure, or `null` when cancelled.
 *
 * @param attempt - one read; resolving `null` means it was cancelled
 */
export async function readWithRetry<V>(
  attempt: () => Promise<ReadOutcome<V> | null>,
  deps: ReadWithRetryDeps
): Promise<ReadOutcome<V> | null> {
  const cancelled = (): boolean => deps.isCancelled?.() ?? false
  let outcome = await attempt()
  for (const waitMs of deps.delaysMs) {
    if (outcome === null || outcome.status !== 'failed') return outcome
    await delay(deps.clock, waitMs)
    if (cancelled()) return null
    outcome = await attempt()
  }
  return outcome
}
