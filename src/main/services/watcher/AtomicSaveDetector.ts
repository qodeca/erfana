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
 *
 * With `lookAtOnce` (the watch layer's detector, #478 plan decision 26) the
 * file is looked for at once first: an atomic save whose rename already landed
 * is reported without waiting, and the window is only waited when the file is
 * not there yet.
 */

import { isPresentAfterSettle, probePath } from './pathPresence'

export type AtomicSaveCallback = (path: string, wasAtomicSave: boolean) => void

interface PendingDelete {
  path: string
  /** `null` while the at-once look runs. */
  timer: NodeJS.Timeout | null
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

/** How a detector decides. */
export interface AtomicSaveDetectorOptions {
  /** Look for the file at once before waiting the window (decision 26). */
  lookAtOnce?: boolean
}

export class AtomicSaveDetector {
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private isDisposed = false
  private readonly lookAtOnce: boolean

  constructor(options: AtomicSaveDetectorOptions = {}) {
    this.lookAtOnce = options.lookAtOnce ?? false
  }

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

    const pending: PendingDelete = { path: filePath, timer: null, callback, token: Symbol(filePath) }
    this.pendingDeletes.set(filePath, pending)
    if (this.lookAtOnce) {
      void this.lookNow(pending)
    } else {
      this.startWindow(pending)
    }
  }

  /** Schedule the check after the window. */
  private startWindow(pending: PendingDelete): void {
    pending.timer = setTimeout(() => {
      void this.settle(pending.path, pending.token, pending.callback)
    }, ATOMIC_SAVE_DELAY_MS)
  }

  /**
   * The at-once look: a file that is there now is an atomic save, reported
   * without waiting. Anything else – gone, or unreadable, which on Windows may
   * be a delete pending – waits the window and its settled check.
   */
  private async lookNow(pending: PendingDelete): Promise<void> {
    const presence = await probePath(pending.path)
    if (!this.isCurrent(pending.path, pending.token)) return
    if (presence === 'present') {
      this.pendingDeletes.delete(pending.path)
      pending.callback(pending.path, true)
      return
    }
    this.startWindow(pending)
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
      if (pending.timer) clearTimeout(pending.timer)
      this.pendingDeletes.delete(filePath)
    }
  }

  /**
   * Cancel all pending checks
   */
  cancelAll(): void {
    for (const [, pending] of this.pendingDeletes) {
      if (pending.timer) clearTimeout(pending.timer)
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
 * The watch layer's detector: it looks for the file at once (decision 26).
 */
export function createAtomicSaveDetector(): AtomicSaveDetector {
  return new AtomicSaveDetector({ lookAtOnce: true })
}
