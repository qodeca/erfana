// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, WebContents, webContents } from 'electron'
import { normalize, sep } from 'path'
import { settingsService } from './SettingsService'
import { PauseController } from '../utils/PauseController'
import {
  WatcherMetrics,
  EventCoalescer,
  AtomicSaveDetector,
  ThrottledWorker,
  getPlatformConfig,
  getPlatformDiagnostics,
  type FileChangeEvent
} from './watcher'
import { DEFAULT_WATCHER_IGNORE_PATTERNS, PAUSE_CONTROLLER } from '../../shared/constants'
import { logger } from './LoggingService'
import { isSystemDirectory } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'
import { RateLimitedLogger } from '../utils/RateLimitedLogger'

interface WatchedDirectory {
  dirPath: string
  watcher: FSWatcher
  webContentsIds: Set<number>
  pauseController: PauseController
  throttledWorker: ThrottledWorker<FileChangeEvent>
  atomicSaveDetector: AtomicSaveDetector
  version: number
}

// Git index watching migrated to GitWatcherService (Issue #74)

interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'
  path: string
}
export class DirectoryWatcherService {
  private watchedDirectories: Map<string, WatchedDirectory> = new Map()
  private projectPath: string | null = null
  private isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events during project switches
  private switchVersion = 0

  // Performance metrics (VS Code pattern)
  private readonly metrics = new WatcherMetrics()

  // Platform configuration
  private readonly platformConfig = getPlatformConfig()

  // Auto-restart with exponential backoff
  private restartAttempts: Map<string, number> = new Map()
  private pendingRestarts: Map<string, NodeJS.Timeout> = new Map()
  private readonly MAX_RESTART_ATTEMPTS = 3
  private readonly RESTART_BASE_DELAY = 800

  // Dynamic ignore patterns (configurable per-project via .erfana/settings.json)
  private ignorePatterns: string[] = [...DEFAULT_WATCHER_IGNORE_PATTERNS]

  // Rate-limited EMFILE logger (max once per 10s to prevent fd feedback loop)
  private readonly emfileLogger = new RateLimitedLogger('emfile', 10000)

  // Health logger interval (120s)
  private healthLogInterval: NodeJS.Timeout | null = null

