// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { FSWatcher } from 'chokidar'
import { WebContents } from 'electron'
import { stat } from 'fs/promises'
import { logger } from './LoggingService'
import { classifyConfinement } from '../utils/projectConfinement'
import { createAtomicSaveDetector } from './watcher/AtomicSaveDetector'
import { SubscriberCounter } from './watcher/SubscriberCounter'
import { createSingleFileWatcher } from './watcher/singleFileWatch'
import { sendToSubscribers } from './watcher/watchNotifier'
import { AtomicRearmDeps, RearmableWatch, resolveDeletedWatch } from './watcher/atomicRearm'

interface WatchedFile {
  filePath: string
  watcher: FSWatcher
  /**
   * Subscription count per webContents. A count (not a `Set` of ids) so two
   * consumers inside one window cannot cancel each other's watch (issue #70).
   */
  subscribers: SubscriberCounter
  isPaused: boolean
  debounceTimer: NodeJS.Timeout | null
  version: number
}

export class FileWatcherService {
  private watchedFiles: Map<string, WatchedFile> = new Map()
  private readonly DEBOUNCE_DELAY = 300 // ms
  private readonly MAX_WATCHED_FILES = 100
  private projectPath: string | null = null
  private isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events
  private switchVersion = 0
  /**
   * One detector for the whole service, not one per watched file.
   *
   * `AtomicSaveDetector` already keys its pending deletes by path, and this
   * service is 1 watcher : 1 path, so a per-file detector would be a Map with a
   * single entry duplicated across every watch - with disposal duties in four
   * methods. One instance keeps disposal in one place (issue #70, M2).
   */
  private readonly atomicSaveDetector = createAtomicSaveDetector()

  /**
   * The seam the atomic re-arm branch talks to this service through.
   *
   * Built once as a field of bound closures so `watcher/atomicRearm.ts` never
   * needs access to the private map, the session token or the disposal flag.
   */
  private readonly rearmDeps: AtomicRearmDeps = {
    isDisposing: () => this.isDisposing,
    currentVersion: () => this.switchVersion,
    getWatch: filePath => this.watchedFiles.get(filePath),
    isPathConfined: filePath => this.isPathConfined(filePath),
    createWatcher: filePath => this.createWatcher(filePath),
    replaceWatcher: (filePath, watcher) => this.replaceWatcher(filePath, watcher),
    discardWatch: (filePath, watched) => this.discardWatch(filePath, watched),
    notifyDeleted: filePath => this.notifyWebContents(filePath, 'file-watch:deleted', { filePath }),
    notifyWatchDead: (filePath, reason) => this.notifyWatchDead(filePath, reason),
    emitChange: filePath => this.handleFileChange(filePath),
    log: message => this.safeLog(message)
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    // Bump session on project changes to drop stale events
    this.switchVersion++
  }
  /**
   * Stop all file watchers (for project switching)
   */
  async stopAll(): Promise<void> {
    this.safeLog('👁️  Stopping all file watchers...')
    for (const [filePath, watched] of this.watchedFiles.entries()) {
      this.atomicSaveDetector.cancelPending(filePath)
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      try {
        await watched.watcher.close()
      } catch {
        // ignore
      }
    }
    this.watchedFiles.clear()
    // Increment session to ignore late events from the previous watchers
    this.switchVersion++
  }

  /**
   * Safe logging that handles EPIPE errors during app shutdown
   */
  private safeLog(message: string): void {
    if (this.isDisposing) return // Don't log during disposal
    try {
      logger.info(message)
    } catch (error) {
      // Suppress EPIPE errors during shutdown
      if (error instanceof Error && !error.message.includes('EPIPE')) {
        // Only re-throw non-EPIPE errors
        throw error
      }
    }
  }

