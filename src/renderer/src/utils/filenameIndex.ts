// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Filename Index
 *
 * In-memory Map-based index for O(1) filename lookups.
 * Maps lowercase filenames to arrays of full paths.
 *
 * Used by smart file path resolution to find candidate files
 * when only a filename is provided (e.g., "Button.tsx:42").
 *
 * Memory estimate: ~1MB for 10,000 files
 * Build time target: <50ms for 10,000 files
 */

import type { FileNode } from '../../../preload/index'

/**
 * Interface for the filename index
 */
export interface FilenameIndex {
  /** Get all paths matching a filename (case-insensitive). O(1) lookup. */
  get(filename: string): string[] | undefined

  /** Rebuild the index from a file tree */
  rebuild(files: FileNode[]): void

  /** Clear all entries */
  clear(): void

  /** Whether the index has been built at least once */
  readonly isBuilt: boolean

  /** Number of unique filenames indexed */
  readonly size: number

  /** Total number of file paths indexed */
  readonly totalPaths: number
}

/**
 * Extract filename from a path (cross-platform)
 *
 * @param path Full file path
 * @returns Filename portion only
 */
export function extractFilename(path: string): string {
  // Handle both POSIX and Windows separators
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return lastSep >= 0 ? path.slice(lastSep + 1) : path
}

/**
 * Recursively collect all file paths from a FileNode tree
 *
 * @param nodes Array of FileNode (tree structure)
 * @returns Flat array of all file paths (directories excluded)
 */
export function collectFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = []

  function traverse(nodeList: FileNode[]): void {
    for (const node of nodeList) {
      if (node.type === 'file') {
        paths.push(node.path)
      } else if (node.type === 'directory' && node.children) {
        traverse(node.children)
      }
    }
  }

  traverse(nodes)
  return paths
}

/**
 * Build a filename-to-paths map from an array of file paths
 *
 * @param paths Array of full file paths
 * @returns Map of lowercase filename to array of full paths
 */
export function buildFilenameMap(paths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()

  for (const path of paths) {
    const filename = extractFilename(path).toLowerCase()
    const existing = map.get(filename)
    if (existing) {
      existing.push(path)
    } else {
      map.set(filename, [path])
    }
  }

  return map
}

/**
 * Create a filename index instance
 *
 * Factory function for creating a FilenameIndex.
 * The index is lazy - call rebuild() to populate it.
 *
 * @returns FilenameIndex instance
 *
 * @example
 * ```ts
 * const index = createFilenameIndex()
 * index.rebuild(projectFiles)
 * const candidates = index.get('Button.tsx') // ['/project/src/Button.tsx', ...]
 * ```
 */
export function createFilenameIndex(): FilenameIndex {
  let map = new Map<string, string[]>()
  let built = false
  let pathCount = 0

  return {
    get(filename: string): string[] | undefined {
      const key = filename.toLowerCase()
      return map.get(key)
    },

    rebuild(files: FileNode[]): void {
      const paths = collectFilePaths(files)
      map = buildFilenameMap(paths)
      pathCount = paths.length
      built = true
    },

    clear(): void {
      map.clear()
      pathCount = 0
      built = false
    },

    get isBuilt(): boolean {
      return built
    },

    get size(): number {
      return map.size
    },

    get totalPaths(): number {
      return pathCount
    }
  }
}
