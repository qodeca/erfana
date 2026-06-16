// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useFilenameIndex Hook
 *
 * React hook for managing the filename index used in smart file path resolution.
 * Provides lazy initialization - the index is only built when first accessed.
 *
 * Features:
 * - Lazy build: Index built on first access, not on mount
 * - Auto-rebuild: Rebuilds when project files change
 * - Memoized: Prevents unnecessary rebuilds
 */

import { useRef, useCallback, useMemo } from 'react'
import type { FileNode } from '../../../preload/index'
import { createFilenameIndex, type FilenameIndex } from '../utils/filenameIndex'

export interface UseFilenameIndexOptions {
  /** Project file tree */
  files: FileNode[]
}

export interface UseFilenameIndexReturn {
  /** Get the filename index (builds lazily if needed) */
  getIndex: () => FilenameIndex

  /** Force rebuild the index */
  rebuild: () => void

  /** Whether the index has been built */
  isBuilt: boolean
}

/**
 * Hook for managing filename index with lazy initialization
 *
 * @param options Configuration with project files
 * @returns Object with getIndex function, rebuild function, and isBuilt status
 *
 * @example
 * ```tsx
 * const { files } = useProjectManagementContext()
 * const { getIndex, isBuilt } = useFilenameIndex({ files })
 *
 * // Later, when smart resolution is needed:
 * const index = getIndex()
 * const candidates = index.get('Button.tsx')
 * ```
 */
export function useFilenameIndex(options: UseFilenameIndexOptions): UseFilenameIndexReturn {
  const { files } = options

  // Store the index in a ref to maintain instance across renders
  const indexRef = useRef<FilenameIndex | null>(null)

  // Track the files array reference to detect changes
  const filesRef = useRef<FileNode[]>(files)

  // Memoize the index instance creation
  const getOrCreateIndex = useMemo(() => {
    if (!indexRef.current) {
      indexRef.current = createFilenameIndex()
    }
    return indexRef.current
  }, [])

  /**
   * Get the index, building it lazily if needed.
   * Also rebuilds if files have changed since last build.
   */
  const getIndex = useCallback((): FilenameIndex => {
    const index = getOrCreateIndex

    // Check if files changed
    const filesChanged = files !== filesRef.current

    // Build or rebuild if needed
    if (!index.isBuilt || filesChanged) {
      index.rebuild(files)
      filesRef.current = files
    }

    return index
  }, [files, getOrCreateIndex])

  /**
   * Force rebuild the index
   */
  const rebuild = useCallback(() => {
    const index = getOrCreateIndex
    index.rebuild(files)
    filesRef.current = files
  }, [files, getOrCreateIndex])

  return {
    getIndex,
    rebuild,
    isBuilt: indexRef.current?.isBuilt ?? false
  }
}