  /**
   * Start watching a file for changes
   */
  async watchFile(filePath: string, webContents: WebContents): Promise<void> {
    // Security: Prevent watching files outside project
    if (this.projectPath && !filePath.startsWith(this.projectPath)) {
      throw new Error('Cannot watch files outside the project directory')
    }

    // Verify file exists
    try {
      await stat(filePath)
    } catch {
      throw new Error(`File does not exist: ${filePath}`)
    }

    const webContentsId = webContents.id

    // If already watching, just add this webContents.
    //
    // Joining an existing watch is decided BEFORE the MAX_WATCHED_FILES cap and
    // can never fail on it. Refusing a second consumer once the map is full
    // would leave it unwatched while its later `unwatchFile` still decremented
    // the count - closing the watcher for the first consumer, which is exactly
    // the D3 defect subscriber counting exists to remove (issue #70).
    const existing = this.watchedFiles.get(filePath)
    if (existing) {
      existing.subscribers.add(webContentsId)
      this.safeLog(`👁️  Added webContents ${webContentsId} to watch: ${filePath}`)
      // The file was unlinked moments ago and the replacement has already
      // landed (we just stat-ed it). The existing watcher is still bound to the
      // dead inode, so joining it would deafen this subscriber: resolve the
      // pending check now and re-arm instead (issue #70, L-2).
      if (this.atomicSaveDetector.hasPending(filePath)) {
        this.atomicSaveDetector.cancelPending(filePath)
        // The stat above already proved the replacement is on disk, which is
        // exactly the detector's atomic-save verdict.
        await resolveDeletedWatch(filePath, true, this.rearmDeps)
        // The re-arm can also decide the watch is dead (file gone again, path
        // no longer inside the project, session moved on) and drop the entry
        // while this call awaits it. Reporting success then would leave the
        // renderer believing it watches a path that has no watcher (#70, LOW-3).
        if (!this.watchedFiles.has(filePath)) {
          throw new Error(`File watch ended while joining: ${filePath}`)
        }
      }
      return
    }

    // The cap governs NEW entries only - see the join branch above.
    if (this.watchedFiles.size >= this.MAX_WATCHED_FILES) {
      throw new Error(`Maximum watched files limit reached (${this.MAX_WATCHED_FILES})`)
    }

    this.safeLog(`👁️  Starting watch for: ${filePath}`)

    const watcher = this.createWatcher(filePath)

    const watched: WatchedFile = {
      filePath,
      watcher,
      subscribers: SubscriberCounter.from([webContentsId]),
      isPaused: false,
      debounceTimer: null,
      version: this.switchVersion
    }

    this.watchedFiles.set(filePath, watched)
  }

  /**
   * Create a chokidar watcher for one path with this service's handlers.
   *
   * Shared by the initial watch and by the atomic re-arm so the production
   * option object - including the load-bearing `disableGlobbing: true` v3 pin -
   * and the three handler registrations exist exactly once (issue #70, M3).
   */
  private createWatcher(filePath: string): FSWatcher {
    return createSingleFileWatcher(filePath, {
      onChange: () => this.handleFileChange(filePath),
      onUnlink: () => this.handleFileDeleted(filePath),
      onError: (error: unknown) => this.handleWatcherError(filePath, error)
    })
  }

  /**
   * Point a watched path's record at a replacement watcher. The only supported
   * way for the re-arm branch to swap one in, so every mutation of
   * `watchedFiles` stays inside this service (issue #70, arch M3).
   *
   * @returns false when the entry has since been dropped, so the caller knows
   *          its new watcher is orphaned and must be closed
   */
  private replaceWatcher(filePath: string, watcher: FSWatcher): boolean {
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return false
    watched.watcher = watcher
    return true
  }

  /**
   * Is this path still inside the open project, symlinks resolved?
   *
   * `watchFile`'s entry check is lexical, which a symlink defeats. The re-arm
   * runs long after that check, on a path an outside writer just replaced, so
   * it re-validates with `fs.realpath` before binding a new watcher (#70). A
   * missing path stays "confined" - the re-arm's own existence check reports
   * the delete, which is the accurate outcome - and with no project path there
   * is no boundary to enforce, matching the entry check.
   */
  private async isPathConfined(filePath: string): Promise<boolean> {
    if (!this.projectPath) return true
    const verdict = await classifyConfinement(filePath, this.projectPath)
    return verdict === 'inside' || verdict === 'missing'
  }

