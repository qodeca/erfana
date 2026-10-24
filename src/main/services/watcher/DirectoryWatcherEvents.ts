// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The event layer of `DirectoryWatcherService` (split out in finding [65]):
 * routes a backend's events through the path filter, the tree record, the
 * pause accounting and atomic-save detection into the throttled worker, then
 * coalesces each batch and broadcasts it. Also the pause API (#210, #252),
 * because a pause decides what happens to every queued event.
 */
import { resolve } from 'path'
import { lstat } from 'fs/promises'
import { logger } from '../LoggingService'
import { isLexicallyInside } from '../../utils/projectConfinement'
import { toRootRelative } from '../../utils/projectPathFilter'
import { PAUSE_CONTROLLER } from '../../../shared/constants'
import type { DirectoryChangedPayload } from '../../../shared/ipc/directory-watch-schema'
import { EventCoalescer, type FileChangeEvent } from './EventCoalescer'
import type { KnownEntriesRead, KnownEntryKind } from './KnownEntries'
import { PauseEpisode, type InternalChange } from './PauseEpisode'
import type { DirectoryWatchHandle, DirectoryWatchResyncReason } from './directoryWatchBackend'
import { DirectoryWatcherRecovery } from './DirectoryWatcherRecovery'
import { entryKindOf, isStructuralRawBatch, type DirectoryChangeEvent } from './directoryWatchTypes'

export abstract class DirectoryWatcherEvents extends DirectoryWatcherRecovery {
  /**
   * The native watcher lost events and cannot say where (#211, D3, D13).
   * Answered with one catch-up refresh; while paused, counted as one unknown
   * drop instead, so resume catches up unless a later completed read by the
   * pausing window covers it.
   */
  protected handleResync(dirPath: string, reason: DirectoryWatchResyncReason): void {
    if (this.isDisposing) return
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched || watched.version !== this.switchVersion) return
    this.metrics.recordNativeResync()
    const paused = watched.pauseController.isPaused()
    this.resyncLogger.log('info', 'Directory watcher resync', { reason, paused })
    if (paused) {
      watched.pauseEpisode?.recordUnknownDrop()
      return
    }
    this.sendCompensatingRefresh(dirPath)
  }

  /** Route a watcher's events into the pipeline – the same for both backends. */
  protected attachWatcherListeners(dirPath: string, watcher: DirectoryWatchHandle): void {
    // Handle file/folder additions
    watcher.on('add', (path: string, info?: unknown) => {
      this.queueEvent(dirPath, { type: 'add', path, kind: entryKindOf(info) })
    })

    watcher.on('addDir', (path: string) => {
      this.queueEvent(dirPath, { type: 'addDir', path })
    })

    // Handle file/folder deletions
    watcher.on('unlink', (path: string) => {
      this.queueEvent(dirPath, { type: 'unlink', path })
    })

    watcher.on('unlinkDir', (path: string) => {
      this.queueEvent(dirPath, { type: 'unlinkDir', path })
    })

    // Handle in-place file content modifications (editor autosave via
    // fs.writeFile, terminal commands, external editors). Routes through the
    // same throttle/coalesce/broadcast pipeline as structural events so the
    // renderer's git-status refresh (useGitStatus) wakes on edits, not just
    // on create/delete/rename. A batch of only `change` events goes out with
    // `structural: false`, so the project tree is not re-read for it.
    //
    // Pre-flush note (lens-review Finding 6): with `awaitWriteFinish: false`
    // chokidar may surface a `change` event before the write has fully
    // flushed — chokidar emits a final `change` after flush so state
    // converges, but the first `git status` cycle may see partial content.
    // The 250 ms renderer debounce + git's own stat re-read absorb this;
    // documented chokidar behavior on Windows NTFS in particular.
    //
    // Filter `.git/` paths (lens-review Finding 7): GitWatcherService is the
    // canonical publisher for `.git/HEAD`, `.git/index`, `.git/refs/*` state
    // changes (and reaches the same `useGitStatus.debouncedRefresh`).
    // Suppressing here avoids duplicate refresh requests during
    // `git checkout` / `git commit` and similar internal git operations.
    watcher.on('change', (path: string, info?: unknown) => {
      if (path.includes('/.git/') || path.includes('\\.git\\')) return
      this.queueEvent(dirPath, { type: 'change', path, kind: entryKindOf(info) })
    })

    // Handle errors
    watcher.on('error', (error: unknown) => {
      if (this.isDisposing) return // Ignore errors during disposal
      const errorMessage = error instanceof Error ? error.message : String(error)

      try {
        logger.error(`Directory watcher error for ${dirPath}`, error instanceof Error ? error : undefined)
      } catch {
        // Suppress EPIPE errors
      }

      this.handleWatcherError(dirPath, errorMessage)
    })

    // Handle watcher ready
    watcher.on('ready', () => {
      this.safeLog(`✅ Directory watcher ready for: ${dirPath}`)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)
    })
  }

  /**
   * Whether an internal operation, in a pause still running, noted the
   * removal of this path or a folder above it (#252). The unseen-file probe
   * asks before it reports a missing file, so a tab the operation itself is
   * moving is not marked deleted on the way.
   */
  isOwnRemoval(filePath: string): boolean {
    for (const watched of this.watchedDirectories.values()) {
      if (watched.pauseEpisode?.isOwnRemoval(filePath)) return true
    }
    return false
  }

  /**
   * Pause watching (during internal operations to prevent race conditions)
   * Uses reference counting to support nested pause/resume operations
   *
   * @param senderId - webContents id of the pausing window; only its tree reads
   *   cover the changes dropped during this pause (#210)
   */
  pauseWatch(dirPath: string, senderId?: number): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      const count = watched.pauseController.pause()
      if (count === 1) {
        watched.pauseEpisode = new PauseEpisode(senderId)
      }
      this.safeLog(`⏸️  Paused directory watch for: ${dirPath} (count: ${count})`)
    }
  }

  /**
   * Resume watching after internal operations complete
   * Only resumes when all pause operations have completed (pauseCount reaches 0)
   *
   * At full resume, sends one catch-up refresh when a structural change from
   * outside was dropped after the pausing window's last completed tree read (#210).
   */
  resumeWatch(dirPath: string): boolean {
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) {
      this.safeLog(`⚠️  Resume called for non-existent watcher: ${dirPath}`)
      return false
    }

    const isFullyResumed = watched.pauseController.resume()

    // Only resume when all operations complete
    if (isFullyResumed) {
      this.safeLog(`▶️  Resumed directory watch for: ${dirPath}`)
      const episode = watched.pauseEpisode
      watched.pauseEpisode = undefined
      if (episode?.needsCatchUp()) {
        // Counts only – no path at info
        const reason = episode.isForcedByCap()
          ? 'forced: internal-change cap'
          : `${episode.uncoveredDrops()} external changes missed while paused`
        this.safeLog(`🔄 Catch-up refresh after pause (${reason})`)
        this.sendCompensatingRefresh(dirPath)
      }
      this.listeners.reportPausedRemovals(dirPath, episode)
    } else {
      this.safeLog(`⏸️  Directory watch still paused: ${dirPath} (count: ${watched.pauseController.getCount()})`)
    }
    return true
  }

  /**
   * A tree read of `dirPath` is starting (#210). When it reads the root of a
   * paused watch and comes from the window that paused it, the returned commit
   * marks every change dropped so far as shown – call it only once the read
   * succeeds. Any other read gets a no-op commit.
   *
   * Committing after the pause already ended is harmless: the episode it
   * writes to has been discarded.
   */
  beginTreeRead(dirPath: string, senderId?: number): () => void {
    const noCommit = (): void => {}
    if (!dirPath || typeof dirPath !== 'string') {
      return noCommit
    }

    const readRoot = resolve(dirPath)
    // Only the first root matching the read path is covered; a second key
    // string for the same root costs one extra read, never a missed change.
    for (const watched of this.watchedDirectories.values()) {
      const episode = watched.pauseEpisode
      if (!episode || resolve(watched.dirPath) !== readRoot) {
        continue
      }
      const snapshot = episode.beginTreeRead(senderId)
      return snapshot === null ? noCommit : () => episode.completeTreeRead(snapshot)
    }
    return noCommit
  }

  /**
   * Record changes an internal file operation just made (#210), so the paused
   * watcher does not count their own events as missed external changes. Each
   * change is recorded in every paused root that contains it; with no paused
   * root this is a no-op. Never logs the paths.
   */
  noteInternalChange(...changes: InternalChange[]): void {
    for (const watched of this.watchedDirectories.values()) {
      const episode = watched.pauseEpisode
      if (!episode) {
        continue
      }
      for (const change of changes) {
        if (isLexicallyInside(change.path, watched.dirPath)) {
          episode.noteInternalChange(change)
        }
      }
    }
  }

  /**
   * Handle auto-resume when pause safety timeout fires
   * Logs warning and triggers compensating refresh
   *
   * @see Issue #103 - PauseController can remain paused permanently
   */
  protected handlePauseTimeout(dirPath: string): void {
    logger.warn(
      `Safety timeout: auto-resumed directory watch for ${dirPath} after ${PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS}ms (resume was never called)`
    )

    // The timeout refresh below covers this pause; nothing carries forward (#210)
    const watched = this.watchedDirectories.get(dirPath)
    const episode = watched?.pauseEpisode
    if (watched) {
      watched.pauseEpisode = undefined
    }

    // Trigger compensating refresh to recover any events missed during stuck pause
    this.sendCompensatingRefresh(dirPath)
    // The refresh redraws the tree only; the open files still hear of their removals (#252)
    this.listeners.reportPausedRemovals(dirPath, episode)
  }

  /**
   * Queue an event for throttled processing with VS Code patterns
   */
  protected queueEvent(dirPath: string, incoming: DirectoryChangeEvent): void {
    let event = incoming
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Drop events generated for a previous session
    if (watched.version !== this.switchVersion) {
      logger.debug('Dropping stale event from previous session', { eventType: event.type, path: event.path })
      return
    }

    // Path filter backstop (#211, D4/D13): an excluded, hidden, ignored or
    // outside path is dropped before pause accounting and before it counts as
    // received, so it is never a missed change and never reaches the renderer –
    // a burst of only such paths broadcasts nothing
    if (this.shouldDropAbs(event.path, dirPath)) {
      this.metrics.recordEventFiltered()
      return
    }

    // Judged against the tree on screen before the pause check: a change made
    // during a pause must still keep the record (and a read in flight) honest
    const judged = this.judgeAgainstTree(event)
    event = judged.event
    if (judged.kindSwap) watched.forceStructural = true

    // Ignore if paused (during our own operations). No path in the log line; the
    // episode remembers structural drops so resume can catch up on them (#210).
    if (watched.pauseController.isPaused()) {
      logger.debug('Directory change dropped while paused', { eventType: event.type })
      watched.pauseEpisode?.recordDrop(event.type, event.path)
      return
    }

    // Track metrics
    this.metrics.recordEventReceived()

    // Handle delete events with atomic save detection (VS Code 100ms pattern).
    // Not for the native backend (#211, D2): its `lstat` already confirmed the
    // removal, a rename-style save is coalesced (`unlink` + `add` → `change`),
    // and a large delete must not start one unthrottled `stat` per file.
    if (event.type === 'unlink' && watched.backend !== 'native-recursive') {
      const removedKind = judged.removedKind
      watched.atomicSaveDetector.registerDelete(event.path, (path, wasAtomicSave) => {
        if (wasAtomicSave) {
          // File reappeared → atomic save, emit as change – structural unless
          // it is back as the kind the tree shows (a file↔symlink swap is not a
          // save). One `lstat`, on this rare path only (chokidar reports most
          // atomic saves as a `change` itself); a failed one is structural.
          void Promise.resolve()
            .then(() => lstat(path))
            .then(
              (stats): KnownEntryKind => (stats.isSymbolicLink() ? 'symlink' : 'file'),
              () => undefined
            )
            .then((kind) => {
              if (this.isDisposing || this.watchedDirectories.get(dirPath) !== watched) return
              const rel = this.projectPath ? toRootRelative(this.projectPath, path) : null
              if (rel === null || this.knownEntries.reappeared(rel, removedKind, kind)) {
                watched.forceStructural = true
              }
              watched.throttledWorker.work({ type: 'change', path })
            })
        } else {
          // Actual delete
          watched.throttledWorker.work({ type: 'unlink', path })
        }
      })
      return
    }

    // For non-delete events, queue directly
    watched.throttledWorker.work({ type: event.type, path: event.path })
  }

  /**
   * A tree read of `dirPath` is starting (finding [29]). For a read of the
   * project root the returned handle records its tree as what the screen shows,
   * minus every path an event touched while it ran; commit it only once the read
   * succeeded, cancel it otherwise. A read of a folder inside the project – the
   * tree expanding a lazy folder (finding [32]) – adds that folder's entries to
   * the record under the same rules. Any other read gets a no-op handle.
   */
  beginKnownEntriesRead(dirPath: string): KnownEntriesRead {
    const root = this.projectPath
    const noop: KnownEntriesRead = { commit: () => {}, cancel: () => {} }
    if (!root || typeof dirPath !== 'string') return noop
    if (resolve(dirPath) === resolve(root)) return this.knownEntries.beginRootRead()
    const rel = toRootRelative(root, dirPath)
    return rel === null || rel === '' ? noop : this.knownEntries.beginFolderRead(rel)
  }

  /**
   * Against the tree on screen (see `KnownEntries`): an `add` of an entry it
   * already shows, of the same kind and spelling, is a content change (a temp
   * file renamed over it); a `change` that turned a file into a symlink or back
   * is structural. Then the record follows the event.
   */
  private judgeAgainstTree(event: DirectoryChangeEvent): {
    event: DirectoryChangeEvent
    kindSwap: boolean
    removedKind?: KnownEntryKind
  } {
    const root = this.projectPath
    const rel = root ? toRootRelative(root, event.path) : null
    if (rel === null || rel === '') return { event, kindSwap: false }
    const judged = this.knownEntries.judge(rel, event.type, event.kind)
    return {
      event: judged.type === event.type ? event : { ...event, type: judged.type },
      kindSwap: judged.kindSwap,
      removedKind: judged.removedKind
    }
  }

  /**
   * Process events with coalescing (VS Code pattern)
   */
  protected processEvents(dirPath: string, events: FileChangeEvent[]): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Guard against stale events from old sessions
    if (watched.version !== this.switchVersion) {
      return
    }

    if (events.length === 0) return

    // Apply event coalescing (VS Code pattern)
    const coalescer = new EventCoalescer()
    coalescer.processEvents(events)
    const { events: coalescedEvents, coalescedCount } = coalescer.coalesce()

    // Track metrics
    this.metrics.recordEventsCoalesced(coalescedCount)
    this.metrics.recordEventsEmitted(coalescedEvents.length)

    // A buffer overflow or a kind swap since the last broadcast makes this one structural
    const dropped = watched.forceStructural === true
    watched.forceStructural = false
    this.knownEntries.endBatch()

    if (coalescedEvents.length === 0) {
      this.safeLog(`📁 All ${events.length} events coalesced away for: ${dirPath}`)
      if (dropped) this.sendCompensatingRefresh(dirPath)
      return
    }

    // Log summary
    const summary = coalescedEvents.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const efficiency = events.length > 0
      ? Math.round((coalescedCount / events.length) * 100)
      : 0

    this.safeLog(
      `📁 Directory changed: ${dirPath} (${coalescedEvents.length} events after coalescing ${events.length}, ${efficiency}% reduced: ${JSON.stringify(summary)})`
    )

    this.listeners.reportRemovals(coalescedEvents)

    // Notify all watching webContents
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: coalescedEvents.length,
      originalEventCount: events.length,
      coalescedCount,
      summary,
      structural: dropped || isStructuralRawBatch(events, coalescedEvents)
    } satisfies DirectoryChangedPayload)
  }
}
