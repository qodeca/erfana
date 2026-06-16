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

import { existsSync } from 'fs'
import { stat } from 'fs/promises'

export type AtomicSaveCallback = (path: string, wasAtomicSave: boolean) => void

interface PendingDelete {
  path: string
  timer: NodeJS.Timeout
  callback: AtomicSaveCallback
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
    const timer = setTimeout(async () => {
      if (this.isDisposed) return

      this.pendingDeletes.delete(filePath)

      try {
        // Check if file reappeared (atomic save pattern)
        const fileExists = await this.fileExists(filePath)

        if (fileExists) {
          // File reappeared → atomic save, emit as CHANGE
          callback(filePath, true)
        } else {
          // File still gone → actual delete
          callback(filePath, false)
        }
      } catch {
        // On error, assume actual delete
        callback(filePath, false)
      }
    }, ATOMIC_SAVE_DELAY_MS)

    this.pendingDeletes.set(filePath, {
      path: filePath,
      timer,
      callback
    })
  }

  /**
   * Check if a path has a pending delete being tracked
   */
  hasPending(filePath: string): boolean {
    return this.pendingDeletes.has(filePath)
  }

  /**
   * Cancel a pending delete check (e.g., if we receive a CREATE event)
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
   * Check if file exists (async with fallback to sync)
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath)
      return true
    } catch {
      // Fallback to sync check
      return existsSync(filePath)
    }
  }
}

/**
 * Factory function for creating detector instances
 */
export function createAtomicSaveDetector(): AtomicSaveDetector {
  return new AtomicSaveDetector()
}
