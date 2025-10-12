import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, WebContents } from 'electron'
import { stat } from 'fs/promises'

interface WatchedFile {
  filePath: string
  watcher: FSWatcher
  webContentsIds: Set<number>
  isPaused: boolean
  debounceTimer: NodeJS.Timeout | null
}

export class FileWatcherService {
  private watchedFiles: Map<string, WatchedFile> = new Map()
  private readonly DEBOUNCE_DELAY = 300 // ms
  private readonly MAX_WATCHED_FILES = 100
  private projectPath: string | null = null

  setProjectPath(path: string): void {
    this.projectPath = path
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
    } catch (error) {
      throw new Error(`File does not exist: ${filePath}`)
    }

    const webContentsId = webContents.id

    // If already watching, just add this webContents
    if (this.watchedFiles.has(filePath)) {
      const watched = this.watchedFiles.get(filePath)!
      watched.webContentsIds.add(webContentsId)
      console.log(`👁️  Added webContents ${webContentsId} to watch: ${filePath}`)
      return
    }

    console.log(`👁️  Starting watch for: ${filePath}`)

    // Create new watcher
    const watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true, // Don't fire events on initial add
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms for file writes to finish
        pollInterval: 100
      },
      usePolling: false, // Use native fs events (faster)
      interval: 100,
      binaryInterval: 300
    })

    const watched: WatchedFile = {
      filePath,
      watcher,
      webContentsIds: new Set([webContentsId]),
      isPaused: false,
      debounceTimer: null
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
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`File watcher error for ${filePath}:`, error)
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

    console.log(`👁️  Removed webContents ${webContentsId} from watch: ${filePath}`)

    // If no more webContents watching this file, stop watching entirely
    if (watched.webContentsIds.size === 0) {
      console.log(`👁️  Stopping watch for: ${filePath}`)
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

    console.log(`👁️  Cleaned up watches for webContents ${webContentsId}`)
  }

  /**
   * Pause watching a file (during save operations to prevent race conditions)
   */
  pauseWatch(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (watched) {
      watched.isPaused = true
      console.log(`⏸️  Paused watch for: ${filePath}`)
    }
  }

  /**
   * Resume watching a file after save completes
   */
  resumeWatch(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (watched) {
      watched.isPaused = false
      console.log(`▶️  Resumed watch for: ${filePath}`)
    }
  }

  /**
   * Handle file change events with debouncing
   */
  private handleFileChange(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return

    // Ignore if paused (during our own save)
    if (watched.isPaused) {
      console.log(`⏸️  Ignoring change (paused): ${filePath}`)
      return
    }

    // Clear existing debounce timer
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)
    }

    // Debounce: wait for file changes to settle
    watched.debounceTimer = setTimeout(() => {
      console.log(`📝 File changed externally: ${filePath}`)
      this.notifyWebContents(filePath, 'file-watch:changed', { filePath })
      watched.debounceTimer = null
    }, this.DEBOUNCE_DELAY)
  }

  /**
   * Handle file deletion
   */
  private handleFileDeleted(filePath: string): void {
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return

    console.log(`🗑️  File deleted externally: ${filePath}`)
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
  private notifyWebContents(filePath: string, channel: string, data: any): void {
    const watched = this.watchedFiles.get(filePath)
    if (!watched) return

    const windows = BrowserWindow.getAllWindows()

    for (const webContentsId of watched.webContentsIds) {
      const window = windows.find(w => w.webContents.id === webContentsId)
      if (window && !window.isDestroyed()) {
        window.webContents.send(channel, data)
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
    console.log('👁️  Disposing all file watchers...')
    for (const [, watched] of this.watchedFiles.entries()) {
      if (watched.debounceTimer) {
        clearTimeout(watched.debounceTimer)
      }
      await watched.watcher.close()
    }
    this.watchedFiles.clear()
  }
}

// Singleton instance
export const fileWatcherService = new FileWatcherService()
