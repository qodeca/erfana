// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The error and restart layer of `DirectoryWatcherService` (split out in
 * finding [65]): classifies a watcher error, tears a watch down on EMFILE,
 * restarts with exponential back-off, and tells the windows when the attempts
 * run out (#211, D15, D16).
 */
import { WebContents, webContents } from 'electron'
import { logger } from '../LoggingService'
import { RateLimitedLogger } from '../../utils/RateLimitedLogger'
import { DirectoryWatcherCore } from './DirectoryWatcherCore'
import type { DirectoryWatchHandle } from './directoryWatchBackend'
import { classifyError, errorTypeOf, isTransientError } from './watchErrorTypes'

export abstract class DirectoryWatcherRecovery extends DirectoryWatcherCore {
  // Auto-restart with exponential backoff
  protected restartAttempts: Map<string, number> = new Map()
  protected pendingRestarts: Map<string, NodeJS.Timeout> = new Map()
  protected readonly MAX_RESTART_ATTEMPTS = 3
  protected readonly RESTART_BASE_DELAY = 800

  // Rate-limited EMFILE logger (max once per 10s to prevent fd feedback loop)
  protected readonly emfileLogger = new RateLimitedLogger('emfile', 10000)

  /** Start watching a directory (the service's public entry point). */
  abstract watchDirectory(dirPath: string, webContents: WebContents): Promise<void>

  /** Stop all directory watchers (the service's public entry point). */
  abstract stopAll(): Promise<void>

  /**
   * Build the watcher, scheduling a restart when a first start cannot (#211).
   * The error is rethrown either way, so the caller still hears the start failed.
   *
   * @param session - `switchVersion` when the start began
   */
  protected createWatcherOrScheduleRestart(
    dirPath: string,
    depth: number | undefined,
    webContentsId: number,
    session: number
  ): DirectoryWatchHandle {
    try {
      return this.createBackendWatcher(dirPath, depth)
    } catch (error) {
      if (this.canRestartFailedStart(dirPath, session)) {
        // Error type only – the path stays out of the log line
        logger.info('Directory watch failed to start, restart scheduled', { errorType: errorTypeOf(error) })
        this.scheduleRestart(dirPath, new Set([webContentsId]))
      }
      throw error
    }
  }

  /**
   * Whether a failed start may schedule a restart. Not while a restart of that
   * folder is pending or running – its own failure is `restartWatcher`'s to
   * handle, under its stale-attempt guard. Not once the start's session is
   * stale or the service is disposing: `stopAll` (a project switch) and
   * `dispose` clear every restart, and one scheduled after them would outlive
   * them – that covers a restart's start overtaken by `stopAll` as well.
   */
  private canRestartFailedStart(dirPath: string, session: number): boolean {
    return (
      !this.isDisposing &&
      session === this.switchVersion &&
      !this.restartAttempts.has(dirPath) &&
      !this.pendingRestarts.has(dirPath)
    )
  }

  /**
   * Centralized error handling for watcher errors to keep the service recoverable
   */
  protected handleWatcherError(dirPath: string, errorMessage: string): void {
    // Guard against late error events from a watcher that was already closed
    if (!this.watchedDirectories.has(dirPath)) return

    // Track error in metrics
    const errorType = classifyError(errorMessage)
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
      this.coverageChanged()

      logger.info(`EMFILE detected for ${dirPath} – watcher torn down, scheduling restart`)
      this.scheduleRestart(dirPath, webContentsIds)
      return
    }

    logger.debug('Watcher error classified', { errorMessage, errorType, isTransient: isTransientError(errorType) })

    // Get webContentsIds before potentially removing the watched directory
    const watched = this.watchedDirectories.get(dirPath)
    const webContentsIds = watched ? new Set(watched.webContentsIds) : new Set<number>()

    // Check if this is a transient error that we should retry
    if (isTransientError(errorType)) {
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
   * Schedule a watcher restart with exponential backoff
   */
  protected scheduleRestart(dirPath: string, webContentsIds: Set<number>): void {
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
  protected async restartWatcher(dirPath: string, webContentsIds: Set<number>): Promise<void> {
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
        this.coverageChanged()
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
      // Nothing else listens for the notice: catch up on changes made while
      // no watcher was running
      this.sendCompensatingRefresh(dirPath)

    } catch (error) {
      logger.error(`Watcher restart failed for ${dirPath}`, error instanceof Error ? error : undefined)
      this.metrics.recordRestartFailure()

      // stopAll (a project switch) or dispose cleared the attempts meanwhile:
      // this restart is stale, and a notice sent by id (D16) would reach the
      // windows of whatever project is open now
      if (this.restartAttempts.get(dirPath) !== attempts) return

      if (attempts < this.MAX_RESTART_ATTEMPTS) {
        // Schedule another attempt
        this.scheduleRestart(dirPath, webContentsIds)
      } else {
        this.reportRestartExhausted(dirPath, webContentsIds, error)
      }
    }
  }

  /**
   * Max attempts reached – tell the windows that were watching (#211, D15,
   * D16). The map entry is already gone, so the notice goes to the captured
   * ids. A root that is still missing (`ENOENT`, as the native backend throws
   * at once) means the project was deleted; anything else is a failed restart.
   */
  private reportRestartExhausted(dirPath: string, webContentsIds: ReadonlySet<number>, error: unknown): void {
    logger.warn(`Max restart attempts (${this.MAX_RESTART_ATTEMPTS}) reached for ${dirPath}`)
    this.restartAttempts.delete(dirPath)
    if (errorTypeOf(error) === 'ENOENT') {
      this.notifyIds(webContentsIds, 'directory-watch:project-deleted', { dirPath })
      return
    }
    this.notifyIds(webContentsIds, 'directory-watch:restart-failed', {
      dirPath,
      attempts: this.MAX_RESTART_ATTEMPTS,
      message: 'File watcher could not recover. Please reload the project.'
    })
  }

  /**
   * Get webContents by ID
   */
  private getWebContentsById(id: number): WebContents | undefined {
    return webContents.getAllWebContents().find((wc) => wc.id === id)
  }
}
