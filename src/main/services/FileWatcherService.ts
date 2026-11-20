// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileWatcherService - the one watch layer for every consumer of "follow the
 * file on disk" (#478, plan decisions 3, 8): editor and image tabs (windows),
 * and in-process owners such as the HTML preview.
 *
 * Subscriptions (`watcher/watchSubscriptions`) are keyed by owner + `watchId`;
 * each attaches to one native watch entry keyed by `pathKey(realPath)`, shared
 * by every subscription on that file. The entries, the native-watcher events
 * and the helpers are `watcher/FileWatchCore`; every watcher is (re-)created by
 * `watcher/armWatch`, which re-checks confinement. Caps and the waitlist are
 * `watcher/watchBuckets`; a project switch is `watcher/watchSuspension`; the
 * health round rides `UnseenWatchProbe`'s queue. The service reads the open
 * project from the injected read-only `ProjectSession` (decision 13).
 *
 * Every subscriber names its subscription by a `watchId`; the path-counted
 * API this replaced is gone (plan step S16).
 */
import { resolve } from 'path'
import { logger } from './LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { isInsideRoot } from '../utils/pathCompare'
import type { ProjectSessionSnapshot } from './session/ProjectSession'
import { FRESHNESS_LIMITS, type WatchBucketName } from '../../shared/freshness/timingProfiles'
import type { FileStamp, SubscribeRefusalCode, SubscribeReply, WatchEndReason } from '../../shared/freshness/freshnessTypes'
import { resolveDeletedWatch } from './watcher/atomicRearm'
import { checkTarget, closeQuietly, inspectTarget, type RecheckAnswer } from './watcher/armWatch'
import { closeAndForget, forgetEntry } from './watcher/watchEntryOps'
import { WatchSubscriptions, subscriptionKey } from './watcher/watchSubscriptions'
import type { WatchBuckets } from './watcher/watchBuckets'
import type { SuspensionHost } from './watcher/watchSuspension'
import { readStartStamp } from './watcher/startStamp'
import { FileWatchCore } from './watcher/FileWatchCore'
import {
  ownerKeyOf,
  type ArmOutcome,
  type SubscribeInput,
  type WatchEntry,
  type WatchOwner,
  type WatchSubscription
} from './watcher/watchTypes'

export type { FileWatcherServiceDeps } from './watcher/FileWatchCore'

const refused = (code: SubscribeRefusalCode): SubscribeReply => ({ status: 'refused', code })

/** How a refused arm ends a watch. */
const ARM_REFUSAL: Record<Exclude<ArmOutcome, 'armed'>, SubscribeRefusalCode> = {
  missing: 'NOT_FOUND',
  'outside-project': 'OUTSIDE_PROJECT',
  unsupported: 'UNSUPPORTED',
  failed: 'WATCH_FAILED',
  stale: 'WATCH_FAILED'
}

export class FileWatcherService extends FileWatchCore {
  private readonly readyTimeoutMs = FRESHNESS_LIMITS.readyTimeoutMs

  // ---- subscribe ------------------------------------------------------------------

  /**
   * Start following a file for one owner. Answers after the native watcher is
   * ready, with a stamp read after that (`limited` when ready did not come
   * within 2 s, decision 14); `queued` when the bucket is full (decision 20).
   * The session and page generations are recorded at entry and checked again
   * before the answer: a subscribe that raced a project switch or a page
   * reload is refused and leaves no watch (decision 15, N1).
   */
  async subscribe(input: SubscribeInput): Promise<SubscribeReply> {
    if (this.isDisposing) return refused('WATCH_FAILED')
    const generation = this.generation()
    const pageGeneration = this.pageGenerationOf(input.owner)
    const target = await this.resolveTarget(input.filePath)
    if (typeof target !== 'string') return refused(target.code)
    const sub = WatchSubscriptions.create({
      owner: input.owner,
      watchId: input.watchId,
      profile: input.profile,
      requestedPath: input.filePath,
      realPath: target,
      generation,
      pageGeneration
    })
    if (this.subscriptions.get(sub.key)) return refused('DUPLICATE_ID')
    const stale = this.staleCode(sub)
    if (stale) return refused(stale)
    this.subscriptions.add(sub)

    const entryKey = this.keyOf(sub.realPath)
    if (!this.buckets.hasSlot(sub, this.entries.has(entryKey) ? entryKey : null, this.subscriptions.all())) {
      if (this.buckets.enqueue(sub)) {
        sub.state = 'waiting'
        return { status: 'queued' }
      }
      this.subscriptions.remove(sub)
      return refused('WATCH_FAILED')
    }
    const attached = await this.attach(sub, entryKey)
    if (attached) {
      await this.drop(sub)
      return refused(attached)
    }
    return this.answer(sub)
  }

