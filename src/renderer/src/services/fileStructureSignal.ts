// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "A file or folder may have appeared, disappeared or moved", raised by the
 * renderer's own file operations.
 *
 * The directory watcher is paused while the project tree creates, renames,
 * moves or deletes something, and the main process subtracts those internal
 * changes from what it reports on resume (#210) – so the renderer's own
 * operations never arrive as `directory-watch:changed`. `fileGateway` raises
 * this signal after each such operation instead, for caches that must not
 * outlive the file structure (the preview's link checks).
 *
 * @module services/fileStructureSignal
 */

const listeners = new Set<() => void>()

/** Tell every listener the file structure may have changed. A throwing listener does not stop the rest. */
export function notifyFileStructureChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A listener's failure is its own; the others still hear about the change
    }
  }
}

/**
 * Listen for structural changes made by this window.
 *
 * @returns The function that stops listening
 */
export function onFileStructureChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
