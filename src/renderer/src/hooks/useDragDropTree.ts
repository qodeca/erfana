// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useMemo } from 'react'
import type { FileNode } from '../../../preload/index'
import { isStrictDescendant } from '../utils/fileUtils'

/**
 * Flattened node with depth and parent information for drag-drop operations
 */
export interface FlattenedNode extends FileNode {
  parentId: string | null
  depth: number
  index: number
}

/**
 * Projection result for drag operations showing where item would move
 */
export interface ProjectionResult {
  depth: number
  parentId: string | null
  overId: string
}

/**
 * Recursively flatten tree structure into linear array with depth/parent metadata
 */
export function flattenTree(
  nodes: FileNode[],
  parentId: string | null = null,
  depth: number = 0
): FlattenedNode[] {
  const flattened: FlattenedNode[] = []

  nodes.forEach((node, index) => {
    flattened.push({
      ...node,
      parentId,
      depth,
      index
    })

    // Recursively flatten children
    if (node.type === 'directory' && node.children) {
      flattened.push(...flattenTree(node.children, node.path, depth + 1))
    }
  })

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
 */
export function getProjection(
  flattenedItems: FlattenedNode[],
  activeId: string,
  overId: string,
  offsetLeft: number = 0,
  indentationWidth: number = 16
): ProjectionResult | null {
  const activeNode = flattenedItems.find(item => item.path === activeId)
  const overNode = flattenedItems.find(item => item.path === overId)

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
    // Walk up the tree to find appropriate parent
    const overIndex = flattenedItems.findIndex(item => item.path === overId)

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
 */
export function useDragDropTree(
  files: FileNode[],
  projectPath: string | null
) {
  // Flatten tree for drag operations
  const flattenedItems = useMemo(() => flattenTree(files), [files])

  // Find node by path
  const findNode = (path: string): FlattenedNode | undefined => {
    return flattenedItems.find(item => item.path === path)
  }

  // Validate move operation
  const validateMove = (
    activeId: string,
    projection: ProjectionResult
  ): { valid: boolean; reason?: string } => {
    return canMoveItem(activeId, projection, projectPath)
  }

  return {
    flattenedItems,
    findNode,
    validateMove,
    getProjection: (
      activeId: string,
      overId: string,
      offsetLeft?: number
    ) => getProjection(flattenedItems, activeId, overId, offsetLeft),
    isDescendant
  }
}
