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
import { isChildPath } from './EventCoalescer'

/** The watched paths that are strict descendants of any removed path. */
export function watchedUnderRemovedFolders(
  watchedPaths: Iterable<string>,
  removedPaths: readonly string[]
): string[] {
  const affected: string[] = []
  for (const watched of watchedPaths) {
    if (removedPaths.some((removed) => isChildPath(watched, removed))) affected.push(watched)
  }
  return affected
}
