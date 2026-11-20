// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchReleases - `FileWatcherService` lets go of its native watches under a
 * path while the project tree deletes it (#486).
 *
 * On Windows any handle below a folder blocks renaming the folder, which is
 * how the Recycle Bin moves it, and a single-file watch is such a handle
 * (libuv watches a file through its folder). So a folder holding a file open
 * in a tab could not be trashed. A release closes the watcher of every entry
 * at or below the path – the entry and its subscriptions stay, suspended as
 * for a project switch, so no event reaches a tab meanwhile – and the re-arm
 * it returns arms them again through `armWatch`: an entry whose file is gone
 * takes the normal deleted path, one still there is told `restarted`.
 *
 * Releases nest and overlap (two deletes at once): an entry is held while any
 * release covers it and re-armed only when the last one ends. An entry created
 * under a release in force is adopted by it, so no handle opens mid-delete.
 * Paths compare as the watch layer keys them – real paths under the session's
 * case rule – so `C:\Proj\A` covers `c:\proj\a\x.md` on Windows.
 */
import { isInsideRoot, normaliseResolved } from '../../utils/pathCompare'
import { withTimeout } from '../../utils/withTimeout'
import type { WatchEntry } from './watchTypes'

/** Arms again what a release let go; safe to call more than once. */
export type ReArm = () => Promise<void>

/** What a release needs from `FileWatcherService`. */
export interface ReleaseHost {
  entries(): Iterable<WatchEntry>
  /** The session's case rule (the host's when no project is open). */
  caseSensitive(): boolean
  /** Close the entry's watcher and mark it suspended; the record stays. */
  hold(entry: WatchEntry): Promise<void>
  /** No release holds the entry any more: arm it again and tell its subscriptions. */
  rearm(entry: WatchEntry): Promise<void>
}

/**
 * Longest one entry's watcher may take to close in a release. Under the
 * delete's own box (`WATCH_RELEASE_TIMEOUT_MS`, `releaseWatchesAround.ts`), so a
 * close that never settles still leaves the delete a real re-arm to call.
 * Giving up on it is safe: the hold nulls the entry's watcher before it
 * awaits, so the stuck watcher's events are ignored.
 */
export const HOLD_TIMEOUT_MS = 1_000

/** Longest a subscribe waits for a delete under its file before it goes ahead anyway. */
export const RELEASE_WAIT_CEILING_MS = 30_000

interface Release {
  readonly root: string
  readonly entries: Set<WatchEntry>
  readonly done: Promise<void>
  readonly finish: () => void
}

export class WatchReleases {
  private readonly active = new Set<Release>()
  /** How many releases hold each entry. */
  private readonly holds = new Map<WatchEntry, number>()

  constructor(
    private readonly host: ReleaseHost,
    private readonly waitCeilingMs = RELEASE_WAIT_CEILING_MS
  ) {}

  /**
   * Close every watch at or below `realPath` until the returned re-arm runs.
   * Resolves once the watchers are closed, or after `HOLD_TIMEOUT_MS` at most.
   */
  async releaseUnder(realPath: string): Promise<ReArm> {
    let finish: () => void = () => {}
    const done = new Promise<void>(resolve => {
      finish = resolve
    })
    const release: Release = { root: normaliseResolved(realPath), entries: new Set(), done, finish }
    this.active.add(release)
    const closing: Promise<void>[] = []
    for (const entry of this.host.entries()) {
      if (this.covers(release, entry.filePath) && this.take(release, entry)) {
        closing.push(withTimeout(this.host.hold(entry), HOLD_TIMEOUT_MS, 'Watch hold'))
      }
    }
    // A failed or timed-out close still counts as held: the re-arm arms it again
    await Promise.allSettled(closing)
    let ending: Promise<void> | null = null
    return () => (ending ??= this.end(release))
  }

  /**
   * A new entry: held by every release in force that covers it.
   *
   * @returns true when it is held and must not be armed now
   */
  adopt(entry: WatchEntry): boolean {
    for (const release of this.active) {
      if (this.covers(release, entry.filePath)) this.take(release, entry)
    }
    return this.isHolding(entry)
  }

  isHolding(entry: WatchEntry): boolean {
    return this.holds.has(entry)
  }

  /**
   * Wait until no release covers `realPath`, at most the ceiling: a subscribe
   * then resolves and stamps its file after the delete, not during it.
   */
  async waitFor(realPath: string): Promise<void> {
    const covering = [...this.active].filter(release => this.covers(release, realPath))
    if (covering.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ceiling = new Promise<void>(resolve => {
      timer = setTimeout(resolve, this.waitCeilingMs)
    })
    await Promise.race([Promise.all(covering.map(release => release.done)), ceiling])
    clearTimeout(timer)
  }

  /** Watches with a native watcher open at or below `realPath` now. */
  countOpen(realPath: string): number {
    const root = normaliseResolved(realPath)
    let open = 0
    for (const entry of this.host.entries()) {
      if (entry.watcher !== null && this.isAtOrBelow(entry.filePath, root)) open++
    }
    return open
  }

  private async end(release: Release): Promise<void> {
    this.active.delete(release)
    release.finish()
    const free: WatchEntry[] = []
    for (const entry of release.entries) {
      const left = (this.holds.get(entry) ?? 1) - 1
      if (left > 0) {
        this.holds.set(entry, left)
      } else {
        this.holds.delete(entry)
        free.push(entry)
      }
    }
    await Promise.all(free.map(entry => this.host.rearm(entry)))
  }

  /** Count `entry` in `release`; true when no other release held it before. */
  private take(release: Release, entry: WatchEntry): boolean {
    if (release.entries.has(entry)) return false
    release.entries.add(entry)
    const before = this.holds.get(entry) ?? 0
    this.holds.set(entry, before + 1)
    return before === 0
  }

  private covers(release: Release, filePath: string): boolean {
    return this.isAtOrBelow(filePath, release.root)
  }

  private isAtOrBelow(filePath: string, root: string): boolean {
    return isInsideRoot(normaliseResolved(filePath), root, this.host.caseSensitive())
  }
}
