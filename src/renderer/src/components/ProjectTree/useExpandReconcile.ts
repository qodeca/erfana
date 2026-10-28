// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Expanding a folder checks it against the disk (design #211, risk R4).
 *
 * The tree shows a folder's children from the last full tree read, so
 * collapsing and expanding it again serves that same listing. When the watcher
 * missed a change – a file made in the moment before the folder's watch opened,
 * or a drive whose watch reports nothing – the user's only recovery was the
 * Refresh button. Now the folder a user opens is listed once more, one shallow
 * `file:readDirectory` of that folder (one level, a few milliseconds), and only
 * when the disk differs from what the tree shows – names and kinds – is the
 * whole tree refreshed (`onStale`, single-flight per #208). Matching listings,
 * the usual case, cost that one listing and nothing else.
 *
 * Bounds, so it stays that cheap:
 * - only when exactly one folder opens (a click, a key, a drag hover) – a
 *   reveal or a bulk expansion reads nothing;
 * - not the root row (Refresh sits beside it), not a lazy folder (read on
 *   expand anyway, `useLazyFolderChildren`), not a folder the base tree does
 *   not hold (inside a lazy folder);
 * - one read per folder at a time; the result is compared with the tree shown
 *   when it lands, and dropped once the project changed.
 * A failed read logs its error name only and changes nothing.
 */
import { useEffect, useRef } from 'react'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { fileGateway, isProjectChanged } from '../../services/fileGateway'
import { logger } from '../../utils/logger'
import { isStrictDescendant } from '../../utils/fileUtils'
import { useLatestRef } from '../../hooks/useLatestRef'

/** The folders in `next` that are not in `previous`. */
export function newlyExpanded(previous: ReadonlySet<string>, next: ReadonlySet<string>): string[] {
  const opened: string[] = []
  for (const path of next) if (!previous.has(path)) opened.push(path)
  return opened
}

/**
 * The folder row at `folderPath` in a tree, or `null`. Descends only through
 * the folder's ancestors, so it never walks the whole tree.
 */
export function findFolder(nodes: readonly FileNode[], folderPath: string): FileNode | null {
  let level = nodes
  for (;;) {
    const next = level.find(
      (node) => node.type === 'directory' && (node.path === folderPath || isStrictDescendant(node.path, folderPath))
    )
    if (!next) return null
    if (next.path === folderPath) return next
    if (!next.children) return null
    level = next.children
  }
}

/** The children a folder row shows from the base tree; `null` when it has no listing of its own. */
function shownChildren(folder: FileNode | null): FileNode[] | null {
  if (!folder || folder.lazy !== undefined || !folder.children) return null
  return folder.children
}

const entryKey = (node: FileNode): string => `${node.type}\0${node.name}`

/** Whether a folder's listing on disk differs from the one the tree shows (names and kinds). */
export function listingDiffers(shown: readonly FileNode[], onDisk: readonly FileNode[]): boolean {
  if (shown.length !== onDisk.length) return true
  const keys = new Set(shown.map(entryKey))
  return onDisk.some((node) => !keys.has(entryKey(node)))
}

/**
 * @param files - The base tree from the project context (not the merged one)
 * @param expandedFolders - The panel's expanded folder paths
 * @param rootPath - The project root row's path
 * @param onStale - Refresh the whole tree; without it nothing is read
 */
export function useExpandReconcile(
  files: FileNode[],
  expandedFolders: ReadonlySet<string>,
  rootPath: string | null | undefined,
  onStale: (() => void) | undefined
): void {
  const previous = useRef<ReadonlySet<string> | null>(null)
  const inFlight = useRef(new Set<string>())
  // Read in the effect and in the read's callbacks only (useLatestRef's rule)
  const latest = useLatestRef({ files, rootPath, onStale })

  useEffect(() => {
    const before = previous.current
    previous.current = expandedFolders
    const { files: base, rootPath: project, onStale: refresh } = latest.current
    if (before === null || !refresh) return
    const opened = newlyExpanded(before, expandedFolders)
    if (opened.length !== 1) return
    const [folderPath] = opened
    if (folderPath === project || inFlight.current.has(folderPath)) return
    if (shownChildren(findFolder(base, folderPath)) === null) return

    inFlight.current.add(folderPath)
    fileGateway
      .readDirectory({ dirPath: folderPath, shallow: true })
      .then((onDisk) => {
        const now = latest.current
        if (now.rootPath !== project) return
        // Against what the tree shows now: a refresh may have landed meanwhile
        const shown = shownChildren(findFolder(now.files, folderPath))
        if (shown === null || !listingDiffers(shown, onDisk)) return
        // Counts only – the names can identify the user's files
        logger.info('[ProjectTree] An expanded folder differs from the disk – refreshing the tree', {
          shown: shown.length,
          onDisk: onDisk.length
        })
        now.onStale?.()
      })
      .catch((error: unknown) => {
        if (isProjectChanged(error)) return
        logger.warn('[ProjectTree] Expand check read failed', {
          error: error instanceof Error ? error.name : typeof error
        })
      })
      .finally(() => {
        inFlight.current.delete(folderPath)
      })
  }, [expandedFolders, latest])
}
