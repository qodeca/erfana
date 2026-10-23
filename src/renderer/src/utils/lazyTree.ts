// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lazy folders in a project tree (review finding 32): pure helpers shared by
 * the project tree (`useLazyFolderChildren`) and every other consumer of the
 * merged tree (`useMergedProjectFiles`).
 */
import type { FileNode } from '../../../shared/ipc/file-schema'
import type { LazyFolderStatus } from '../stores/useLazyFolderStore'

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
 * Whether a lazy folder's contents are unknown: never read, or its last read
 * failed (what it may still show is from an older read).
 */
export function isUnreadLazy(
  path: string,
  loaded: ReadonlyMap<string, unknown>,
  status?: ReadonlyMap<string, LazyFolderStatus>
): boolean {
  return !loaded.has(path) || status?.get(path) === 'failed'
}

/**
 * Whether a merged tree is missing files a walk bound left out: some `capped`
 * folder in it is unread ({@link isUnreadLazy}). `ignored` folders do not
 * count – their files are left out by design – and neither do `linked` ones,
 * whose files the tree shows under the folder the link leads to.
 */
export function hasUnloadedCapped(
  nodes: FileNode[],
  loaded: ReadonlyMap<string, unknown>,
  status?: ReadonlyMap<string, LazyFolderStatus>
): boolean {
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    if (node.lazy === 'capped' && isUnreadLazy(node.path, loaded, status)) return true
    if (node.children && hasUnloadedCapped(node.children, loaded, status)) return true
  }
  return false
}
