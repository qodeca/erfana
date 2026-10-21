// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ancestorRemoval - which watched files sat under a folder that was removed.
 *
 * A single-file chokidar watch watches the file's parent folder, and a renamed
 * (or moved) parent emits nothing about its children, so an open file can
 * vanish without its own watcher hearing anything. `FileWatcherService` is fed
 * the project watcher's removals and asks this module which of its watches
 * they cover. A removal of the file itself is not a match: that unlink is the
 * file's own watcher's job, and treating it again would re-arm healthy watches
 * on every atomic save. Comparison is case-insensitive on macOS and Windows.
 */
import { dirname } from 'path'
import { normalizePath } from './EventCoalescer'

/**
 * The watched paths that are strict descendants of any removed path.
 *
 * The removed paths are normalised once into a set; each watched path then
 * walks its own ancestors (`dirname` until the root) and looks each one up, so
 * the cost is watched × depth, not watched × removed string comparisons.
 */
export function watchedUnderRemovedFolders(
  watchedPaths: Iterable<string>,
  removedPaths: readonly string[]
): string[] {
  if (removedPaths.length === 0) return []
  const removed = new Set(removedPaths.map(normalizePath))
  const affected: string[] = []
  for (const watched of watchedPaths) {
    let current = normalizePath(watched)
    for (let up = dirname(current); up !== current; current = up, up = dirname(current)) {
      if (removed.has(up)) {
        affected.push(watched)
        break
      }
    }
  }
  return affected
}
