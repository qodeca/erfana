import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, WebContents } from 'electron'
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
import { DEFAULT_WATCHER_IGNORE_PATTERNS } from '../../shared/constants'
import { logger } from './LoggingService'

interface WatchedDirectory {
  dirPath: string
  watcher: FSWatcher
  webContentsIds: Set<number>
  pauseController: PauseController
  throttledWorker: ThrottledWorker<FileChangeEvent>
  atomicSaveDetector: AtomicSaveDetector
  version: number
}

interface GitIndexWatcher {
  watcher: FSWatcher
  projectPath: string
  version: number
}

interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir'
  path: string
}
export class DirectoryWatcherService {
  private watchedDirectories: Map<string, WatchedDirectory> = new Map()
  private projectPath: string | null = null
  private isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events during project switches
  private switchVersion = 0

  // Git index watcher for detecting external git operations (git add, checkout, reset)
  private gitIndexWatcher: GitIndexWatcher | null = null
  // Debounce timer for git index changes (prevents spam during rapid git operations)
  private gitIndexDebounceTimer: NodeJS.Timeout | null = null
  private readonly GIT_INDEX_DEBOUNCE_MS = 300 // Debounce git index changes

  // Performance metrics (VS Code pattern)
  private readonly metrics = new WatcherMetrics()

  // Platform configuration
  private readonly platformConfig = getPlatformConfig()

  // Dynamic ignore patterns (configurable per-project via .erfana/settings.json)
  private ignorePatterns: string[] = [...DEFAULT_WATCHER_IGNORE_PATTERNS]

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
    for (const [, watched] of this.watchedDirectories.entries()) {
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

    // Stop git index watcher
    await this.stopGitIndexWatcher()

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
   */
  async watchDirectory(dirPath: string, webContents: WebContents): Promise<void> {
    // Security: Prevent watching directories outside project
    if (this.projectPath && !dirPath.startsWith(this.projectPath)) {
      throw new Error('Cannot watch directories outside the project directory')
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
      awaitWriteFinish: false, // Not needed for directory operations
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
      pauseController: new PauseController(),
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
   * - Also stops git index watcher (shared resource)
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
        watched.throttledWorker.dispose()
        watched.atomicSaveDetector.dispose()
        await watched.watcher.close()
        this.watchedDirectories.delete(dirPath)
      }
    }

    // Stop git index watcher for this webContents
    // Note: Git index watcher is shared - stopping here affects all windows watching this project
    await this.stopGitIndexWatcher()

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
  resumeWatch(dirPath: string): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      const isFullyResumed = watched.pauseController.resume()

      // Only resume when all operations complete
      if (isFullyResumed) {
        this.safeLog(`▶️  Resumed directory watch for: ${dirPath}`)
      } else {
        this.safeLog(`⏸️  Directory watch still paused: ${dirPath} (count: ${watched.pauseController.getCount()})`)
      }
    }
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
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.safeLog('👁️  Disposing all directory watchers...')
    this.safeLog(this.metrics.getFormattedStats()) // Log final metrics

    for (const [, watched] of this.watchedDirectories.entries()) {
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      try {
        await watched.watcher.close()
      } catch {
        // Suppress errors during cleanup
      }
    }
    this.watchedDirectories.clear()

    // Stop git index watcher
    await this.stopGitIndexWatcher()
  }

  /**
   * Start watching .git/index file for external git operations
   * Triggers git:index-changed event when git add, checkout, reset, etc. occur
   */
  async startGitIndexWatcher(projectPath: string, webContents: WebContents): Promise<void> {
    // Stop existing watcher if any
    await this.stopGitIndexWatcher()

    // Store webContentsId instead of webContents object to prevent stale reference (issue #59)
    const webContentsId = webContents.id
    const gitIndexPath = `${projectPath}/.git/index`

    // Check if .git/index exists (not a git repo if missing)
    try {
      const fs = await import('fs/promises')
      await fs.access(gitIndexPath)
    } catch {
      this.safeLog(`👁️  No .git/index found at: ${projectPath} (not a git repo or bare repo)`)
      return
    }

    this.safeLog(`👁️  Starting git index watcher for: ${gitIndexPath}`)

    const watcher = chokidar.watch(gitIndexPath, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: false,
      followSymlinks: false
    })

    this.gitIndexWatcher = {
      watcher,
      projectPath,
      version: this.switchVersion
    }

    // Watch for changes to .git/index (modified during git add, checkout, reset, etc.)
    watcher.on('change', () => {
      if (this.isDisposing) return
      if (!this.gitIndexWatcher || this.gitIndexWatcher.version !== this.switchVersion) return

      // Debounce rapid changes (e.g., git add multiple files)
      if (this.gitIndexDebounceTimer) {
        clearTimeout(this.gitIndexDebounceTimer)
      }

      this.gitIndexDebounceTimer = setTimeout(() => {
        this.gitIndexDebounceTimer = null
        this.safeLog(`🔄 Git index changed: ${gitIndexPath}`)

        // Notify renderer about git index change (use stored ID, not potentially stale reference)
        const windows = BrowserWindow.getAllWindows()
        const window = windows.find(w => w.webContents.id === webContentsId)
        if (window && !window.isDestroyed()) {
          try {
            window.webContents.send('git:index-changed', { projectPath })
          } catch (error) {
            if (error instanceof Error && !error.message.includes('destroyed')) {
              this.safeLog(`⚠️  Error sending git:index-changed: ${error.message}`)
            }
          }
        }
      }, this.GIT_INDEX_DEBOUNCE_MS)
    })

    watcher.on('error', (error: unknown) => {
      if (this.isDisposing) return
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.safeLog(`⚠️  Git index watcher error: ${errorMessage}`)
    })

    watcher.on('ready', () => {
      this.safeLog(`✅ Git index watcher ready for: ${gitIndexPath}`)
    })
  }

  /**
   * Stop the git index watcher
   */
  async stopGitIndexWatcher(): Promise<void> {
    if (this.gitIndexDebounceTimer) {
      clearTimeout(this.gitIndexDebounceTimer)
      this.gitIndexDebounceTimer = null
    }

    if (this.gitIndexWatcher) {
      try {
        await this.gitIndexWatcher.watcher.close()
      } catch {
        // Ignore errors during cleanup
      }
      this.gitIndexWatcher = null
      this.safeLog('👁️  Git index watcher stopped')
    }
  }

  /**
   * Centralized error handling for watcher errors to keep the service recoverable
   */
  private handleWatcherError(dirPath: string, errorMessage: string): void {
    // Track error in metrics
    const errorType = this.classifyError(errorMessage)
    this.metrics.recordError(errorType)

    // If project root was deleted, notify and cleanup in a recoverable way
    if (errorType === 'ENOENT') {
      this.notifyWebContents(dirPath, 'directory-watch:project-deleted', { dirPath })
      // Use stopAll instead of dispose to keep service reusable without setting isDisposing
      void this.stopAll()
      return
    }

    // Generic error path
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
    if (msg.includes('estale') || msg.includes('stale')) return 'ESTALE'
    return 'UNKNOWN'
  }
}

// Singleton instance
export const directoryWatcherService = new DirectoryWatcherService()
