// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, WebContents } from 'electron'
import { stat } from 'fs/promises'
import { logger } from './LoggingService'

interface WatchedFile {
  filePath: string
  watcher: FSWatcher
  webContentsIds: Set<number>
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
    for (const [, watched] of this.watchedFiles.entries()) {
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

    // Check max watched files limit
    if (this.watchedFiles.size >= this.MAX_WATCHED_FILES) {
      throw new Error(`Maximum watched files limit reached (${this.MAX_WATCHED_FILES})`)
    }

    // Verify file exists
    try {
      await stat(filePath)
    } catch {
      throw new Error(`File does not exist: ${filePath}`)
    }

    const webContentsId = webContents.id

    // If already watching, just add this webContents
    if (this.watchedFiles.has(filePath)) {
      const watched = this.watchedFiles.get(filePath)!
      watched.webContentsIds.add(webContentsId)
      this.safeLog(`👁️  Added webContents ${webContentsId} to watch: ${filePath}`)
      return
    }

    this.safeLog(`👁️  Starting watch for: ${filePath}`)

    // Create new watcher
    const watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true, // Don't fire events on initial add
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms for file writes to finish
        pollInterval: 100
      },
      usePolling: false, // Use native fs events (faster)
      disableGlobbing: true, // chokidar v3: treat path literally (matches v4); avoids glob chars in file paths
      interval: 100,
      binaryInterval: 300
    })

    const watched: WatchedFile = {
      filePath,
      watcher,
      webContentsIds: new Set([webContentsId]),
      isPaused: false,
      debounceTimer: null,
      version: this.switchVersion
    }

    // Handle file change events
    watcher.on('change', () => {
      this.handleFileChange(filePath)
    })

    // Handle file deletion
    watcher.on('unlink', () => {
      this.handleFileDeleted(filePath)
    })

    // Handle errors
    watcher.on('error', (error: unknown) => {
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
    })

    this.watchedFiles.set(filePath, watched)
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
    watched.webContentsIds.delete(webContentsId)

    this.safeLog(`👁️  Removed webContents ${webContentsId} from watch: ${filePath}`)

    // If no more webContents watching this file, stop watching entirely
    if (watched.webContentsIds.size === 0) {
      this.safeLog(`👁️  Stopping watch for: ${filePath}`)
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      await watched.watcher.close()
      this.watchedFiles.delete(filePath)
    }
  }

  /**
   * Stop watching all files for a specific webContents (cleanup on window close)
   */
  async unwatchAll(webContents: WebContents): Promise<void> {
    const webContentsId = webContents.id
    const filesToUnwatch: string[] = []

    // Find all files watched by this webContents
    for (const [filePath, watched] of this.watchedFiles.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        filesToUnwatch.push(filePath)
      }
    }

    // Unwatch each file
    for (const filePath of filesToUnwatch) {
      await this.unwatchFile(filePath, webContents)
    }

    this.safeLog(`👁️  Cleaned up watches for webContents ${webContentsId}`)
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

    const filesToCleanup: string[] = []

    // Find all files watched by this webContentsId
    for (const [filePath, watched] of this.watchedFiles.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        watched.webContentsIds.delete(webContentsId)

        // If no more watchers, schedule for full cleanup
        if (watched.webContentsIds.size === 0) {
          filesToCleanup.push(filePath)
        }
      }
    }

    // Cleanup files with no remaining watchers
    for (const filePath of filesToCleanup) {
      const watched = this.watchedFiles.get(filePath)
      if (watched) {
        if (watched.debounceTimer) {
          clearTimeout(watched.debounceTimer)
        }
        await watched.watcher.close()
        this.watchedFiles.delete(filePath)
      }
    }

    this.safeLog(`👁️  Cleaned up file watches for webContentsId ${webContentsId}`)
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
   * Handle file deletion
   */
  private handleFileDeleted(filePath: string): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return
    // Ignore late delete notices from previous sessions
    if (watched.version !== this.switchVersion) {
      return
    }

    this.safeLog(`🗑️  File deleted externally: ${filePath}`)
    this.notifyWebContents(filePath, 'file-watch:deleted', { filePath })

    // Cleanup the watch
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)
    }
    watched.watcher.close()
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

    const windows = BrowserWindow.getAllWindows()

    for (const webContentsId of watched.webContentsIds) {
      const window = windows.find(w => w.webContents.id === webContentsId)
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
   * Get statistics about watched files (for debugging)
   */
  getStats(): { totalWatched: number; fileDetails: Array<{ path: string; watchers: number }> } {
    return {
      totalWatched: this.watchedFiles.size,
      fileDetails: Array.from(this.watchedFiles.entries()).map(([path, watched]) => ({
        path,
        watchers: watched.webContentsIds.size
      }))
    }
  }

  /**
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.safeLog('👁️  Disposing all file watchers...')

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
