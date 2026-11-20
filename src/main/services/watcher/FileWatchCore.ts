// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileWatchCore – the state and the native-watcher half of `FileWatcherService`
 * (#478): the watch entries and subscriptions, arming through `armWatch`, what
 * a watcher's events do (change, unlink, error), the project-tree coverage
 * (#252), and the helpers. The service adds the subscribe flow, owners, the
 * project switch and the wake on top (layered like
 * `DirectoryWatcherService`). Members are `protected`, not `private`, because
 * the service and the test hook reach them by name.
 */
import type { FSWatcher } from 'chokidar'
import { join } from 'path'
import { logger } from '../LoggingService'
import { redactPath, redactedLogError } from '../../utils/redactUserInput'
import { pathBelowRoot, pathKey } from '../../utils/pathCompare'
import { isLexicallyInside } from '../../utils/projectConfinement'
import type { ProjectSession, ProjectSessionSnapshot } from '../session/ProjectSession'
import { TIMING_PROFILES } from '../../../shared/freshness/timingProfiles'
import type { FileStamp, WatchEndReason } from '../../../shared/freshness/freshnessTypes'
import { createAtomicSaveDetector } from './AtomicSaveDetector'
import { createSingleFileWatcher } from './singleFileWatch'
import { deliverEvent } from './watchNotifier'
import { AtomicRearmDeps, resolveDeletedWatch } from './atomicRearm'
import { watchedUnderRemovedFolders } from './ancestorRemoval'
import { UnseenWatchProbe, type RemovalCoverage } from './unseenWatchProbe'
import { armWatch, type ArmFs, type ArmWatchDeps } from './armWatch'
import { discardEntry } from './watchEntryOps'
import { WatchSubscriptions } from './watchSubscriptions'
import { WatchBuckets } from './watchBuckets'
import { WatchSuspension } from './watchSuspension'
import { WatchHealthRound } from './watchHealthRound'
import type { ArmOutcome, EntryEvent, WatchEntry, WatchOwner, WatchSubscription } from './watchTypes'

/** What the service can be given; the defaults are the real disk and no session. */
export interface FileWatcherServiceDeps {
  session?: Pick<ProjectSession, 'current'>
  fs?: ArmFs
  stampFile?: (realPath: string) => Promise<FileStamp | null>
  lstat?: (filePath: string) => Promise<{ dev?: number; ino?: number; birthtimeMs?: number }>
}

/** Names compare by case on Linux; a volume rule needs a session. */
const HOST_CASE_SENSITIVE = process.platform !== 'win32' && process.platform !== 'darwin'

export abstract class FileWatchCore {
  /** Native watches by `pathKey(realPath)`; an entry leaves before its watcher closes (decision 19). */
  readonly entries = new Map<string, WatchEntry>()
  protected readonly subscriptions = new WatchSubscriptions()
  protected readonly buckets = new WatchBuckets()
  protected readonly suspension = new WatchSuspension()
  /** Page generation per window, bumped on each navigation (decision 17). */
  protected readonly pageGenerations = new Map<number, number>()
  protected session: Pick<ProjectSession, 'current'> | null
  protected isDisposing = false

  /** One detector for the whole service; it keys its pending deletes by path (issue #70, M2). */
  readonly atomicSaveDetector = createAtomicSaveDetector()

  protected readonly health: WatchHealthRound
  /** Re-checks the files the project watcher cannot see (#252), and runs the health round. */
  readonly unseenProbe: UnseenWatchProbe

  /** The seam the atomic re-arm branch talks to this service through. */
  protected readonly rearmDeps: AtomicRearmDeps = {
    isDisposing: () => this.isDisposing,
    getWatch: key => this.entries.get(key),
    rearm: entry => this.arm(entry),
    discardWatch: entry => this.discardWatch(entry),
    notifyDeleted: entry => this.deliver(this.subsOf(entry), { kind: 'deleted' }),
    notifyWatchDead: (entry, reason) => this.deliver(this.subsOf(entry), { kind: 'ended', reason }),
    emitChange: entry => this.emitChange(entry),
    log: message => this.safeLog(message)
  }

  protected readonly armDeps: ArmWatchDeps

  constructor(protected readonly deps: FileWatcherServiceDeps = {}) {
    this.session = deps.session ?? null
    this.armDeps = {
      session: () => this.snapshot(),
      isCurrent: entry => this.isHeld(entry) && !entry.suspended,
      createWatcher: (entry, onReady) => this.createWatcher(entry, onReady),
      fs: deps.fs
    }
    this.health = new WatchHealthRound({
      entries: () => [...this.entries.values()].filter(entry => entry.watcher && !entry.suspended),
      isCurrent: entry => this.isHeld(entry) && !entry.arming && !entry.suspended,
      onMissing: entry => this.handleFileDeleted(entry),
      onReplaced: entry => void this.rearmAndTell(entry, 'changed', 'restart-failed'),
      lstat: deps.lstat
    })
    this.unseenProbe = new UnseenWatchProbe({
      probeablePaths: () => this.probeablePaths(),
      onMissing: filePath => {
        const entry = this.entryAtDisplayPath(filePath)
        if (entry) this.handleFileDeleted(entry)
      },
      extraRound: this.health
    })
  }

  /** Read the open project from `session` from now on (`ProjectService` binds its store). */
  bindSession(session: Pick<ProjectSession, 'current'>): void {
    this.session = session
  }

  /** Arm queued subscriptions while their buckets have slots (the service decides how). */
  protected abstract promote(): void

  // ---- native watcher events ---------------------------------------------------------

  protected arm(entry: WatchEntry): Promise<ArmOutcome> {
    return armWatch(entry, this.armDeps).then(outcome => {
      if (outcome === 'armed') this.unseenProbe.schedule()
      return outcome
    })
  }

  /**
   * Re-arm, then send `onArmed` (or end the watch with `onFailure` or the refusal).
   * An arm that throws counts as failed: its callers (resume after a failed
   * project switch, wake, watcher error) must never leave a tab silent (#478 H2).
   */
  protected async rearmAndTell(entry: WatchEntry, onArmed: 'changed' | 'restarted', onFailure: WatchEndReason): Promise<void> {
    const outcome = await this.arm(entry).catch((): ArmOutcome => {
      this.safeLog(`Re-arm threw for ${redactPath(entry.filePath)}`)
      return 'failed'
    })
    if (!this.isHeld(entry) || outcome === 'stale') return
    if (outcome === 'armed') {
      // The re-armed file was replaced unheard: it may still be being written (F8)
      if (onArmed === 'changed') this.emitChange(entry, true)
      else this.deliver(this.subsOf(entry), { kind: 'restarted' })
      return
    }
    if (outcome === 'missing') {
      this.deliver(this.subsOf(entry), { kind: 'deleted' })
    } else {
      const reason: WatchEndReason = outcome === 'failed' ? onFailure : outcome
      this.deliver(this.subsOf(entry), { kind: 'ended', reason })
    }
    this.discardWatch(entry)
  }

  protected createWatcher(entry: WatchEntry, onReady: () => void): FSWatcher {
    const profile = TIMING_PROFILES[entry.profile]
    const watcher: FSWatcher = createSingleFileWatcher(
      entry.filePath,
      {
        onChange: (forced, stamp) => {
          if (this.isLive(entry, watcher)) this.emitChange(entry, forced, stamp)
        },
        onUnlink: () => {
          if (this.isLive(entry, watcher)) this.handleFileDeleted(entry)
        },
        onError: (error: unknown) => {
          if (this.isLive(entry, watcher)) void this.handleWatcherError(entry, error)
        },
        onReady
      },
      { awaitWriteFinish: { stabilityThreshold: profile.settleMs, pollInterval: profile.pollMs } }
    )
    return watcher
  }

  /** A chokidar `error` re-arms; only a failed re-arm ends the watch (decision 23). */
  protected async handleWatcherError(entry: WatchEntry, error: unknown): Promise<void> {
    try {
      logger.error(`File watcher error for ${redactPath(entry.filePath)}`, redactedLogError(error))
    } catch {
      // Suppress EPIPE errors
    }
    await this.rearmAndTell(entry, 'restarted', 'watcher-error')
  }

  /**
   * Tell every subscription that is not paused; a paused one remembers it missed one.
   * `forced`: the change did not wait for the writes to settle, so the reader settles first (F8).
   * `stamp`: what the write gate saw the writes settle at; the reader's read must find it (P3).
   */
  protected emitChange(entry: WatchEntry, forced = false, stamp?: FileStamp): void {
    if (this.isDisposing || !this.isHeld(entry)) return
    const hearing: WatchSubscription[] = []
    for (const sub of this.subsOf(entry)) {
      if (sub.paused) sub.missed = true
      else hearing.push(sub)
    }
    if (hearing.length === 0) return
    this.safeLog(`📝 File changed externally: ${redactPath(entry.filePath)}`)
    let event: EntryEvent = { kind: 'changed' }
    if (forced) event = { kind: 'changed', forced: true }
    else if (stamp) event = { kind: 'changed', stamp }
    this.deliver(hearing, event)
  }

  /**
   * An unlink is ambiguous: a genuine delete or the first half of an atomic
   * save. The entry stays while `AtomicSaveDetector` decides (issue #70, D2).
   */
  protected handleFileDeleted(entry: WatchEntry): void {
    if (this.isDisposing || !this.isHeld(entry) || entry.suspended) return
    this.atomicSaveDetector.registerDelete(entry.filePath, (_path, wasAtomicSave) => {
      void resolveDeletedWatch(entry.key, wasAtomicSave, this.rearmDeps)
    })
  }

  /** The watch is over: its subscriptions go with it, and a slot frees. */
  protected discardWatch(entry: WatchEntry): void {
    for (const sub of this.subsOf(entry)) this.subscriptions.remove(sub)
    entry.subs.clear()
    discardEntry(this, entry)
    this.promote()
  }

  protected deliver(subs: Iterable<WatchSubscription>, event: EntryEvent): void {
    if (this.isDisposing) return
    deliverEvent(subs, event, message => this.safeLog(message))
  }

  // ---- project tree coverage (#252) ---------------------------------------------------

  /** The project watcher removed these paths: a file watched under one takes the unlink branch. */
  handleAncestorRemovals(removedPaths: readonly string[]): void {
    if (this.isDisposing) return
    const affected = watchedUnderRemovedFolders(this.probeablePaths(), removedPaths)
    for (const filePath of affected) {
      const entry = this.entryAtDisplayPath(filePath)
      if (entry) this.handleFileDeleted(entry)
    }
  }

  /** Re-check, on a slow timer, the watched files the project watcher cannot see (#252). */
  watchUnseenFiles(coverage: RemovalCoverage): void {
    this.unseenProbe.setCoverage(coverage)
  }

  /** A paused project watch lost removals under `root`: check the files watched there now (#252). */
  async checkWatchedFilesUnder(root: string, isOwnRemoval: (filePath: string) => boolean = () => false): Promise<void> {
    if (this.isDisposing) return
    const under = this.probeablePaths().filter(filePath => isLexicallyInside(filePath, root))
    await this.unseenProbe.checkNow(under, isOwnRemoval)
  }

  /**
   * The watched files the probe may `stat`, spelled as the project tree spells
   * them (below the session's root): inside the project only, so no probe
   * reaches outside it; nothing without a project.
   */
  protected probeablePaths(): string[] {
    const session = this.snapshot()
    if (!session) return []
    const paths: string[] = []
    for (const entry of this.entries.values()) {
      if (entry.suspended) continue
      const below = pathBelowRoot(entry.filePath, session.realRoot, session.caseSensitive)
      if (below !== undefined) paths.push(below === '' ? session.root : join(session.root, below))
    }
    return paths
  }

  /** The entry for a path spelled below the session's root (the tree's spelling) or a real path. */
  protected entryAtDisplayPath(filePath: string): WatchEntry | undefined {
    const session = this.snapshot()
    const below = session ? pathBelowRoot(filePath, session.root, session.caseSensitive) : undefined
    const real = session && below !== undefined ? join(session.realRoot, below) : filePath
    return this.entries.get(this.keyOf(real))
  }

  // ---- helpers -------------------------------------------------------------------------

  protected snapshot(): ProjectSessionSnapshot | null {
    return this.session?.current() ?? null
  }

  protected generation(): number {
    return this.snapshot()?.generation ?? 0
  }

  protected pageGenerationOf(owner: WatchOwner): number | null {
    return owner.kind === 'window' ? (this.pageGenerations.get(owner.webContentsId) ?? 0) : null
  }

  protected keyOf(realPath: string): string {
    return pathKey(realPath, this.snapshot()?.caseSensitive ?? HOST_CASE_SENSITIVE)
  }

  protected isHeld(entry: WatchEntry): boolean {
    return !this.isDisposing && this.entries.get(entry.key) === entry
  }

  /** The event came from the entry's current watcher, which is still held and running. */
  protected isLive(entry: WatchEntry, watcher: FSWatcher): boolean {
    return this.isHeld(entry) && entry.watcher === watcher && !entry.suspended
  }

  protected subsOf(entry: WatchEntry): WatchSubscription[] {
    const subs: WatchSubscription[] = []
    for (const key of entry.subs) {
      const sub = this.subscriptions.get(key)
      if (sub) subs.push(sub)
    }
    return subs
  }

  /** Safe logging that handles EPIPE errors during app shutdown; callers redact paths. */
  protected safeLog(message: string): void {
    if (this.isDisposing) return
    try {
      logger.info(message)
    } catch (error) {
      if (error instanceof Error && !error.message.includes('EPIPE')) throw error
    }
  }
}
