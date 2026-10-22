// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Children of lazy folders (review finding 32).
 *
 * The tree walk leaves an ignored folder (`watcher.ignoreList`, e.g. `dist`,
 * `.venv`) and every folder past its entry cap unread: the row arrives with
 * `lazy: 'ignored' | 'capped'` and no children. This hook reads such a folder
 * when it is expanded – one shallow `file:readDirectory` of that folder, which
 * lists one level and leaves its sub-folders lazy in turn – and keeps the
 * result in `useLazyFolderStore`, where every consumer of the project's files
 * finds it (`useMergedProjectFiles`).
 *
 * Loaded children outlive a collapse. A new base tree (a refresh, a watcher
 * event) makes every loaded folder stale: each one is read again when it is
 * next expanded – at once, if it is expanded now – and its old children stay
 * on screen until the new ones arrive. A folder that was read in the old tree
 * and is lazy in the new one (the cap moved) keeps the children it showed,
 * also stale. Entries for paths no longer lazy in the tree are dropped.
 *
 * These one-level reads are not fed to `recordTreeReadMs`: that average spaces
 * out forced refreshes by what a whole-tree read costs, and a one-folder read
 * of a few milliseconds would make a slow project look fast.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { fileGateway, isProjectChanged } from '../../services/fileGateway'
import { logger } from '../../utils/logger'
import { useLazyFolderStore, type LoadedChildren } from '../../stores/useLazyFolderStore'
import { collectLazyPaths, mergeLazyChildren } from '../../utils/lazyTree'

/** Every folder of a tree that shows children, by path. */
function foldersWithChildren(nodes: FileNode[], into: Map<string, FileNode[]> = new Map()): Map<string, FileNode[]> {
  for (const node of nodes) {
    if (node.type !== 'directory' || !node.children || node.children.length === 0) continue
    into.set(node.path, node.children)
    foldersWithChildren(node.children, into)
  }
  return into
}

/**
 * The loaded map for a new base tree: a folder that is lazy now but showed
 * children in the previous merged tree keeps them (stale, `baseTree: null`),
 * and entries whose path is no longer a lazy folder of the tree are dropped.
 * Returns `loaded` itself when nothing changes.
 */
export function reconcileLazyState(
  files: FileNode[],
  loaded: ReadonlyMap<string, LoadedChildren>,
  previousTree: FileNode[]
): ReadonlyMap<string, LoadedChildren> {
  let next: Map<string, LoadedChildren> | null = null
  const lazyNow = collectLazyPaths(mergeLazyChildren(files, loaded))
  const unseeded = [...lazyNow].filter((path) => !loaded.has(path))
  if (unseeded.length > 0 && previousTree.length > 0) {
    const shown = foldersWithChildren(previousTree)
    for (const path of unseeded) {
      const children = shown.get(path)
      if (!children) continue
      next ??= new Map(loaded)
      next.set(path, { children, baseTree: null })
    }
  }
  const current = next ?? loaded
  const keep = next === null ? lazyNow : collectLazyPaths(mergeLazyChildren(files, current))
  for (const path of current.keys()) {
    if (keep.has(path)) continue
    next ??= new Map(loaded)
    next.delete(path)
  }
  return next ?? loaded
}

/**
 * @param files - The base tree from the project context
 * @param expandedFolders - The panel's expanded folder paths
 * @returns The tree to render, with the loaded lazy folders filled in
 */
export function useLazyFolderChildren(files: FileNode[], expandedFolders: ReadonlySet<string>): FileNode[] {
  const loaded = useLazyFolderStore((state) => state.loaded)
  const inFlight = useRef(new Set<string>())
  const previousTree = useRef<FileNode[]>([])

  const tree = useMemo(() => mergeLazyChildren(files, loaded), [files, loaded])
  const lazyPaths = useMemo(() => collectLazyPaths(tree), [tree])

  // A new base tree: carry children over to folders that turned lazy and drop
  // entries that left the tree – before paint, so a row never flashes empty
  useLayoutEffect(() => {
    const store = useLazyFolderStore.getState()
    const next = reconcileLazyState(files, store.loaded, previousTree.current)
    if (next !== store.loaded) store.replaceLoaded(next)
    store.pruneStatus(collectLazyPaths(mergeLazyChildren(files, next)))
  }, [files])

  useEffect(() => {
    previousTree.current = tree
  }, [tree])

  useEffect(() => {
    const store = useLazyFolderStore.getState()
    for (const path of expandedFolders) {
      if (!lazyPaths.has(path) || inFlight.current.has(path)) continue
      const entry = loaded.get(path)
      if (entry?.baseTree === files) continue
      inFlight.current.add(path)
      store.setStatus(path, 'loading')
      fileGateway
        .readDirectory({ dirPath: path, shallow: true })
        .then((children) => {
          // Cleared first, so the re-render this causes may read it again when stale
          inFlight.current.delete(path)
          store.setLoaded(path, { children, baseTree: files })
          store.setStatus(path, null)
        })
        .catch((error: unknown) => {
          inFlight.current.delete(path)
          // A project switch refuses the read; the remounted tree starts afresh
          if (isProjectChanged(error)) {
            store.setStatus(path, null)
            return
          }
          // The message can carry the path, so only its name is logged
          logger.warn('[ProjectTree] Lazy folder read failed', {
            error: error instanceof Error ? error.name : typeof error
          })
          // Whatever it showed stays, marked failed until the next base tree – not retried in a loop
          store.setLoaded(path, { children: entry?.children ?? [], baseTree: files })
          store.setStatus(path, 'failed')
        })
    }
  }, [expandedFolders, lazyPaths, loaded, files])

  return tree
}