  /**
   * Check `realPath` again as an arm does – its real path inside the open
   * project, a regular file – before a main-side probe or read opens it (SEC2).
   * A path `realpath` cannot resolve answers `unresolved`, not `outside-project`:
   * the caller must not end a watch over a delete-pending file (R2-1).
   */
  recheckTarget(realPath: string): Promise<RecheckAnswer> {
    return inspectTarget(realPath, this.snapshot(), this.deps.fs)
  }

  /** The real path of a file a subscribe may follow, or why not. */
  private async resolveTarget(filePath: string): Promise<string | { code: SubscribeRefusalCode }> {
    const session = this.snapshot()
    // Lexically first, before any file-system call: an outside path is refused
    // without saying whether it exists
    if (session && !isLexicallyInSession(filePath, session)) return { code: 'OUTSIDE_PROJECT' }
    // Then inside after the real path is resolved, by the session's case rule:
    // two spellings of one file are one file (G6, decision 10)
    const checked = await checkTarget(filePath, session, this.deps.fs)
    return typeof checked === 'string' ? { code: ARM_REFUSAL[checked] } : checked.real
  }

  /**
   * Attach `sub` to the entry under `entryKey`, creating and arming it when
   * there is none. While the project switch is suspending, a new entry is
   * inserted suspended (decision 18). Resolves a refusal code, or null.
   */
  private async attach(sub: WatchSubscription, entryKey: string): Promise<SubscribeRefusalCode | null> {
    const existing = this.entries.get(entryKey)
    if (existing) {
      existing.subs.add(sub.key)
      sub.entryKey = entryKey
      return this.joined(existing)
    }
    const entry: WatchEntry = {
      key: entryKey,
      filePath: sub.realPath,
      profile: sub.profile,
      watcher: null,
      suspended: this.suspension.isSuspending,
      identity: null,
      arming: null,
      ready: null,
      subs: new Set([sub.key])
    }
    this.entries.set(entryKey, entry)
    sub.entryKey = entryKey
    this.unseenProbe.pathChanged(entry.filePath)
    if (entry.suspended) return null
    const outcome = await this.arm(entry)
    if (outcome === 'armed' || (outcome === 'stale' && entry.suspended && this.isHeld(entry))) return null
    forgetEntry(this, entry)
    return ARM_REFUSAL[outcome]
  }

  /** A join: wait for an arm in flight, and resolve an unlink still pending (issue #70, L-2). */
  private async joined(entry: WatchEntry): Promise<SubscribeRefusalCode | null> {
    if (entry.arming) {
      const outcome = await entry.arming
      if (outcome !== 'armed' && !entry.suspended) return ARM_REFUSAL[outcome]
    }
    if (this.atomicSaveDetector.hasPending(entry.filePath)) {
      // The file was unlinked moments ago and the subscribe just found it on
      // disk, which is the detector's atomic-save verdict: re-arm now rather
      // than join a watcher bound to the dead inode
      this.atomicSaveDetector.cancelPending(entry.filePath)
      await resolveDeletedWatch(entry.key, true, this.rearmDeps)
    }
    return this.isHeld(entry) ? null : 'WATCH_FAILED'
  }

  /** Wait for ready and the stamp, check staleness again, and answer. */
  private async answer(sub: WatchSubscription): Promise<SubscribeReply> {
    let ready = true
    const entry = sub.entryKey ? this.entries.get(sub.entryKey) : undefined
    if (entry && !entry.suspended) ready = await this.waitReady(entry)
    const stamp: FileStamp | null = await (this.deps.stampFile ?? readStartStamp)(sub.realPath)
    const stale = this.staleCode(sub)
    if (!this.subscriptions.holds(sub)) return refused(stale ?? 'NOT_FOUND')
    if (stale || stamp === null) {
      await this.drop(sub)
      return refused(stale ?? 'NOT_FOUND')
    }
    sub.state = 'active'
    return { status: 'started', stamp, liveRefresh: ready ? 'full' : 'limited' }
  }