  /**
   * Report a chokidar-level watcher error to the subscribing renderers
   */
  private handleWatcherError(filePath: string, error: unknown): void {
    if (this.isDisposing) return // Ignore errors during disposal
    const errorMessage = error instanceof Error ? error.message : String(error)

    try {
      logger.error(`File watcher error for ${filePath}`, error instanceof Error ? error : undefined)
    } catch {
      // Suppress EPIPE errors
    }

    this.notifyWebContents(filePath, 'file-watch:error', {
      filePath,
      error: errorMessage
    })
  }

  /**
   * Stop watching a file for a specific webContents
   */
  async unwatchFile(filePath: string, webContents: WebContents): Promise<void> {
    const watched = this.watchedFiles.get(filePath)
    if (!watched) {
      return
    }

    const webContentsId = webContents.id
    const remaining = watched.subscribers.release(webContentsId)

    this.safeLog(`👁️  Removed webContents ${webContentsId} from watch: ${filePath}`)

    // If no more subscribers watching this file, stop watching entirely
    if (remaining === 0) {
      this.safeLog(`👁️  Stopping watch for: ${filePath}`)
      await this.closeAndForget(filePath, watched)
    }
  }

  /**
   * Stop watching all files for a specific webContents (cleanup on window close)
   */
  async unwatchAll(webContents: WebContents): Promise<void> {
    await this.dropSubscriber(webContents.id)
    this.safeLog(`👁️  Cleaned up watches for webContents ${webContents.id}`)
  }

  /**
   * Cleanup file watchers owned by a specific webContents.
   * Called when webContents is destroyed (window close or dev refresh).
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @remarks
   * - Increments session version to invalidate pending events (race guard)
   * - Fire-and-forget safe - errors are logged but don't propagate
   * @see Issue #59 - App enters broken state after window close
   */
  async cleanupForWebContentsId(webContentsId: number): Promise<void> {
    // Bump session version FIRST to invalidate pending events before cleanup (issue #59)
    this.switchVersion++
    await this.dropSubscriber(webContentsId)
    this.safeLog(`👁️  Cleaned up file watches for webContentsId ${webContentsId}`)
  }

  /**
   * Drop every subscription one webContents holds and close the watches that
   * are left with no subscriber at all.
   *
   * The window is going away, so its subscriptions die together: the count is
   * removed outright rather than decremented, which would leave a phantom
   * subscriber holding the watch open forever.
   */
  private async dropSubscriber(webContentsId: number): Promise<void> {
    const emptied: string[] = []

    for (const [filePath, watched] of this.watchedFiles.entries()) {
      if (!watched.subscribers.has(webContentsId)) continue
      watched.subscribers.removeAll(webContentsId)
      if (watched.subscribers.size === 0) {
        emptied.push(filePath)
      }
    }

    for (const filePath of emptied) {
      const watched = this.watchedFiles.get(filePath)
      if (watched) {
        await this.closeAndForget(filePath, watched)
      }
    }
  }

  /**
   * Cancel every pending operation for a watch, close it and drop the entry
   */
  private async closeAndForget(filePath: string, watched: WatchedFile): Promise<void> {
    this.cancelPendingWork(filePath, watched)
    await watched.watcher.close()
    this.watchedFiles.delete(filePath)
  }

