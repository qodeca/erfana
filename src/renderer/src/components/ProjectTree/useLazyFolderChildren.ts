// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Children of lazy folders (review finding 32).
 *
 * The tree walk leaves an ignored folder (`watcher.ignoreList`, e.g. `dist`,
 * `.venv`) and every folder past its entry cap unread: the row arrives with
 * `lazy` set (`ignored`, `capped` or `linked`) and no children. This hook reads such a folder
 * when it is expanded – one shallow `file:readDirectory` of that folder, which
 * lists one level and leaves its sub-folders lazy in turn – and keeps the
 * result in `useLazyFolderStore`, where every consumer of the project's files
 * finds it (`useMergedProjectFiles`).
 *
 * Loaded children outlive a collapse. A new base tree (a refresh, a watcher
 * event) makes every loaded folder stale: each one is read again when it is
 * next shown expanded – at once, if it is in view now (it and every folder
 * above it expanded), so a refresh never re-reads folders out of view – and
 * its old children stay on screen until the new ones arrive. A failed read
 * stores nothing: the folder keeps what it showed, if anything, its status
 * says `failed`, and it is tried again after the next base tree. A folder that was read in the old tree
 * and is lazy in the new one (the cap moved) keeps the children it showed,
 * also stale. Entries for paths no longer lazy in the tree are dropped.
 *
 * These one-level reads are not fed to `recordTreeReadMs`: that average spaces
 * out forced refreshes by what a whole-tree read costs, and a one-folder read
 * of a few milliseconds would make a slow project look fast.
 *
 * Given `onFolderStale`, a folder that is not lazy is checked against the disk
 * when the user opens it, and the whole tree is refreshed when it differs
 * (`useExpandReconcile`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { fileGateway, isProjectChanged } from '../../services/fileGateway'
import { logger } from '../../utils/logger'
import { useLazyFolderStore, type LazyFolderStatus, type LoadedChildren } from '../../stores/useLazyFolderStore'
import { collectLazyPaths, mergeLazyChildren } from '../../utils/lazyTree'
import { useExpandReconcile } from './useExpandReconcile'

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
 * The lazy folders in view and expanded: reached from the top through
 * expanded folders only (of the tree as shown – filtered, below the root row).
 */
export function visibleExpandedLazy(nodes: FileNode[], expanded: ReadonlySet<string>, into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type !== 'directory' || !expanded.has(node.path)) continue
    if (node.lazy) into.push(node.path)
    if (node.children) visibleExpandedLazy(node.children, expanded, into)
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

/** What the panel shows of the tree: which rows are in view decides what is read. */
export interface LazyFolderView {
  /** The project root row's path: nothing is in view while it is collapsed */
  readonly rootPath?: string | null
  /** The filter the panel shows the tree through (the Markdown filter), if any */
  readonly filter?: (
    tree: FileNode[],
    loaded: ReadonlyMap<string, LoadedChildren>,
    status: ReadonlyMap<string, LazyFolderStatus>,
    base: FileNode[]
  ) => FileNode[]
  /** Refresh the whole tree: an opened folder differs from the disk (`useExpandReconcile`) */
  readonly onFolderStale?: () => void
}

/**
 * @param files - The base tree from the project context
 * @param expandedFolders - The panel's expanded folder paths
 * @param view - What the panel shows of the tree ({@link LazyFolderView})
 * @returns `tree`: the tree to render, with the loaded lazy folders filled in;
 *   `status`: which lazy folders are being read or failed to read (for
 *   `buildVisibleRows`' placeholder lines); `loaded`: the folders read so far
 */
export function useLazyFolderChildren(
  files: FileNode[],
  expandedFolders: ReadonlySet<string>,
  view: LazyFolderView = {}
): {
  tree: FileNode[]
  status: ReadonlyMap<string, LazyFolderStatus>
  loaded: ReadonlyMap<string, LoadedChildren>
} {
  const loaded = useLazyFolderStore((state) => state.loaded)
  const status = useLazyFolderStore((state) => state.status)
  const inFlight = useRef(new Set<string>())
  // Folders whose read failed or a project switch refused, for the base tree
  // it was made against: not asked again until the tree changes (or every
  // re-render would ask again)
  const settled = useRef<{ base: FileNode[]; paths: Set<string> }>({ base: files, paths: new Set() })
  const previousTree = useRef<FileNode[]>([])

  const tree = useMemo(() => mergeLazyChildren(files, loaded), [files, loaded])
  const { rootPath, filter } = view
  useExpandReconcile(files, expandedFolders, rootPath, view.onFolderStale)

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
    const noRetry = (path: string): void => {
      if (settled.current.base !== files) settled.current = { base: files, paths: new Set() }
      settled.current.paths.add(path)
    }
    if (rootPath && !expandedFolders.has(rootPath)) return
    const shown = filter ? filter(tree, loaded, status, files) : tree
    for (const path of visibleExpandedLazy(shown, expandedFolders)) {
      if (inFlight.current.has(path)) continue
      const entry = loaded.get(path)
      if (entry?.baseTree === files) continue
      if (settled.current.base === files && settled.current.paths.has(path)) continue
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
          noRetry(path)
          if (isProjectChanged(error)) {
            store.setStatus(path, null)
            return
          }
          // The message can carry the path, so only its name is logged
          logger.warn('[ProjectTree] Lazy folder read failed', {
            error: error instanceof Error ? error.name : typeof error
          })
          // Nothing is stored: whatever it showed stays, marked failed until
          // the next base tree – not retried in a loop
          store.setStatus(path, 'failed')
        })
    }
  }, [expandedFolders, tree, loaded, status, files, rootPath, filter])

  return { tree, status, loaded }
}
