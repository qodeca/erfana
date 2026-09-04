// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useCallback, useEffect, useMemo } from 'react'
import type { FileNode } from '../../../preload/index'
import { isStrictDescendant } from '../utils/fileUtils'
import { logger } from '../utils/logger'

/**
 * Flattened node with depth and parent information for drag-drop operations
 */
export interface FlattenedNode extends FileNode {
  parentId: string | null
  depth: number
  /** Position among its siblings, restarting at 0 under every parent */
  index: number
  /**
   * Position of this node in the flattened array it was produced into.
   *
   * Recorded during the flatten pass so an index-backed caller can reach the
   * positional view without an `Array.findIndex` scan. The synthetic project
   * root is the one node that never lives in that array; `findNodeWithRoot`
   * therefore reports `-1` for it, matching `findIndex`'s "not found".
   */
  offset: number
}

/**
 * Path -> flattened node lookup built alongside the flattened array.
 *
 * Duplicate paths keep `Array.find` semantics: the first occurrence wins.
 */
export type NodeIndex = ReadonlyMap<string, FlattenedNode>

/**
 * Projection result for drag operations showing where item would move
 */
export interface ProjectionResult {
  depth: number
  parentId: string | null
  overId: string
}

/** Horizontal pixels per indentation level used to project drag depth */
const DEFAULT_INDENTATION_WIDTH = 16

/**
 * Above this flatten duration the timing record is promoted from `debug` to
 * `info` so a slow project open leaves a trail in the shipped log file.
 */
const SLOW_FLATTEN_THRESHOLD_MS = 50

/** One level of the explicit traversal stack used by {@link flattenTree} */
interface FlattenFrame {
  nodes: FileNode[]
  parentId: string | null
  depth: number
  /** Index of the next sibling to visit in `nodes` (doubles as its `index`) */
  cursor: number
}

/**
 * Flatten `nodes` into `out` (and, when supplied, into `index`) using an
 * explicit stack.
 *
 * Recursion plus `flattened.push(...subtree)` used to blow the call stack on
 * large projects: spread-into-push is `Function.prototype.apply`, whose
 * argument count is bounded by the engine stack (~10^5 on V8), so the first
 * directory with a big enough flattened subtree threw `RangeError: Maximum
 * call stack size exceeded` (issue #60). This loop pushes exactly one node per
 * iteration and keeps the traversal state on the heap instead.
 *
 * Output shape is unchanged: pre-order DFS, forward sibling order, `depth`
 * incremented per level, `index` reset per parent. `offset` is recorded in the
 * same pass — it is `out.length` at push time, i.e. the node's own position in
 * `out` — so no caller has to scan the array back for it.
 *
 * PRECONDITION: `nodes` is a finite, acyclic tree — `FileService` never descends
 * symlinks, so a cycle cannot reach here; a cyclic input would loop unboundedly
 * rather than throw the `RangeError` the old recursion would have raised.
 *
 * @param index - Optional map filled in the same pass; first path wins
 */
function flattenInto(
  nodes: FileNode[],
  parentId: string | null,
  depth: number,
  out: FlattenedNode[],
  index: Map<string, FlattenedNode> | null
): void {
  if (nodes.length === 0) {
    return
  }

  const stack: FlattenFrame[] = [{ nodes, parentId, depth, cursor: 0 }]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]

    if (frame.cursor >= frame.nodes.length) {
      stack.pop()
      continue
    }

    const node = frame.nodes[frame.cursor]
    const siblingIndex = frame.cursor
    frame.cursor++

    const flattenedNode: FlattenedNode = {
      ...node,
      parentId: frame.parentId,
      depth: frame.depth,
      index: siblingIndex,
      // Read before the push, so it is the slot this node lands in.
      offset: out.length
    }

    out.push(flattenedNode)

    if (index && !index.has(flattenedNode.path)) {
      index.set(flattenedNode.path, flattenedNode)
    }

    // Descend after the parent is emitted (pre-order); the child frame keeps
    // its own cursor so sibling `index` restarts at 0 for every directory.
    if (node.type === 'directory' && node.children && node.children.length > 0) {
      stack.push({
        nodes: node.children,
        parentId: node.path,
        depth: frame.depth + 1,
        cursor: 0
      })
    }
  }
}

/**
 * Flatten tree structure into a linear array with depth/parent metadata
 */
export function flattenTree(
  nodes: FileNode[],
  parentId: string | null = null,
  depth: number = 0
): FlattenedNode[] {
  const flattened: FlattenedNode[] = []
  flattenInto(nodes, parentId, depth, flattened, null)
  return flattened
}

