// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AtomicSaveDetector - Detects atomic save operations (VS Code pattern)
 *
 * Based on VS Code's nodejsWatcherLib.ts:388-415 implementation.
 *
 * Many editors use "atomic save" (write-to-temp-then-rename) pattern:
 * 1. Write content to temp file (.file.tmp)
 * 2. Delete original file
 * 3. Rename temp to original
 *
 * Without detection, this appears as DELETE + CREATE, not UPDATE.
 *
 * Solution: Wait 100ms after DELETE. If file reappears, emit CHANGE instead.
 */

import { isPresentAfterSettle } from './pathPresence'

export type AtomicSaveCallback = (path: string, wasAtomicSave: boolean) => void

interface PendingDelete {
  path: string
  timer: NodeJS.Timeout
  callback: AtomicSaveCallback
  /**
   * This registration's identity. The entry stays in the map until its
   * callback runs, so a cancel, a newer delete or `dispose()` also reaches a
   * check that is already waiting on the disk (#252 review).
   */
  token: symbol
}

// VS Code uses 100ms delay for atomic save detection
const ATOMIC_SAVE_DELAY_MS = 100

export class AtomicSaveDetector {
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private isDisposed = false

  /**
   * Register a delete event for atomic save detection
   *
   * @param filePath - Path of the deleted file
   * @param callback - Called with (path, wasAtomicSave)
   *                   wasAtomicSave=true means file reappeared (emit CHANGE)
   *                   wasAtomicSave=false means actual delete (emit DELETE)
   */
  registerDelete(filePath: string, callback: AtomicSaveCallback): void {
    if (this.isDisposed) return

    // Cancel any existing pending delete for this path
    this.cancelPending(filePath)

    // Schedule check after delay
    const token = Symbol(filePath)
    const timer = setTimeout(() => {
      void this.settle(filePath, token, callback)
    }, ATOMIC_SAVE_DELAY_MS)

    this.pendingDeletes.set(filePath, {
      path: filePath,
      timer,
      callback,
      token
    })
  }

  /**
   * Check if a path has a pending delete being tracked, including one whose
   * existence check is still running
   */
  hasPending(filePath: string): boolean {
    return this.pendingDeletes.has(filePath)
  }

  /**
   * Check whether the file reappeared and report it, unless the registration
   * was cancelled, replaced or disposed while the disk was asked: the check
   * can wait for a second look (`isPresentAfterSettle`), and a stale verdict
   * would re-arm or delete a watch that is no longer the one it was about.
   */
  private async settle(filePath: string, token: symbol, callback: AtomicSaveCallback): Promise<void> {
    if (!this.isCurrent(filePath, token)) return

    let fileExists = false
    try {
      // Check if file reappeared (atomic save pattern)
      fileExists = await this.fileExists(filePath)
    } catch {
      // On error, assume actual delete
    }

    if (!this.isCurrent(filePath, token)) return
    this.pendingDeletes.delete(filePath)
    // true: the file reappeared → atomic save, emit as CHANGE; false → actual delete
    callback(filePath, fileExists)
  }

  /** Is this registration still the live one for the path? */
  private isCurrent(filePath: string, token: symbol): boolean {
    return !this.isDisposed && this.pendingDeletes.get(filePath)?.token === token
  }

  /**
   * Cancel a pending delete check (e.g., if we receive a CREATE event). A check
   * already waiting on the disk then reports nothing.
   */
  cancelPending(filePath: string): void {
    const pending = this.pendingDeletes.get(filePath)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingDeletes.delete(filePath)
    }
  }

  /**
   * Cancel all pending checks
   */
  cancelAll(): void {
    for (const [, pending] of this.pendingDeletes) {
      clearTimeout(pending.timer)
    }
    this.pendingDeletes.clear()
  }

  /**
   * Get count of pending delete checks
   */
  getPendingCount(): number {
    return this.pendingDeletes.size
  }

  /**
   * Dispose and cancel all pending operations
   */
  dispose(): void {
    this.isDisposed = true
    this.cancelAll()
  }

  /**
   * Check if file exists. An unreadable file counts as there, so it comes back
   * as an atomic save – except on Windows, where EPERM or EBUSY is asked about
   * once more after a short wait (`isPresentAfterSettle`), and a file that
   * still answers that way is being deleted under another process's open
   * handle, so it counts as deleted.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    return isPresentAfterSettle(filePath)
  }
}

/**
 * Factory function for creating detector instances
 */
export function createAtomicSaveDetector(): AtomicSaveDetector {
  return new AtomicSaveDetector()
}