  /**
   * Drop the atomic-save check and the debounce timer for a watch
   */
  private cancelPendingWork(filePath: string, watched: RearmableWatch): void {
    this.atomicSaveDetector.cancelPending(filePath)
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)
      watched.debounceTimer = null
    }
  }

  /**
   * Pause watching a file (during save operations to prevent race conditions)
   */
  pauseWatch(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (watched) {
      watched.isPaused = true
      this.safeLog(`⏸️  Paused watch for: ${filePath}`)
    }
  }

  /**
   * Resume watching a file after save completes
   */
  resumeWatch(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (watched) {
      watched.isPaused = false
      this.safeLog(`▶️  Resumed watch for: ${filePath}`)
    }
  }

  /**
   * Handle file change events with debouncing
   */
  private handleFileChange(filePath: string): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return
    // Drop events generated for a previous session
    if (watched.version !== this.switchVersion) {
      return
    }

    // Ignore if paused (during our own save)
    if (watched.isPaused) {
      this.safeLog(`⏸️  Ignoring change (paused): ${filePath}`)
      return
    }

    // Clear existing debounce timer
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)
    }

    // Debounce: wait for file changes to settle
    watched.debounceTimer = setTimeout(() => {
      if (this.isDisposing) return // Check again after timeout
      this.safeLog(`📝 File changed externally: ${filePath}`)
      this.notifyWebContents(filePath, 'file-watch:changed', { filePath })
      watched.debounceTimer = null
    }, this.DEBOUNCE_DELAY)
  }

  /**
   * Handle file deletion.
   *
   * An unlink is ambiguous: it is either a genuine delete or the first half of
   * an atomic save (write temp, rename over the target), which is how most
   * agents and design tools write. The entry is deliberately kept alive for the
   * detector's 100 ms window so the second half can turn it into a change
   * instead of destroying the watch (issue #70, defect D2).
   */
  private handleFileDeleted(filePath: string): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return
    // Ignore late delete notices from previous sessions
    if (watched.version !== this.switchVersion) {
      return
    }

    this.atomicSaveDetector.registerDelete(filePath, (path, wasAtomicSave) => {
      void resolveDeletedWatch(path, wasAtomicSave, this.rearmDeps)
    })
  }

  /**
   * Fire-and-forget teardown, used from the async unlink branch where there is
   * nobody left to await the close
   */
  private discardWatch(filePath: string, watched: RearmableWatch): void {
    this.cancelPendingWork(filePath, watched)
    void watched.watcher.close().catch(() => {})
    this.watchedFiles.delete(filePath)
  }

  /**
   * Notify all webContents watching this file
   */
  private notifyWebContents(
    filePath: string,
    channel: string,
    data: Record<string, unknown>
  ): void {
    if (this.isDisposing) return // Don't notify during disposal
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return
    // Ensure only current-session watchers can publish notifications
    if (watched.version !== this.switchVersion) {
      return
    }

    this.send(watched, channel, data)
  }

  /**
   * Tell subscribers their watch is dead, bypassing the session-version guard.
   *
   * {@link notifyWebContents} drops anything whose version no longer matches -
   * which is precisely the case this message has to survive, since "your watch
   * ended with the session" is only ever sent on a version mismatch. The
   * disposal and destroyed-window guards still apply (issue #70, H-4b).
   */
  private notifyWatchDead(filePath: string, reason: string): void {
    if (this.isDisposing) return
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return

    this.send(watched, 'file-watch:error', { filePath, error: reason })
  }

  /** Hand one event to the subscribing windows (see `watcher/watchNotifier`) */
  private send(watched: WatchedFile, channel: string, data: Record<string, unknown>): void {
    sendToSubscribers(watched.subscribers, channel, data, message => this.safeLog(message))
  }

  /**
   * Get statistics about watched files (for debugging)
   */
  getStats(): { totalWatched: number; fileDetails: Array<{ path: string; watchers: number }> } {
    return {
      totalWatched: this.watchedFiles.size,
      fileDetails: Array.from(this.watchedFiles.entries()).map(([path, watched]) => ({
        path,
        watchers: watched.subscribers.size
      }))
    }
  }

  /**
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.safeLog('👁️  Disposing all file watchers...')
    this.atomicSaveDetector.dispose()

    for (const [, watched] of this.watchedFiles.entries()) {
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      try {
        await watched.watcher.close()
      } catch {
        // Suppress errors during cleanup
      }
    }
    this.watchedFiles.clear()
  }
}

// Singleton instance
export const fileWatcherService = new FileWatcherService()