/**
 * Rebuild hierarchical tree from flattened array
 */
export function buildTree(flattenedNodes: FlattenedNode[]): FileNode[] {
  const tree: FileNode[] = []
  const nodeMap = new Map<string, FileNode>()

  // Create node map for quick lookup
  flattenedNodes.forEach((node) => {
    nodeMap.set(node.path, {
      name: node.name,
      path: node.path,
      type: node.type,
      extension: node.extension,
      isSymlink: node.isSymlink,
      children: node.type === 'directory' ? [] : undefined
    })
  })

  // Build hierarchy
  flattenedNodes.forEach((node) => {
    const treeNode = nodeMap.get(node.path)
    if (!treeNode) return

    if (node.parentId === null) {
      // Root level node
      tree.push(treeNode)
    } else {
      // Child node - add to parent's children
      const parentNode = nodeMap.get(node.parentId)
      if (parentNode && parentNode.children) {
        parentNode.children.push(treeNode)
      }
    }
  })

  return tree
}

/**
 * Check if one path is a descendant of another
 */
export function isDescendant(possibleDescendant: string, possibleAncestor: string): boolean {
  // isStrictDescendant(parent, child): equal paths return false, and it handles
  // both POSIX and Windows separators with proper boundary checking.
  return isStrictDescendant(possibleAncestor, possibleDescendant)
}

/**
 * Calculate projection (where item will move) during drag operation
 *
 * @param nodeIndex - Optional path lookup built alongside `flattenedItems`.
 *   When present the two id resolutions below are hash lookups instead of
 *   linear scans; when absent the function falls back to scanning the array,
 *   so 4-argument callers keep working unchanged. It must be COMPLETE for
 *   `flattenedItems`: a supplied-but-stale index makes misses authoritative, so
 *   an id the array still contains resolves to `null` and the drag is rejected.
 */
export function getProjection(
  flattenedItems: FlattenedNode[],
  activeId: string,
  overId: string,
  offsetLeft: number = 0,
  indentationWidth: number = DEFAULT_INDENTATION_WIDTH,
  nodeIndex?: NodeIndex
): ProjectionResult | null {
  const activeNode = nodeIndex
    ? nodeIndex.get(activeId)
    : flattenedItems.find(item => item.path === activeId)
  const overNode = nodeIndex
    ? nodeIndex.get(overId)
    : flattenedItems.find(item => item.path === overId)

  if (!activeNode || !overNode) {
    return null
  }

  // Calculate depth based on horizontal offset during drag
  const offsetDepth = Math.round(offsetLeft / indentationWidth)
  const projectedDepth = Math.max(0, overNode.depth + offsetDepth)

  // Determine parent based on projected depth
  let parentId: string | null = null

  if (projectedDepth === 0) {
    // Moving to root level
    parentId = null
  } else if (projectedDepth === overNode.depth) {
    // Moving to same level as over node
    parentId = overNode.parentId
  } else if (projectedDepth > overNode.depth) {
    // Moving deeper - over node becomes parent (if it's a directory)
    if (overNode.type === 'directory') {
      parentId = overNode.path
    } else {
      // Can't move into a file, use parent instead
      parentId = overNode.parentId
    }
  } else {
    // Moving shallower - find parent at projected depth
    // Walk up the tree to find appropriate parent.
    // The WALK stays positional: it is an ordered scan backwards from the
    // hovered row, so the index cannot replace it. Only its starting point is
    // an id resolution, and that the index does supply: `overNode` is
    // `nodeIndex.get(overId)` here, and its `offset` is the very position
    // `findIndex` would have scanned for (duplicate paths included – the index
    // keeps the first occurrence, which is also the one `findIndex` returns).
    // A synthetic-root `offset` of -1 skips the loop, exactly as a `findIndex`
    // miss would.
    const overIndex = nodeIndex
      ? overNode.offset
      : flattenedItems.findIndex(item => item.path === overId)

    for (let i = overIndex; i >= 0; i--) {
      const item = flattenedItems[i]
      if (item.depth === projectedDepth - 1 && item.type === 'directory') {
        parentId = item.path
        break
      } else if (item.depth < projectedDepth - 1) {
        // Went too shallow, use current level's parent
        parentId = overNode.parentId
        break
      }
    }
  }

  return {
    depth: projectedDepth,
    parentId,
    overId
  }
}

/**
 * Validate if a move operation is allowed
 */
