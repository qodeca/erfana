import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, WebContents } from 'electron'
import { settingsService } from './SettingsService'

interface WatchedDirectory {
  dirPath: string
  watcher: FSWatcher
  webContentsIds: Set<number>
  isPaused: boolean
  debounceTimer: NodeJS.Timeout | null
  pendingEvents: DirectoryChangeEvent[]
  version: number
}

interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir'
  path: string
}

export class DirectoryWatcherService {
  private watchedDirectories: Map<string, WatchedDirectory> = new Map()
  private readonly DEBOUNCE_DELAY = 1000 // 1s for bulk operations
  private readonly MIN_EVENTS_FOR_BULK = 5 // Threshold for bulk operation detection
  private projectPath: string | null = null
  private isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events during project switches
  private switchVersion = 0

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
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      try {
        await watched.watcher.close()
      } catch {
        // ignore
      }
    }
    this.watchedDirectories.clear()
    // Increment session to ignore late events from the previous watchers
    this.switchVersion++
  }

  /**
   * Safe logging that handles EPIPE errors during app shutdown
   */
  private safeLog(message: string): void {
    if (this.isDisposing) return // Don't log during disposal
    try {
      console.log(message)
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
    const watcher = chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files
      ignored: [
        // Hidden files and folders (except .md files which might be hidden)
        /(^|[/\\])\.[^/\\]+$/,
        // Specific directories to ignore
        /(^|[/\\])node_modules($|[/\\])/,
        /(^|[/\\])\.git($|[/\\])/,
        /(^|[/\\])out($|[/\\])/,
        /(^|[/\\])dist($|[/\\])/,
        /(^|[/\\])build($|[/\\])/,
        /(^|[/\\])\.next($|[/\\])/,
        /(^|[/\\])\.cache($|[/\\])/,
        // macOS specific
        /\.DS_Store$/,
        // Editor specific
        /\.swp$/,
        /~$/,
        /(^|[/\\])\.vscode($|[/\\])/,
        /(^|[/\\])\.idea($|[/\\])/
      ],
      usePolling: false, // Use native fs events (faster)
      awaitWriteFinish: false, // Not needed for directory operations
      depth, // Optional cap for performance
      followSymlinks: false // Security: don't follow symlinks
    })

    const watched: WatchedDirectory = {
      dirPath,
      watcher,
      webContentsIds: new Set([webContentsId]),
      isPaused: false,
      debounceTimer: null,
      pendingEvents: [],
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
        console.error(`Directory watcher error for ${dirPath}:`, error)
      } catch {
        // Suppress EPIPE errors
      }

      this.handleWatcherError(dirPath, errorMessage)
    })

    // Handle watcher ready
    watcher.on('ready', () => {
      this.safeLog(`✅ Directory watcher ready for: ${dirPath}`)
    })

    this.watchedDirectories.set(dirPath, watched)
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
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      await watched.watcher.close()
      this.watchedDirectories.delete(dirPath)
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
   * Pause watching (during internal operations to prevent race conditions)
   */
  pauseWatch(dirPath: string): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      watched.isPaused = true
      this.safeLog(`⏸️  Paused directory watch for: ${dirPath}`)
    }
  }

  /**
   * Resume watching after internal operations complete
   */
  resumeWatch(dirPath: string): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      watched.isPaused = false
      this.safeLog(`▶️  Resumed directory watch for: ${dirPath}`)
    }
  }

  /**
   * Queue an event for debounced processing
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
    if (watched.isPaused) {
      this.safeLog(`⏸️  Ignoring directory change (paused): ${event.type} ${event.path}`)
      return
    }

    // Add to pending events
    watched.pendingEvents.push(event)

    // Clear existing debounce timer
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)
    }

    // Determine debounce delay based on event frequency
    // If we have many pending events, it's likely a bulk operation (git, npm, etc)
    const isBulkOperation = watched.pendingEvents.length >= this.MIN_EVENTS_FOR_BULK
    const delay = isBulkOperation ? this.DEBOUNCE_DELAY : 300 // Shorter delay for single events

    // Debounce: wait for changes to settle
    watched.debounceTimer = setTimeout(() => {
      this.processEvents(dirPath)
      watched.debounceTimer = null
    }, delay)
  }

  /**
   * Process all pending events and notify renderer
   */
  private processEvents(dirPath: string): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Guard against stale timers/events from old sessions
    if (watched.version !== this.switchVersion) {
      return
    }

    const eventCount = watched.pendingEvents.length
    if (eventCount === 0) return

    // Log summary
    const summary = watched.pendingEvents.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    this.safeLog(
      `📁 Directory changed: ${dirPath} (${eventCount} events: ${JSON.stringify(summary)})`
    )

    // Notify all watching webContents
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount,
      summary
    })

    // Clear pending events
    watched.pendingEvents = []
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
   * Get statistics about watched directories (for debugging)
   */
  getStats(): {
    totalWatched: number
    directoryDetails: Array<{ path: string; watchers: number; pendingEvents: number }>
  } {
    return {
      totalWatched: this.watchedDirectories.size,
      directoryDetails: Array.from(this.watchedDirectories.entries()).map(([path, watched]) => ({
        path,
        watchers: watched.webContentsIds.size,
        pendingEvents: watched.pendingEvents.length
      }))
    }
  }

  /**
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.safeLog('👁️  Disposing all directory watchers...')

    for (const [, watched] of this.watchedDirectories.entries()) {
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
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
    // If project root was deleted, notify and cleanup in a recoverable way
    if (errorMessage.includes('ENOENT') || errorMessage.toLowerCase().includes('no such file')) {
      this.notifyWebContents(dirPath, 'directory-watch:project-deleted', { dirPath })
      // Use stopAll instead of dispose to keep service reusable without setting isDisposing
      void this.stopAll()
      return
    }

    // Generic error path
    this.notifyWebContents(dirPath, 'directory-watch:error', {
      dirPath,
      error: errorMessage
    })
  }
}

// Singleton instance
export const directoryWatcherService = new DirectoryWatcherService()
