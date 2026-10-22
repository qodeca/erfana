// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { FileNode } from '../../../../preload/index'
import type { LazyFolderStatus } from '../../stores/useLazyFolderStore'

/**
 * One row the project tree shows: a node whose every ancestor is expanded.
 *
 * The tree renders this flat list (virtualised), not the nested `FileNode`
 * structure, so each row carries the facts a nested DOM used to imply:
 * `level`, `posInSet` and `setSize` become `aria-level` / `aria-posinset` /
 * `aria-setsize` – which a virtualised tree must state explicitly, because the
 * rows around it are not all in the DOM for assistive tech to count.
 */
export interface VisibleTreeRow {
  /** Absent on a node row; see {@link PlaceholderTreeRow} */
  kind?: undefined
  node: FileNode
  /** 0 for the project root row */
  level: number
  /** Path of the parent row, or null for the root row */
  parentPath: string | null
  /** 1-based position among its siblings (`aria-posinset`) */
  posInSet: number
  /** Number of siblings including itself (`aria-setsize`) */
  setSize: number
  /** Directory rows only: whether its children follow it in the list */
  isExpanded: boolean
}

/**
 * The line under an expanded lazy folder (finding 32, #320) that is being
 * read, or whose read failed. It is not a node: it has no path of its own, is
 * left out of `indexByPath` and of its folder's `aria-setsize` / `aria-posinset`,
 * the keyboard and type-ahead step over it, and it cannot be focused or dragged.
 * A drop on it lands in its folder.
 */
export interface PlaceholderTreeRow {
  kind: 'placeholder'
  /** The lazy folder the line belongs to */
  folderPath: string
  /** The folder's children's level: the line is drawn as their first row */
  level: number
  /** Same as `folderPath`, so code that only reads the parent sees the folder */
  parentPath: string
  status: LazyFolderStatus
}

/** A row of the flat list: a node, or a placeholder line. */
export type TreeRow = VisibleTreeRow | PlaceholderTreeRow

/** Whether a row is a node row (not a placeholder line). */
export const isNodeRow = (row: TreeRow | undefined): row is VisibleTreeRow =>
  row !== undefined && row.kind !== 'placeholder'

const PLACEHOLDER_PREFIX = '\u0000loading:'

/**
 * The virtualiser key and the droppable id of a folder's placeholder line. The
 * leading NUL cannot start a path, so it never collides with a row's key.
 */
export const placeholderKey = (folderPath: string): string => `${PLACEHOLDER_PREFIX}${folderPath}`

/**
 * The folder a drop target id stands for: a placeholder's folder, or the id
 * itself (a row's path).
 */
export function dropTargetPath(id: string): string {
  return id.startsWith(PLACEHOLDER_PREFIX) ? id.slice(PLACEHOLDER_PREFIX.length) : id
}

/** The flat rows plus a path → index lookup built in the same pass. */
export interface VisibleTreeRows {
  rows: TreeRow[]
  /** Node rows only: a placeholder has no path of its own */
  indexByPath: ReadonlyMap<string, number>
}

interface Frame {
  nodes: FileNode[]
  parentPath: string | null
  level: number
  cursor: number
}

/**
 * Flatten the expanded part of the tree into display order (pre-order DFS).
 *
 * Only expanded folders are descended, so the cost is proportional to the rows
 * that can be shown, not to the size of the project. An explicit stack keeps a
 * deep tree off the call stack (the recursion in `flattenTree` once overflowed
 * on large projects – issue #60).
 *
 * Lazy folders (#320): under an expanded lazy folder with a read status, a
 * placeholder line comes first – "loading" only while the folder has nothing
 * to show yet, "failed" always (any children shown are the last ones read).
 *
 * @param root - The synthetic project-root node, or null when no project is open
 * @param expanded - Paths of the expanded folders
 * @param lazyStatus - Read status of lazy folders, by path (`useLazyFolderChildren`)
 * @returns The rows in display order and their index by path (first path wins)
 */
export function buildVisibleRows(
  root: FileNode | null,
  expanded: ReadonlySet<string>,
  lazyStatus: ReadonlyMap<string, LazyFolderStatus> = new Map()
): VisibleTreeRows {
  const rows: TreeRow[] = []
  const indexByPath = new Map<string, number>()
  if (!root) return { rows, indexByPath }

  const stack: Frame[] = [{ nodes: [root], parentPath: null, level: 0, cursor: 0 }]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (frame.cursor >= frame.nodes.length) {
      stack.pop()
      continue
    }
    const node = frame.nodes[frame.cursor]
    frame.cursor++

    const isExpanded = node.type === 'directory' && expanded.has(node.path)
    if (!indexByPath.has(node.path)) indexByPath.set(node.path, rows.length)
    rows.push({
      node,
      level: frame.level,
      parentPath: frame.parentPath,
      posInSet: frame.cursor,
      setSize: frame.nodes.length,
      isExpanded
    })

    const status = isExpanded && node.lazy ? lazyStatus.get(node.path) : undefined
    const hasChildren = node.children !== undefined && node.children.length > 0
    if (status === 'failed' || (status === 'loading' && !hasChildren)) {
      rows.push({ kind: 'placeholder', folderPath: node.path, level: frame.level + 1, parentPath: node.path, status })
    }

    if (isExpanded && node.children && node.children.length > 0) {
      stack.push({ nodes: node.children, parentPath: node.path, level: frame.level + 1, cursor: 0 })
    }
  }
  return { rows, indexByPath }
}
