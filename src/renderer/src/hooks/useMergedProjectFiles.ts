// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useMemo } from 'react'
import type { FileNode } from '../../../shared/ipc/file-schema'
import { useLazyFolderStore } from '../stores/useLazyFolderStore'
import { hasUnloadedCapped, mergeLazyChildren } from '../utils/lazyTree'

/**
 * The project's files with the lazy folders read so far filled in, for any
 * consumer outside the tree (the terminal's file links).
 *
 * @returns `files` merged, and `truncated` when a walk bound left some folder
 *   unread – a lookup by name must then not take a single match as certain
 */
export function useMergedProjectFiles(files: FileNode[]): { files: FileNode[]; truncated: boolean } {
  const loaded = useLazyFolderStore((state) => state.loaded)
  return useMemo(() => {
    const merged = mergeLazyChildren(files, loaded)
    return { files: merged, truncated: hasUnloadedCapped(merged, loaded) }
  }, [files, loaded])
}