  private waitReady(entry: WatchEntry): Promise<boolean> {
    const ready = entry.ready
    if (!ready) return Promise.resolve(false)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), this.readyTimeoutMs)
      void ready.then(isReady => {
        clearTimeout(timer)
        resolve(isReady)
      })
    })
  }

  /** `PAGE_CHANGED` / `PROJECT_CHANGED` when the subscribe is from a page or project gone by. */
  private staleCode(sub: WatchSubscription): SubscribeRefusalCode | null {
    if (sub.pageGeneration !== null && this.pageGenerationOf(sub.owner) !== sub.pageGeneration) return 'PAGE_CHANGED'
    if (sub.generation !== this.generation()) return 'PROJECT_CHANGED'
    return null
  }

  // ---- unsubscribe, pause, owners -----------------------------------------------------

  /** Stop one subscription; a foreign or unknown id is a no-op (decision 5). */
  async unsubscribe(owner: WatchOwner, watchId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionKey(ownerKeyOf(owner), watchId))
    if (sub) await this.drop(sub)
  }

  /** Pause one subscription for an own save (decision 16); others on the file keep hearing. */
  pauseSubscription(owner: WatchOwner, watchId: string): void {
    const sub = this.subscriptions.get(subscriptionKey(ownerKeyOf(owner), watchId))
    if (sub) this.subscriptions.pause(sub)
  }

  /** End the pause; `missed` asks the saver to check. An unknown id says `missed` too, to be safe. */
  resumeSubscription(owner: WatchOwner, watchId: string): { success: boolean; missed: boolean } {
    const sub = this.subscriptions.get(subscriptionKey(ownerKeyOf(owner), watchId))
    if (!sub) return { success: false, missed: true }
    return { success: true, missed: this.subscriptions.resume(sub) }
  }

  /** Drop every subscription and waitlist entry of one owner (`w:<id>` or `p:<id>`). */
  async dropOwner(ownerKey: string): Promise<void> {
    await Promise.all(this.subscriptions.forOwner(ownerKey).map(sub => this.drop(sub)))
  }

  /**
   * A window's page navigated or reloaded (decision 17): later answers to its
   * old page's subscribes are refused, and everything it held is dropped.
   */
  async pageNavigated(webContentsId: number): Promise<void> {
    this.pageGenerations.set(webContentsId, (this.pageGenerations.get(webContentsId) ?? 0) + 1)
    await this.dropOwner(ownerKeyOf({ kind: 'window', webContentsId }))
  }

  /** A window was destroyed: as a navigation, so nothing it started can land (issue #59). */
  async cleanupForWebContentsId(webContentsId: number): Promise<void> {
    await this.pageNavigated(webContentsId)
    this.safeLog(`👁️  Cleaned up file watches for webContentsId ${webContentsId}`)
  }

  /** Remove a subscription from wherever it is; close its entry when it was the last. */
  private async drop(sub: WatchSubscription): Promise<void> {
    this.subscriptions.remove(sub)
    this.buckets.remove(sub)
    const entry = sub.entryKey ? this.entries.get(sub.entryKey) : undefined
    sub.entryKey = null
    if (entry?.subs.delete(sub.key) && entry.subs.size === 0) await closeAndForget(this, entry)
    this.promote()
  }

  /** End one subscription with `reason` (it is told), then drop it. */
  private endSubscription(sub: WatchSubscription, reason: WatchEndReason): void {
    this.deliver([sub], { kind: 'ended', reason })
    void this.drop(sub)
  }

  /** Arm queued subscriptions while their buckets have slots, first in line first (G9). */
  protected promote(): void {
    if (this.isDisposing) return
    for (const bucket of this.buckets.bucketsWithQueue()) {
      for (const key of this.buckets.queued(bucket)) {
        const sub = this.subscriptions.get(key)
        if (!sub) continue
        const entryKey = this.keyOf(sub.realPath)
        const joins = this.entries.has(entryKey) ? entryKey : null
        // A per-owner cap can block the first in line and not the next: keep looking
        if (!this.buckets.hasSlot(sub, joins, this.subscriptions.all())) continue
        this.buckets.remove(sub)
        sub.state = 'pending'
        void this.activate(sub, entryKey)
      }
    }
  }

  /** A queued subscription got its slot: arm it and say `started` (or why not). */
  private async activate(sub: WatchSubscription, entryKey: string): Promise<void> {
    const attached = await this.attach(sub, entryKey)
    const reply = attached ? refused(attached) : await this.answer(sub)
    if (reply.status === 'started') {
      this.deliver([sub], { kind: 'started', stamp: reply.stamp, liveRefresh: reply.liveRefresh })
      return
    }
    if (reply.status !== 'refused' || reply.code === 'PAGE_CHANGED' || reply.code === 'PROJECT_CHANGED') return
    this.deliver([sub], reply.code === 'NOT_FOUND' ? { kind: 'deleted' } : { kind: 'ended', reason: endReasonFor(reply.code) })
    await this.drop(sub)
  }

  // ---- project switch, wake (decisions 18, 22) ----------------------------------------

  /** Just before a project commit: flag up, every native watcher closed, records kept. */
  async suspendAll(): Promise<void> {
    this.unseenProbe.reset()
    await this.suspension.suspendAll(this.suspensionHost, this.generation())
  }

  /** A step after the suspend failed: re-arm everything suspended (G1). */
  async resumeSuspended(): Promise<void> {
    await this.suspension.resumeSuspended(this.suspensionHost)
  }

  /** The commit happened: end everything recorded before `newGeneration` (N1). */
  async endSuspended(newGeneration: number, reason: WatchEndReason = 'project-switch'): Promise<void> {
    await this.suspension.endSuspended(this.suspensionHost, newGeneration, reason)
  }

  /** End every subscription and close every watch at once (no project left to follow). */
  async stopAll(): Promise<void> {
    this.unseenProbe.reset()
    for (const sub of this.subscriptions.all()) this.endSubscription(sub, 'project-closed')
    await Promise.all([...this.entries.values()].map(entry => closeAndForget(this, entry)))
  }

  private readonly suspensionHost: SuspensionHost = {
    entries: () => [...this.entries.values()],
    subscriptions: () => this.subscriptions.all(),
    suspendEntry: async entry => {
      this.atomicSaveDetector.cancelPending(entry.filePath)
      entry.suspended = true
      const watcher = entry.watcher
      entry.watcher = null
      if (watcher) await closeQuietly(watcher)
    },
    resumeEntry: async entry => {
      entry.suspended = false
      await this.rearmAndTell(entry, 'restarted', 'restart-failed')
    },
    endSubscription: (sub, reason) => this.endSubscription(sub, reason)
  }

  /** After a wake: re-arm every watch; a watch that died silently in sleep follows again (G8, F26). */
  async rearmAll(): Promise<void> {
    const live = [...this.entries.values()].filter(entry => !entry.suspended)
    await Promise.all(live.map(entry => this.rearmAndTell(entry, 'restarted', 'restart-failed')))
  }

  /** One health round now, in the probe's queue. */
  runHealthRound(): Promise<void> {
    return this.unseenProbe.runExtraNow()
  }

  /** Ask every in-process owner to check its files (after a wake). */
  checkInProcessOwners(): void {
    const owners = new Map<string, () => void>()
    for (const { owner, ownerKey } of this.subscriptions.all()) {
      if (owner.kind === 'process' && owner.onCheck) owners.set(ownerKey, owner.onCheck)
    }
    for (const check of owners.values()) {
      try {
        check()
      } catch (error) {
        logger.error('File watch owner check failed', redactedLogError(error))
      }
    }
  }

  /** Change a bucket's cap (the e2e watch-limit hook); returns the previous one. */
  setBucketCap(bucket: WatchBucketName, totalCap: number): number {
    const previous = this.buckets.setTotalCap(bucket, totalCap)
    this.promote()
    return previous
  }

  /** Statistics about watched files (diagnostics, `file-watch:stats`). */
  getStats(): {
    totalWatched: number
    fileDetails: Array<{ path: string; watchers: number }>
    subscriptions: number
    paused: number
    waiting: number
    buckets: ReturnType<WatchBuckets['stats']>
  } {
    const subs = this.subscriptions.all()
    return {
      totalWatched: this.entries.size,
      fileDetails: [...this.entries.values()].map(entry => ({
        path: entry.filePath,
        watchers: new Set(this.subsOf(entry).map(sub => sub.ownerKey)).size
      })),
      subscriptions: subs.filter(sub => sub.entryKey !== null).length,
      paused: subs.filter(sub => sub.paused).length,
      waiting: this.buckets.waitingCount,
      buckets: this.buckets.stats(subs)
    }
  }

  /** Cleanup all watchers (on app shutdown). */
  async dispose(): Promise<void> {
    this.safeLog('👁️  Disposing all file watchers...')
    this.isDisposing = true
    this.atomicSaveDetector.dispose()
    this.unseenProbe.dispose()
    for (const sub of this.subscriptions.all()) this.subscriptions.remove(sub)
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map(entry => (entry.watcher ? closeQuietly(entry.watcher) : undefined)))
  }
}

/** Below the session's root, as shown or as resolved, by the session's case rule. */
function isLexicallyInSession(filePath: string, session: ProjectSessionSnapshot): boolean {
  const resolved = resolve(filePath)
  return (
    isInsideRoot(resolved, session.root, session.caseSensitive) ||
    isInsideRoot(resolved, session.realRoot, session.caseSensitive)
  )
}

function endReasonFor(code: SubscribeRefusalCode): WatchEndReason {
  if (code === 'OUTSIDE_PROJECT') return 'outside-project'
  if (code === 'UNSUPPORTED') return 'unsupported'
  return 'restart-failed'
}

// Singleton instance
export const fileWatcherService = new FileWatcherService()