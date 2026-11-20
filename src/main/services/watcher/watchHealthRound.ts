// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchHealthRound - is every watched path still the file its watcher is
 * bound to? (#478, plan decision 21)
 *
 * A native watcher is bound to the file it opened. When the path is replaced
 * without an unlink the watcher hears – a folder above it deleted and created
 * again, which the project watcher's coalescer can turn into one `change`
 * (G4) – the watcher is deaf from then on. Each round `lstat`s every watched
 * path and compares `(dev, ino, birthtime)` with the identity the watch was
 * armed on: another identity re-arms it (and reports a change), a missing file
 * takes the normal unlink branch.
 *
 * It runs in `UnseenWatchProbe`'s queue, so the rounds share its rules: one
 * `lstat` at a time, each time-boxed, and a path whose `lstat` never answered
 * is not asked again until it does. A watch with no recorded identity (a
 * volume that reports none) is skipped.
 */
import { lstat as fsLstat } from 'fs/promises'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import { identityOf } from './armWatch'
import { UNSEEN_STAT_TIMEOUT_MS } from './unseenWatchProbe'
import type { WatchEntry, WatchIdentity } from './watchTypes'

/** What the round needs from `FileWatcherService`. */
export interface WatchHealthDeps {
  /** The entries to check now: armed, not suspended. */
  entries(): readonly WatchEntry[]
  /** The entry is still held and not re-arming. */
  isCurrent(entry: WatchEntry): boolean
  /** The path is gone: take the unlink branch. */
  onMissing(entry: WatchEntry): void
  /** The path names another file now: re-arm and report a change. */
  onReplaced(entry: WatchEntry): void
  lstat?(filePath: string): Promise<{ dev?: number; ino?: number; birthtimeMs?: number }>
}

type Look = WatchIdentity | 'missing' | 'unknown'

export class WatchHealthRound {
  /** Paths whose last `lstat` has not answered, even if its time box ran out. */
  private readonly unsettled = new Set<string>()

  constructor(private readonly deps: WatchHealthDeps) {}

  /** Some watch can be checked. */
  hasWork(): boolean {
    return this.deps.entries().some(entry => entry.identity !== null)
  }

  /** One round; stops at the next path once `isCancelled` says so. */
  async run(isCancelled: () => boolean): Promise<void> {
    for (const entry of this.deps.entries()) {
      if (isCancelled()) return
      const armedOn = entry.identity
      if (armedOn === null || !this.deps.isCurrent(entry)) continue
      const look = await this.look(entry.filePath)
      if (isCancelled()) return
      // Re-armed or dropped meanwhile: the new watch has its own identity
      if (!this.deps.isCurrent(entry) || entry.identity !== armedOn || look === 'unknown') continue
      if (look === 'missing') {
        this.deps.onMissing(entry)
      } else if (!sameIdentity(look, armedOn)) {
        this.deps.onReplaced(entry)
      }
    }
  }

  private async look(filePath: string): Promise<Look> {
    if (this.unsettled.has(filePath)) return 'unknown'
    this.unsettled.add(filePath)
    const lstat = this.deps.lstat ?? fsLstat
    const check = Promise.resolve()
      .then(() => lstat(filePath))
      .finally(() => this.unsettled.delete(filePath))
    try {
      const stats = await withTimeout(check, UNSEEN_STAT_TIMEOUT_MS, 'Watch health lstat')
      return identityOf(stats) ?? 'unknown'
    } catch (error) {
      if (error instanceof TimeoutError) return 'unknown'
      return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'missing' : 'unknown'
    }
  }
}

function sameIdentity(a: WatchIdentity, b: WatchIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs
}
