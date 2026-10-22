// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Children of lazy folders (review finding 32).
 *
 * The tree walk leaves an ignored folder (`watcher.ignoreList`, e.g. `dist`,
 * `.venv`) and every folder past its entry cap unread: the row arrives with
 * `lazy: true` and no children. This hook reads such a folder when it is
 * expanded – one `file:readDirectory` of that folder, which lists one level of
 * an ignored folder and leaves its sub-folders lazy in turn – and merges what
 * came back into the tree the panel renders.
 *
 * Loaded children outlive a collapse. A new base tree (a refresh, a watcher
 * event) makes every loaded folder stale: each one is read again when it is
 * next expanded – at once, if it is expanded now – and its old children stay
 * on screen until the new ones arrive. A folder that is no longer lazy in the
 * new tree simply stops being merged.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { fileGateway, isProjectChanged } from '../../services/fileGateway'
import { logger } from '../../utils/logger'

interface LoadedChildren {
  readonly children: FileNode[]
  /** The base tree the read was made against: another one means stale */
  readonly baseTree: FileNode[]
}

/**
 * The tree with each loaded lazy folder's children put in place. Nodes on no
 * path to a loaded folder are returned as they were, so an unchanged subtree
 * keeps its identity; with nothing loaded the input itself comes back.
 *
 * @param nodes - The tree as the main process sent it
 * @param loaded - Children read on expand, by folder path
 */
export function mergeLazyChildren(
  nodes: FileNode[],
  loaded: ReadonlyMap<string, { readonly children: FileNode[] }>
): FileNode[] {
  if (loaded.size === 0) return nodes
  let changed = false
  const merged = nodes.map((node) => {
    if (node.type !== 'directory') return node
    const entry = node.lazy ? loaded.get(node.path) : undefined
    const source = entry ? entry.children : node.children
    // A lazy row already has empty children, so an empty read changes nothing
    if (!source || source.length === 0) return node
    const children = mergeLazyChildren(source, loaded)
    if (!entry && children === node.children) return node
    changed = true
    return { ...node, children }
  })
  return changed ? merged : nodes
}

/** Every lazy folder's path in a (merged) tree. */
export function collectLazyPaths(nodes: FileNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    if (node.lazy) into.add(node.path)
    if (node.children) collectLazyPaths(node.children, into)
  }
  return into
}

/**
 * @param files - The base tree from the project context
 * @param expandedFolders - The panel's expanded folder paths
 * @returns The tree to render, with the loaded lazy folders filled in
 */
export function useLazyFolderChildren(files: FileNode[], expandedFolders: ReadonlySet<string>): FileNode[] {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedChildren>>(() => new Map())
  const inFlight = useRef(new Set<string>())

  const tree = useMemo(() => mergeLazyChildren(files, loaded), [files, loaded])
  const lazyPaths = useMemo(() => collectLazyPaths(tree), [tree])

  useEffect(() => {
    for (const path of expandedFolders) {
      if (!lazyPaths.has(path) || inFlight.current.has(path)) continue
      if (loaded.get(path)?.baseTree === files) continue
      inFlight.current.add(path)
      const record = (children: FileNode[]): void =>
        setLoaded((prev) => new Map(prev).set(path, { children, baseTree: files }))
      fileGateway
        .readDirectory({ dirPath: path })
        .then(record)
        .catch((error: unknown) => {
          // A project switch refuses the read; the remounted tree starts afresh
          if (isProjectChanged(error)) return
          // The message can carry the path, so only its name is logged
          logger.warn('[ProjectTree] Lazy folder read failed', {
            error: error instanceof Error ? error.name : typeof error
          })
          // An empty folder until the next base tree – not retried in a loop
          record([])
        })
        .finally(() => {
          inFlight.current.delete(path)
        })
    }
  }, [expandedFolders, lazyPaths, loaded, files])

  return tree
}
