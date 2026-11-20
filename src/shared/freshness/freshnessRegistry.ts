// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The trackers of one process side, so one window-focus listener, one power
 * resume and one `file-watch:check` broadcast reach every tab (#478, plan
 * decision 37): a registry, not a listener per tab.
 *
 * @module shared/freshness/freshnessRegistry
 */
import type { CheckReason } from './freshnessTypes'

/** Anything that can check its file against the disk (a tracker). */
export interface Checkable {
  check(reason: CheckReason): void
}

/** A set of trackers that can all be asked to check at once. */
export class FreshnessRegistry {
  private readonly members = new Set<Checkable>()

  /** Add a tracker; returns its removal. */
  add(member: Checkable): () => void {
    this.members.add(member)
    return () => {
      this.members.delete(member)
    }
  }

  /**
   * Ask every tracker to check. A tracker that throws does not stop the rest;
   * the first error is rethrown once every tracker was asked.
   */
  checkAll(reason: CheckReason): void {
    let firstError: unknown
    let failed = false
    for (const member of [...this.members]) {
      try {
        member.check(reason)
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
    if (failed) throw firstError
  }

  /** Trackers registered now. */
  get size(): number {
    return this.members.size
  }
}
