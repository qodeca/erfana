# Drag-Drop Architecture

> Core technical implementation of drag-drop file reorganization

[← Back to Drag-Drop Overview](./README.md)

## Architecture

### Tree Flattening Algorithm

The hierarchical file tree is converted to a flat array for drag operations using depth-first traversal:

```typescript
// useDragDropTree.ts:25-47
export function flattenTree(
  nodes: FileNode[],
  parentId: string | null = null,
  depth: number = 0
): FlattenedNode[] {
  const flattened: FlattenedNode[] = []

  nodes.forEach((node, index) => {
    flattened.push({
      ...node,
      parentId,  // Track parent for hierarchy reconstruction
      depth,     // Track depth for indentation/projection
      index      // Track sibling order
    })

    if (node.type === 'directory' && node.children) {
      flattened.push(...flattenTree(node.children, node.path, depth + 1))
    }
  })

  return flattened
}
```

**Why flattening?** dnd-kit requires linear array for SortableContext, but we need to preserve hierarchy metadata for validation and reconstruction.

### Projection Calculation

During drag, we calculate where the item would land based on:
1. **Vertical position** (which item we're hovering over)
2. **Horizontal offset** (how far right/left the cursor is)

```typescript
// useDragDropTree.ts:107-165
export function getProjection(
  flattenedItems: FlattenedNode[],
  activeId: string,
  overId: string,
  offsetLeft: number = 0,
  indentationWidth: number = 16
): ProjectionResult | null {
  const activeNode = flattenedItems.find(item => item.path === activeId)
  const overNode = flattenedItems.find(item => item.path === overId)

  // Calculate depth based on horizontal offset during drag
  const offsetDepth = Math.round(offsetLeft / indentationWidth)
  const projectedDepth = Math.max(0, overNode.depth + offsetDepth)

  // Determine parent based on projected depth
  let parentId: string | null = null

  if (projectedDepth === 0) {
    parentId = null  // Moving to root level
  } else if (projectedDepth === overNode.depth) {
    parentId = overNode.parentId  // Same level as hover target
  } else if (projectedDepth > overNode.depth) {
    parentId = overNode.type === 'directory' ? overNode.path : overNode.parentId
  } else {
    // Moving shallower - walk up tree to find parent at projected depth
    const overIndex = flattenedItems.findIndex(item => item.path === overId)
    for (let i = overIndex; i >= 0; i--) {
      const item = flattenedItems[i]
      if (item.depth === projectedDepth - 1 && item.type === 'directory') {
        parentId = item.path
        break
      }
    }
  }

  return { depth: projectedDepth, parentId, overId }
}
```

**Projection result** indicates the new parent folder and depth where the item will move.

### Move Operation

File moves use a two-phase strategy to handle cross-filesystem scenarios:

```typescript
// FileService.ts:246-316
async moveItem(sourcePath: string, targetParentPath: string, newName?: string): Promise<string> {
  // Validation checks...
  const targetPath = join(targetParentPath, finalName)

  // Try fs.rename first (fast, atomic for same filesystem)
  try {
    await fsRename(sourcePath, targetPath)
    return targetPath
  } catch (error) {
    const code = (error as { code?: string }).code

    // EXDEV error means cross-filesystem move, fallback to copy+delete
    if (code === 'EXDEV') {
      if (sourceStats.isDirectory()) {
        await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
      } else {
        await copyFile(sourcePath, targetPath)
      }

      // Delete original after successful copy
      await rm(sourcePath, { recursive: true, force: true })
      return targetPath
    }

    // Other errors, rethrow
    throw error
  }
}
```

**Why this pattern?**
- `fs.rename()` is fast and atomic but fails with `EXDEV` when moving across filesystems/volumes
- Fallback to `copy + delete` handles all cases but is slower
- Try fast path first, gracefully degrade to slow path only when needed