export function canMoveItem(
  activeId: string,
  projection: ProjectionResult,
  projectPath: string | null
): { valid: boolean; reason?: string } {
  // Cannot drop on itself
  if (activeId === projection.overId) {
    return { valid: false, reason: 'Cannot move item onto itself' }
  }

  // Cannot move project root
  if (projectPath && activeId === projectPath) {
    return { valid: false, reason: 'Cannot move project root' }
  }

  // Cannot move folder into its own descendant (circular move)
  if (projection.parentId && isDescendant(projection.parentId, activeId)) {
    return { valid: false, reason: 'Cannot move folder into its own subfolder' }
  }

  return { valid: true }
}

/**
 * Custom hook for tree drag-drop operations
 *
 * Owns the single flatten pass over the project tree and the path lookups
 * derived from it. Consumers must use the named lookups rather than scanning
 * `flattenedItems`, so the root-inclusion policy stays in one module:
 *
 * - `findNode(path)` — base tree only. The synthetic project root is NOT
 *   resolvable, which is what keeps it non-cuttable on the clipboard path.
 * - `findNodeWithRoot(path, rootNode)` — checks the synthetic root first, then
 *   the index.
 *
 * The Map itself is NOT returned: a caller doing its own `.get()` would route
 * around the root-inclusion policy above, and it is the one thing the two
 * lookups exist to prevent. `flattenedItems` IS returned — it is the positional
 * view of the same pass and the flatten result this hook exists to produce
 * (`ProjectTree` currently consumes the lookups only) — but reading a node OUT
 * of it by path is the same bypass, so use the lookups.
 */
export function useDragDropTree(
  files: FileNode[],
  projectPath: string | null
) {
  // Single pass: the flattened array and its path index are produced by the
  // same loop, so a 170k-node tree is traversed and allocated exactly once.
  const { flattenedItems, nodeIndex, flattenDurationMs } = useMemo(() => {
    const startedAt = performance.now()
    const items: FlattenedNode[] = []
    const index = new Map<string, FlattenedNode>()

    flattenInto(files, null, 0, items, index)

    return {
      flattenedItems: items,
      nodeIndex: index as NodeIndex,
      flattenDurationMs: Math.round(performance.now() - startedAt)
    }
  }, [files])

  // Timing is measured in the memo but reported from an effect: memo bodies
  // must stay pure and StrictMode double-invokes them in development.
  //
  // That double-run also makes development durations unrepresentative: the
  // logged number describes ONE of the two passes (the second usually runs
  // faster on warm caches), not the single flatten a production build performs.
  // Do not read dev durations against SLOW_FLATTEN_THRESHOLD_MS — only a
  // production build, where the memo runs once, gives a comparable figure.
  useEffect(() => {
    const payload = { nodeCount: flattenedItems.length, durationMs: flattenDurationMs }

    if (flattenDurationMs > SLOW_FLATTEN_THRESHOLD_MS) {
      logger.info('[ProjectTree] flatten completed', payload)
    } else {
      logger.debug('[ProjectTree] flatten completed', payload)
    }
  }, [flattenedItems, flattenDurationMs])

  /** Find a node of the base tree by path (synthetic root NOT included) */
  const findNode = useCallback(
    (path: string): FlattenedNode | undefined => nodeIndex.get(path),
    [nodeIndex]
  )

  /**
   * Find a node by path, resolving the synthetic project root first.
   *
   * The root is checked before the index to preserve the previous element-0
   * semantics of the prepended-root array.
   *
   * The synthetic root carries `offset: -1`: it is not a member of
   * `flattenedItems`, so there is no honest position to report and -1 keeps
   * positional consumers on the "not found" path instead of pointing them at
   * an unrelated row.
   */
  const findNodeWithRoot = useCallback(
    (path: string, rootNode: FileNode | null): FlattenedNode | undefined => {
      if (rootNode && rootNode.path === path) {
        return { ...rootNode, parentId: null, depth: 0, index: 0, offset: -1 }
      }
      return nodeIndex.get(path)
    },
    [nodeIndex]
  )

  // Validate move operation
  const validateMove = useCallback(
    (activeId: string, projection: ProjectionResult): { valid: boolean; reason?: string } =>
      canMoveItem(activeId, projection, projectPath),
    [projectPath]
  )

  const getProjectionForDrag = useCallback(
    (activeId: string, overId: string, offsetLeft?: number) =>
      getProjection(
        flattenedItems,
        activeId,
        overId,
        offsetLeft,
        DEFAULT_INDENTATION_WIDTH,
        nodeIndex
      ),
    [flattenedItems, nodeIndex]
  )

  return {
    flattenedItems,
    findNode,
    findNodeWithRoot,
    validateMove,
    getProjection: getProjectionForDrag,
    isDescendant
  }
}
