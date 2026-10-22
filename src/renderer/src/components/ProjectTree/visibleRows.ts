// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { FileNode } from '../../../../preload/index'

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

/** The flat rows plus a path → index lookup built in the same pass. */
export interface VisibleTreeRows {
  rows: VisibleTreeRow[]
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
 * Extension point (lazy folders, #320): a folder whose children are not loaded
 * yet can be handled where a frame is pushed – with a third argument carrying
 * per-folder load status, emit a placeholder row (a `kind` field on
 * `VisibleTreeRow`) instead of descending. Nothing else here assumes the
 * children are present.
 *
 * @param root - The synthetic project-root node, or null when no project is open
 * @param expanded - Paths of the expanded folders
 * @returns The rows in display order and their index by path (first path wins)
 */
export function buildVisibleRows(root: FileNode | null, expanded: ReadonlySet<string>): VisibleTreeRows {
  const rows: VisibleTreeRow[] = []
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

    if (isExpanded && node.children && node.children.length > 0) {
      stack.push({ nodes: node.children, parentPath: node.path, level: frame.level + 1, cursor: 0 })
    }
  }
  return { rows, indexByPath }
}
