// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Process-wide ceiling on preview file watches (sd-074b §4.6).
 *
 * `PREVIEW.MAX_WATCHED_FILES` is a per-pool cap and each live preview builds its
 * own pool, so with several previews the descriptor cost is that cap times the
 * number of live views. This budget bounds the total.
 *
 * WHY THE POOL OWNS THE TOKEN. A budget that callers "consult before acquiring"
 * has to stay symmetric across three asymmetric paths — a cap rejection that
 * takes no descriptor, a re-acquire that only bumps a refcount, and a release
 * that returns early while the refcount is still positive. Any one of those
 * getting it wrong leaks the budget toward permanent starvation. So the token is
 * taken exactly where a pool entry is CREATED and returned exactly where one is
 * CLOSED: the two places are one function apart and cannot drift.
 *
 * Over budget degrades one preview's auto-refresh and is reported as a failure
 * entry by the coordinator; it never silently stops watching.
 */
import { PREVIEW } from '../../../shared/constants'

/** A counting budget shared by every preview watch pool. */
export interface IPreviewWatchBudget {
  /** Take one slot; `false` when the ceiling is reached and nothing was taken. */
  tryTake(): boolean
  /** Return one slot. Never drops below zero, so a double-give cannot inflate it. */
  give(): void
  /** Slots currently held, for tests and diagnostics. */
  readonly inUse: number
  /** The ceiling this budget enforces. */
  readonly limit: number
}

/** Build an independent budget. Tests use a small limit; production uses one shared instance. */
export function createPreviewWatchBudget(limit: number): IPreviewWatchBudget {
  let inUse = 0
  return {
    tryTake(): boolean {
      if (inUse >= limit) {
        return false
      }
      inUse += 1
      return true
    },
    give(): void {
      if (inUse > 0) {
        inUse -= 1
      }
    },
    get inUse(): number {
      return inUse
    },
    get limit(): number {
      return limit
    }
  }
}

/**
 * The budget every production pool shares.
 *
 * Sized from `MAX_LIVE_VIEWS × MAX_WATCHED_FILES` plus headroom for a view that
 * is mid-teardown while another opens — pools are per view, so this counts
 * acquisitions rather than distinct files.
 */
export const sharedPreviewWatchBudget = createPreviewWatchBudget(PREVIEW.MAX_WATCHED_FILES_GLOBAL)