  /**
   * Set custom ignore patterns (called by ProjectService after loading settings)
   */
  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns
  }

  /**
   * Get current ignore patterns
   */
  getIgnorePatterns(): string[] {
    return [...this.ignorePatterns]
  }

  /**
   * Fast ignore function - called for every path by chokidar.
   * Uses string includes for performance (faster than regex).
   */
  private shouldIgnorePath = (filePath: string): boolean => {
    for (const pattern of this.ignorePatterns) {
      // Check both Unix and Windows path separators
      if (filePath.includes(`/${pattern}`) || filePath.includes(`\\${pattern}`)) {
        return true
      }
    }
    return false
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    // Bump session on project changes to drop stale events
    this.switchVersion++
  }
  /**
   * Stop all directory watchers (for project switching)
   */
  async stopAll(): Promise<void> {
    this.safeLog('👁️  Stopping all directory watchers...')
    this.stopHealthLogger()
    this.emfileLogger.reset()

    // Clear pending restarts
    for (const timeout of this.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    this.pendingRestarts.clear()
    this.restartAttempts.clear()

    for (const [, watched] of this.watchedDirectories.entries()) {
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      try {
        await watched.watcher.close()
      } catch {
        // ignore
      }
    }
    this.watchedDirectories.clear()
    this.metrics.setActiveWatchers(0)

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
   * Start watching a directory for structural changes
   *
   * Security: Uses normalized path comparison and checks for system directories
   * (Issue #74 review fix - aligned with validateProjectPath pattern)
   */
  async watchDirectory(dirPath: string, webContents: WebContents): Promise<void> {
    // Security: Normalize paths to prevent traversal attacks (Issue #74 review fix)
    const normalizedDirPath = normalize(dirPath)
    const normalizedProjectPath = this.projectPath ? normalize(this.projectPath) : null

    // Security: Check if path is a system directory
    if (isSystemDirectory(normalizedDirPath)) {
      throw new AppError(
        'Cannot watch system or sensitive directories',
        ErrorCode.PATH_SYSTEM_DIR
      )
    }

    // Security: Prevent watching directories outside project
    // Uses normalized paths with separator check to prevent bypasses like /project/../sensitive
    if (normalizedProjectPath && !normalizedDirPath.startsWith(normalizedProjectPath + sep) && normalizedDirPath !== normalizedProjectPath) {
      throw new AppError(
        'Cannot watch directories outside the project directory',
        ErrorCode.PATH_OUTSIDE_PROJECT
      )
    }

    const webContentsId = webContents.id

    // If already watching, just add this webContents
    if (this.watchedDirectories.has(dirPath)) {
      const watched = this.watchedDirectories.get(dirPath)!
      watched.webContentsIds.add(webContentsId)
      this.safeLog(`👁️  Added webContents ${webContentsId} to directory watch: ${dirPath}`)
      return
    }

    this.safeLog(`👁️  Starting directory watch for: ${dirPath}`)

    // Read depth setting (undefined => watch all levels)
    let depth: number | undefined
    try {
      depth = await settingsService.getDirectoryWatchDepth()
    } catch {
      depth = undefined
    }

    // Create new watcher with performance optimizations
    // Uses selective ignore (VS Code approach) - watches dotfolders like .claude, .github
    // but ignores performance-killing directories like node_modules, .git/objects
    const watcher = chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files
      ignored: (path) => this.shouldIgnorePath(path), // Function-based ignore (more reliable than regex)
      usePolling: false, // Use native fs events (faster)
      // chokidar is pinned to ^3.x: v3 uses macOS FSEvents (a single stream, ~0
      // FDs per file). v4 dropped FSEvents and watches each file via kqueue (one
      // FD per file), which exhausts the process FD table on large projects and
      // breaks spawning child processes (e.g. PDF export's hidden render window
      // crashed with "Failed to initialize sandbox" on a 20k-file folder).
      disableGlobbing: true, // Treat the path literally (matches v4); avoids glob chars in project paths
      awaitWriteFinish: false, // Lower latency for editor saves; downstream
                               // consumers tolerate one pre-flush `change` per write.
      depth, // Optional cap for performance
      followSymlinks: false // Security: don't follow symlinks
    })

    // Create throttled worker with VS Code values
    const throttledWorker = new ThrottledWorker<FileChangeEvent>(
      {
        maxWorkChunkSize: this.platformConfig.recommendedChunkSize, // 500
        throttleDelay: 200, // VS Code value
        maxBufferedWork: this.platformConfig.recommendedBufferLimit, // 30,000
        collectionDelay: 75 // VS Code: 75ms collection window
      },
      {
        onWork: (events) => this.processEvents(dirPath, events),
        onOverflow: (count) => {
          this.metrics.recordBufferOverflow(count)
          this.safeLog(`⚠️  Buffer overflow: dropped ${count} oldest events for ${dirPath}`)
        }
      }
    )

    const watched: WatchedDirectory = {
      dirPath,
      watcher,
      webContentsIds: new Set([webContentsId]),
      pauseController: new PauseController({
        timeoutMs: PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS,
        onTimeout: () => this.handlePauseTimeout(dirPath)
      }),
      throttledWorker,
      atomicSaveDetector: new AtomicSaveDetector(),
      version: this.switchVersion
    }

    // Handle file/folder additions
    watcher.on('add', (path: string) => {
      this.queueEvent(dirPath, { type: 'add', path })
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
    // on create/delete/rename.
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
    watcher.on('change', (path: string) => {
      if (path.includes('/.git/') || path.includes('\\.git\\')) return
      this.queueEvent(dirPath, { type: 'change', path })
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

    this.watchedDirectories.set(dirPath, watched)
    this.metrics.setActiveWatchers(this.watchedDirectories.size)

    // Start health logger on first watch
    this.startHealthLogger()
  }

  /**
   * Stop watching a directory for a specific webContents
   */
  async unwatchDirectory(dirPath: string, webContents: WebContents): Promise<void> {
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) {
      return
    }

    const webContentsId = webContents.id
    watched.webContentsIds.delete(webContentsId)

    this.safeLog(`👁️  Removed webContents ${webContentsId} from directory watch: ${dirPath}`)

    // If no more webContents watching this directory, stop watching entirely
    if (watched.webContentsIds.size === 0) {
      this.safeLog(`👁️  Stopping directory watch for: ${dirPath}`)
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      await watched.watcher.close()
      this.watchedDirectories.delete(dirPath)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)
    }
  }

  /**
   * Stop watching all directories for a specific webContents (cleanup on window close)
   */
  async unwatchAll(webContents: WebContents): Promise<void> {
    const webContentsId = webContents.id
    const directoriesToUnwatch: string[] = []

    // Find all directories watched by this webContents
    for (const [dirPath, watched] of this.watchedDirectories.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        directoriesToUnwatch.push(dirPath)
      }
    }

    // Unwatch each directory
    for (const dirPath of directoriesToUnwatch) {
      await this.unwatchDirectory(dirPath, webContents)
    }

    this.safeLog(`👁️  Cleaned up directory watches for webContents ${webContentsId}`)
  }

  /**
   * Cleanup directory watchers owned by a specific webContents.
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

    const directoriesToCleanup: string[] = []

    // Find all directories watched by this webContentsId
    for (const [dirPath, watched] of this.watchedDirectories.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        watched.webContentsIds.delete(webContentsId)

        // If no more watchers, schedule for full cleanup
        if (watched.webContentsIds.size === 0) {
          directoriesToCleanup.push(dirPath)
        }
      }
    }

    // Cleanup directories with no remaining watchers
    for (const dirPath of directoriesToCleanup) {
      const watched = this.watchedDirectories.get(dirPath)
      if (watched) {
        watched.pauseController.dispose()
        watched.throttledWorker.dispose()
        watched.atomicSaveDetector.dispose()
        await watched.watcher.close()
        this.watchedDirectories.delete(dirPath)
      }
    }

    this.metrics.setActiveWatchers(this.watchedDirectories.size)
    this.safeLog(`👁️  Cleaned up directory watches for webContentsId ${webContentsId}`)
  }

  /**
   * Pause watching (during internal operations to prevent race conditions)
   * Uses reference counting to support nested pause/resume operations
   */
  pauseWatch(dirPath: string): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      const count = watched.pauseController.pause()
      this.safeLog(`⏸️  Paused directory watch for: ${dirPath} (count: ${count})`)
    }
  }

  /**
   * Resume watching after internal operations complete
   * Only resumes when all pause operations have completed (pauseCount reaches 0)
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
    } else {
      this.safeLog(`⏸️  Directory watch still paused: ${dirPath} (count: ${watched.pauseController.getCount()})`)
    }
    return true
  }

  /**
   * Handle auto-resume when pause safety timeout fires
   * Logs warning and triggers compensating refresh
   *
   * @see Issue #103 - PauseController can remain paused permanently
   */
  private handlePauseTimeout(dirPath: string): void {
    logger.warn(
      `Safety timeout: auto-resumed directory watch for ${dirPath} after ${PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS}ms (resume was never called)`
    )

    // Trigger compensating refresh to recover any events missed during stuck pause
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: 0,
      originalEventCount: 0,
      coalescedCount: 0,
      summary: {}
    })
  }

  /**
   * Queue an event for throttled processing with VS Code patterns
   */
  private queueEvent(dirPath: string, event: DirectoryChangeEvent): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Drop events generated for a previous session
    if (watched.version !== this.switchVersion) {
      logger.debug('Dropping stale event from previous session', { eventType: event.type, path: event.path })
      return
    }

    // Ignore if paused (during our own operations)
    if (watched.pauseController.isPaused()) {
      this.safeLog(`⏸️  Ignoring directory change (paused): ${event.type} ${event.path}`)
      return
    }

    // Track metrics
    this.metrics.recordEventReceived()

    // Handle delete events with atomic save detection (VS Code 100ms pattern)
    if (event.type === 'unlink') {
      watched.atomicSaveDetector.registerDelete(event.path, (path, wasAtomicSave) => {
        if (wasAtomicSave) {
          // File reappeared → atomic save, emit as change
          watched.throttledWorker.work({ type: 'change', path })
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
   * Process events with coalescing (VS Code pattern)
   */
  private processEvents(dirPath: string, events: FileChangeEvent[]): void {
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

    if (coalescedEvents.length === 0) {
      this.safeLog(`📁 All ${events.length} events coalesced away for: ${dirPath}`)
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

    // Notify all watching webContents
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: coalescedEvents.length,
      originalEventCount: events.length,
      coalescedCount,
      summary
    })
  }

  /**
   * Notify all webContents watching this directory
   */
  private notifyWebContents(
    dirPath: string,
    channel: string,
    data: Record<string, unknown>
  ): void {
    if (this.isDisposing) return // Don't notify during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Ensure only current-session watchers can publish notifications
    if (watched.version !== this.switchVersion) {
      return
    }

    const windows = BrowserWindow.getAllWindows()

    for (const webContentsId of watched.webContentsIds) {
      const window = windows.find((w) => w.webContents.id === webContentsId)
      if (window && !window.isDestroyed()) {
        try {
          window.webContents.send(channel, data)
      } catch (error) {
        // Suppress errors during shutdown (EPIPE, destroyed webContents, etc.)
        if (error instanceof Error && !error.message.includes('destroyed')) {
          this.safeLog(`⚠️  Error sending to webContents: ${error.message}`)
        }
      }
      }
    }
  }

  /**
   * Get statistics about watched directories and performance metrics
   */
  getStats(): {
    totalWatched: number
    directoryDetails: Array<{ path: string; watchers: number; bufferSize: number }>
    metrics: ReturnType<WatcherMetrics['getSnapshot']>
    platform: ReturnType<typeof getPlatformDiagnostics>
  } {
    return {
      totalWatched: this.watchedDirectories.size,
      directoryDetails: Array.from(this.watchedDirectories.entries()).map(([path, watched]) => ({
        path,
        watchers: watched.webContentsIds.size,
        bufferSize: watched.throttledWorker.getBufferSize()
      })),
      metrics: this.metrics.getSnapshot(),
      platform: getPlatformDiagnostics()
    }
  }

  /**
   * Get formatted metrics string for logging
   */
  getFormattedMetrics(): string {
    return this.metrics.getFormattedStats()
  }

  /**
   * Start the periodic health logger (120s interval).
   * Logs watcher health metrics and promotes to warn on stress indicators.
   */
  private startHealthLogger(): void {
    if (this.healthLogInterval !== null) return

    this.healthLogInterval = setInterval(() => {
      const snapshot = this.metrics.getSnapshot()
      const resourceCount = process.getActiveResourcesInfo().length

      const isStressed = snapshot.bufferOverflows > 0 || snapshot.peakEventsPerSecond > 100
      const level = isStressed ? 'warn' : 'debug'

      logger[level]('DirectoryWatcher health', {
        activeWatchers: snapshot.activeWatchers,
        eventsReceived: snapshot.eventsReceived,
        bufferOverflows: snapshot.bufferOverflows,
        errorCounts: snapshot.errorCounts,
        peakEventsPerSecond: snapshot.peakEventsPerSecond,
        resourceCount
      })
    }, 120000)
    this.healthLogInterval.unref()
  }

  /**
   * Stop the periodic health logger.
   */
  private stopHealthLogger(): void {
    if (this.healthLogInterval) {
      clearInterval(this.healthLogInterval)
      this.healthLogInterval = null
    }
  }

  /**
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.stopHealthLogger()
    this.emfileLogger.reset()
    this.safeLog('👁️  Disposing all directory watchers...')
    this.safeLog(this.metrics.getFormattedStats()) // Log final metrics

    // Clear pending restart timers
    for (const timeout of this.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    this.pendingRestarts.clear()
    this.restartAttempts.clear()

    for (const [, watched] of this.watchedDirectories.entries()) {
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      try {
        await watched.watcher.close()
      } catch {
        // Suppress errors during cleanup
      }
    }
    this.watchedDirectories.clear()
  }

  /**
   * Centralized error handling for watcher errors to keep the service recoverable
   */
  private handleWatcherError(dirPath: string, errorMessage: string): void {
    // Guard against late error events from a watcher that was already closed
    if (!this.watchedDirectories.has(dirPath)) return

    // Track error in metrics
    const errorType = this.classifyError(errorMessage)
    this.metrics.recordError(errorType)

    // Rate-limited EMFILE logging to prevent fd feedback loop
    if (errorType === 'EMFILE') {
      this.emfileLogger.log('warn', 'Directory watcher EMFILE', {
        dirPath,
        activeWatchers: this.watchedDirectories.size,
        bufferSize: this.watchedDirectories.get(dirPath)?.throttledWorker.getBufferSize() ?? 0
      })
    }

    // EMFILE-specific handling: tear down watcher immediately, then schedule restart.
    // Chokidar emits EMFILE every ~120ms which resets scheduleRestart's timer,
    // preventing the restart from ever firing. By closing the watcher first,
    // we stop the error cascade and let scheduleRestart complete uninterrupted.
    if (errorType === 'EMFILE') {
      // Skip if a restart is already pending – the watcher is already torn down
      if (this.pendingRestarts.has(dirPath)) return

      const watched = this.watchedDirectories.get(dirPath)!
      const webContentsIds = new Set(watched.webContentsIds)

      // Dispose resources (same as restartWatcher does)
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()

      // Close watcher – fire-and-forget to keep method synchronous.
      // Do NOT call stopAll() on failure – it would cancel the pending restart
      // scheduled below. The watcher is already removed from the map, so a
      // failed close is harmless (no more error events can reach us).
      void watched.watcher.close().catch((closeErr) => {
        logger.error(`Failed to close watcher during EMFILE recovery for ${dirPath}`, closeErr instanceof Error ? closeErr : undefined)
      })

      // Increment switchVersion to invalidate any in-flight events, then remove from map
      this.switchVersion++
      this.watchedDirectories.delete(dirPath)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)

      logger.info(`EMFILE detected for ${dirPath} – watcher torn down, scheduling restart`)
      this.scheduleRestart(dirPath, webContentsIds)
      return
    }

    logger.debug('Watcher error classified', { errorMessage, errorType, isTransient: this.isTransientError(errorType) })

    // Get webContentsIds before potentially removing the watched directory
    const watched = this.watchedDirectories.get(dirPath)
    const webContentsIds = watched ? new Set(watched.webContentsIds) : new Set<number>()

    // Check if this is a transient error that we should retry
    if (this.isTransientError(errorType)) {
      const attempts = this.restartAttempts.get(dirPath) ?? 0
      if (attempts < this.MAX_RESTART_ATTEMPTS) {
        this.scheduleRestart(dirPath, webContentsIds)
        return
      }
    }

    // If project root was deleted (ENOENT) and max retries exceeded, or permanent error
    if (errorType === 'ENOENT') {
      this.notifyWebContents(dirPath, 'directory-watch:project-deleted', { dirPath })
      // Use stopAll instead of dispose to keep service reusable without setting isDisposing
      void this.stopAll()
      return
    }

    // Generic error path for permanent errors
    this.notifyWebContents(dirPath, 'directory-watch:error', {
      dirPath,
      error: errorMessage,
      errorType
    })
  }

  /**
   * Classify error message into error type (VS Code pattern)
   */
  private classifyError(errorMessage: string): string {
    const msg = errorMessage.toLowerCase()
    if (msg.includes('enoent') || msg.includes('no such file')) return 'ENOENT'
    if (msg.includes('emfile') || msg.includes('too many')) return 'EMFILE'
    if (msg.includes('enospc') || msg.includes('no space')) return 'ENOSPC'
    if (msg.includes('eperm') || msg.includes('permission')) return 'EPERM'
    if (msg.includes('eacces') || msg.includes('access denied')) return 'EACCES'
    if (msg.includes('estale') || msg.includes('stale')) return 'ESTALE'
    return 'UNKNOWN'
  }

  /**
   * Check if an error type is transient and can be recovered with a restart
   */
  private isTransientError(errorType: string): boolean {
    return ['ENOENT', 'EMFILE', 'EACCES', 'ESTALE'].includes(errorType)
  }

  /**
   * Schedule a watcher restart with exponential backoff
   */
  private scheduleRestart(dirPath: string, webContentsIds: Set<number>): void {
    const attempts = this.restartAttempts.get(dirPath) ?? 0
    const delay = this.RESTART_BASE_DELAY * Math.pow(2, attempts)

    logger.debug('Watcher restart scheduled', {
      dirPath,
      attempt: attempts + 1,
      delay,
      pendingRestartCount: this.pendingRestarts.size
    })

    // Clear any existing pending restart
    const existingTimeout = this.pendingRestarts.get(dirPath)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(async () => {
      this.pendingRestarts.delete(dirPath)
      await this.restartWatcher(dirPath, webContentsIds)
    }, delay)

    this.pendingRestarts.set(dirPath, timeout)
    this.metrics.recordRestartScheduled()
  }

  /**
   * Attempt to restart a watcher after failure
   */
  private async restartWatcher(dirPath: string, webContentsIds: Set<number>): Promise<void> {
    if (this.isDisposing) return // Don't restart during disposal

    const attempts = (this.restartAttempts.get(dirPath) ?? 0) + 1
    this.restartAttempts.set(dirPath, attempts)

    logger.info(`Attempting watcher restart for ${dirPath} (attempt ${attempts}/${this.MAX_RESTART_ATTEMPTS})`)

    try {
      // Stop existing watcher if any
      const existing = this.watchedDirectories.get(dirPath)
      if (existing) {
        existing.pauseController.dispose()
        existing.throttledWorker.dispose()
        existing.atomicSaveDetector.dispose()
        await existing.watcher.close()
        this.watchedDirectories.delete(dirPath)
      }

      // Try to restart for each webContents that was watching
      for (const webContentsId of webContentsIds) {
        const webContents = this.getWebContentsById(webContentsId)
        if (webContents && !webContents.isDestroyed()) {
          await this.watchDirectory(dirPath, webContents)
        }
      }

      // Success - reset attempts and notify
      this.restartAttempts.delete(dirPath)
      logger.info(`Watcher restart successful for ${dirPath}`)
      this.metrics.recordRestartSuccess()

      // Emit recovery event
      this.notifyWebContents(dirPath, 'directory-watch:recovered', { dirPath })

    } catch (error) {
      logger.error(`Watcher restart failed for ${dirPath}`, error instanceof Error ? error : undefined)
      this.metrics.recordRestartFailure()

      if (attempts < this.MAX_RESTART_ATTEMPTS) {
        // Schedule another attempt
        this.scheduleRestart(dirPath, webContentsIds)
      } else {
        // Max attempts reached - notify user
        logger.warn(`Max restart attempts (${this.MAX_RESTART_ATTEMPTS}) reached for ${dirPath}`)
        this.restartAttempts.delete(dirPath)
        this.notifyWebContents(dirPath, 'directory-watch:restart-failed', {
          dirPath,
          attempts: this.MAX_RESTART_ATTEMPTS,
          message: 'File watcher could not recover. Please reload the project.'
        })
      }
    }
  }

  /**
   * Get webContents by ID
   */
  private getWebContentsById(id: number): WebContents | undefined {
    return webContents.getAllWebContents().find((wc) => wc.id === id)
  }
}

// Singleton instance
export const directoryWatcherService = new DirectoryWatcherService()
