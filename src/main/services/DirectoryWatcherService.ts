// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { WebContents } from 'electron'
import { dirname, normalize, sep } from 'path'
import { settingsService } from './SettingsService'
import { PauseController } from '../utils/PauseController'
import {
  WatcherMetrics,
  AtomicSaveDetector,
  ThrottledWorker,
  getPlatformDiagnostics,
  type FileChangeEvent
} from './watcher'
import { DirectoryWatcherEvents } from './watcher/DirectoryWatcherEvents'
import type {
  DirectoryWatcherServiceOptions,
  PathsRemovedListener,
  RemovalsLostListener,
  WatchedDirectory
} from './watcher/directoryWatchTypes'
import { PAUSE_CONTROLLER } from '../../shared/constants'
import { isSystemDirectory } from '../utils/pathSecurity'
import { toRootRelative, type ProjectPathFilter } from '../utils/projectPathFilter'
import { AppError, ErrorCode } from '../../shared/errors'

// The service is layered (finding [65]): watcher/DirectoryWatcherCore (shared
// state, path rules, notices) ← DirectoryWatcherRecovery (errors, restarts) ←
// DirectoryWatcherEvents (event pipeline, pauses) ← this class (the public
// lifecycle). The shapes and batch rules live in watcher/directoryWatchTypes.
export {
  isStructuralBatch,
  isStructuralRawBatch,
  type DirectoryWatcherServiceOptions,
  type PathsRemovedListener,
  type RemovalsLostListener
} from './watcher/directoryWatchTypes'

export class DirectoryWatcherService extends DirectoryWatcherEvents {
  constructor(options: DirectoryWatcherServiceOptions = {}) {
    super(options)
  }

  /**
   * Set the project's path filter (called by ProjectService after loading
   * settings). It applies to watches started after the call and to every
   * event queued after it; its own `root` is not read – paths are measured
   * against this service's project root (design D4).
   */
  setPathFilter(filter: ProjectPathFilter): void {
    this.pathFilter = filter
    this.coverageChanged()
  }

  /**
   * Hear about the paths a delivered batch removed (`unlink` / `unlinkDir`,
   * absolute, after coalescing). A single-file chokidar watch cannot see its
   * parent folder being renamed away – nothing touches the file itself – so
   * `FileWatcherService` listens here to mark such an open file deleted.
   * A removal an outside program made while the watch was paused for one of
   * the app's own operations is reported when the pause ends. The operation's
   * own removals are left out when it noted them (`noteInternalChange`); past
   * the internal-change cap, or after a resync, they cannot be told apart, and
   * the open files are checked on disk instead (`onRemovalsLost`, #252).
   *
   * @returns a function that removes the listener
   */
  onPathsRemoved(listener: PathsRemovedListener): () => void {
    return this.listeners.onPathsRemoved(listener)
  }

  /**
   * Hear about removals a paused watch lost without a path (#252), so the
   * open files under that folder can be re-checked on disk instead.
   *
   * @returns a function that removes the listener
   */
  onRemovalsLost(listener: RemovalsLostListener): () => void {
    return this.listeners.onRemovalsLost(listener)
  }

  /**
   * Hear when {@link reportsRemovalsAbove} may answer differently: a watch
   * started or stopped, the path filter or the project changed (#252).
   *
   * @returns a function that removes the listener
   */
  onCoverageChanged(listener: () => void): () => void {
    return this.listeners.onCoverageChanged(listener)
  }

  /**
   * Whether a removal of any folder between a watch root and this file would
   * reach {@link onPathsRemoved}: the file sits under a watch of the current
   * session, and its folder is neither dropped by the path filter (excluded,
   * hidden, ignored) nor deeper than the watch's depth cap. The drop test is
   * inherited by every path below a dropped folder, so testing the file's own
   * folder covers all of its ancestors. `FileWatcherService` re-checks the
   * files this says no to on its own (#252).
   */
  reportsRemovalsAbove(filePath: string): boolean {
    if (this.isDisposing) return false
    const folder = dirname(filePath)
    for (const watched of this.watchedDirectories.values()) {
      if (watched.version !== this.switchVersion) continue
      const watchRel = toRootRelative(watched.dirPath, folder)
      if (watchRel === null) continue
      if (watchRel === '') return true
      const watchPrefix = toRootRelative(this.projectPath || watched.dirPath, watched.dirPath)
      if (!this.shouldDropWatchRel(watchPrefix, watchRel, watched.depth)) return true
    }
    return false
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    this.knownEntries.reset()
    // Bump session on project changes to drop stale events
    this.switchVersion++
    this.coverageChanged()
  }
  /**
   * Stop all directory watchers (for project switching)
   */
  async stopAll(): Promise<void> {
    // Bump the session FIRST (as cleanupForWebContentsId does): a late event, or
    // a first start still in flight that fails during the closes below, then
    // sees it is stale and cannot schedule a restart that outlives this call
    this.switchVersion++
    this.safeLog('👁️  Stopping all directory watchers...')
    this.healthLogger.stop()
    this.emfileLogger.reset()
    this.resyncLogger.reset()

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
    this.coverageChanged()
  }

  /**
   * Start watching a directory for structural changes
   *
   * Security: Uses normalized path comparison and checks for system directories
   * (Issue #74 review fix - aligned with validateProjectPath pattern)
   *
   * When the watcher cannot be built (the native backend throws at once for a
   * root it cannot watch), a restart is scheduled and the error is rethrown
   * (#211): a root that was briefly unavailable recovers, and a deleted one
   * ends in `directory-watch:project-deleted` once the attempts run out.
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
    this.logBackendOnce()
    // Taken before the await below, which a stopAll can overtake
    const session = this.switchVersion

    // Read depth setting (undefined => watch all levels)
    let depth: number | undefined
    try {
      depth = await settingsService.getDirectoryWatchDepth()
    } catch {
      depth = undefined
    }
    // A stopAll (project switch) overtook this start: its watcher would be
    // registered under the new session, for the old project
    if (session !== this.switchVersion) return

    // Built before anything else: the native backend throws at once when the
    // root cannot be watched (ENOENT, D15), and then nothing is left behind.
    // Resolves without waiting for the backend's `ready` (AC5).
    const watcher = this.createWatcherOrScheduleRestart(dirPath, depth, webContentsId, session)

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
          // The dropped events may have been structural
          const entry = this.watchedDirectories.get(dirPath)
          if (entry) entry.forceStructural = true
          this.safeLog(`⚠️  Buffer overflow: dropped ${count} oldest events for ${dirPath}`)
        }
      }
    )

    const watched: WatchedDirectory = {
      dirPath,
      watcher,
      backend: this.watchBackend,
      webContentsIds: new Set([webContentsId]),
      pauseController: new PauseController({
        timeoutMs: PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS,
        onTimeout: () => this.handlePauseTimeout(dirPath)
      }),
      throttledWorker,
      atomicSaveDetector: new AtomicSaveDetector(),
      version: this.switchVersion,
      depth
    }

    this.attachWatcherListeners(dirPath, watcher)

    this.watchedDirectories.set(dirPath, watched)
    this.metrics.setActiveWatchers(this.watchedDirectories.size)
    this.coverageChanged()

    // Start health logger on first watch
    this.healthLogger.start()
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
      this.coverageChanged()
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
    this.coverageChanged()
    this.safeLog(`👁️  Cleaned up directory watches for webContentsId ${webContentsId}`)
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
    this.healthLogger.stop()
    this.emfileLogger.reset()
    this.resyncLogger.reset()
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
}

// Singleton instance
export const directoryWatcherService = new DirectoryWatcherService()
