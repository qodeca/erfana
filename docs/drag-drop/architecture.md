# Drag-Drop Architecture

> Core technical implementation of drag-drop file reorganization

[← Back to Drag-Drop Overview](./README.md)

## Architecture

### Tree Flattening Algorithm

The hierarchical file tree is converted to a flat array for drag operations using depth-first traversal:

```typescript
// useDragDropTree.ts — flattenInto (module-private)
function flattenInto(
  nodes: FileNode[],
  parentId: string | null,
  depth: number,
  out: FlattenedNode[],
  index: Map<string, FlattenedNode> | null
): void {
  if (nodes.length === 0) return

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
```

**Why an explicit stack, not recursion?** The pre-[#60](https://github.com/qodeca/erfana/issues/60) implementation recursed and merged subtrees with `flattened.push(...flattenTree(node.children, …))`. Spread-into-push is `Function.prototype.apply`, whose argument count is bounded by the engine stack (~10^5 on V8), so the first directory with a large enough *flattened subtree* threw `RangeError: Maximum call stack size exceeded` and took the whole React root down with it. The loop above pushes exactly one node per iteration and keeps traversal state on the heap. Output is unchanged: pre-order DFS, forward sibling order, `depth` per level, `index` reset per parent.

**Two entry points.** `useDragDropTree`'s memo calls `flattenInto(files, null, 0, items, index)` directly and returns the array, the `path → node` index and the timing from one pass. `flattenTree(nodes, parentId?, depth?)` is a thin exported wrapper over `flattenInto` (no index argument) kept for existing callers and tests — the hook itself does not call it.

**Precondition**: `nodes` is a finite, acyclic tree. `FileService` never descends symlinks, so a cycle cannot reach here; a cyclic input would loop unboundedly rather than throw.

**Why flattening?** dnd-kit requires linear array for SortableContext, but we need to preserve hierarchy metadata for validation and reconstruction.

**`offset`** is recorded in the same single flatten pass – it is the node's own slot in the flat array, so a caller holding the node never has to scan the array back for its position. The synthetic project root is the one node absent from that array and carries `offset: -1`, which matches `findIndex`'s "not found".

### Projection Calculation

During drag, we calculate where the item would land based on:
1. **Vertical position** (which item we're hovering over)
2. **Horizontal offset** (how far right/left the cursor is)

```typescript
// useDragDropTree.ts — getProjection
export function getProjection(
  flattenedItems: FlattenedNode[],
  activeId: string,
  overId: string,
  offsetLeft: number = 0,
  indentationWidth: number = DEFAULT_INDENTATION_WIDTH,  // 16
  nodeIndex?: NodeIndex  // Optional path -> node map built alongside the flat array
): ProjectionResult | null {
  const activeNode = nodeIndex
    ? nodeIndex.get(activeId)
    : flattenedItems.find(item => item.path === activeId)
  const overNode = nodeIndex
    ? nodeIndex.get(overId)
    : flattenedItems.find(item => item.path === overId)

  // Either id unresolvable -> no projection, and the drag is rejected.
  if (!activeNode || !overNode) {
    return null
  }

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
    const overIndex = nodeIndex
      ? overNode.offset  // O(1) start, no scan
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

  return { depth: projectedDepth, parentId, overId }
}
```

**Projection result** indicates the new parent folder and depth where the item will move.

**Id resolution is no longer purely find-based.** When a `nodeIndex` is passed, the two id lookups are hash lookups instead of linear scans, and the shallower-branch walk starts from `overNode.offset` in O(1) rather than a `findIndex` scan. Only the starting point changes: the walk itself stays positional (an ordered scan backwards from the hovered row, and it exits early once it passes `projectedDepth - 1`), so the index cannot replace it. Without a `nodeIndex` the function falls back to scanning, so 4-argument callers keep working unchanged. A supplied index must be **complete** for `flattenedItems` – a stale index makes misses authoritative, so an id the array still contains resolves to `null` and the drag is rejected.

### Move Operation

File moves use a two-phase strategy to handle cross-filesystem scenarios:

```typescript
// FileService.ts — moveItem
async moveItem(
  sourcePath: string,
  targetParentPath: string,
  newName?: string,
  replaceExisting?: boolean
): Promise<{ path: string; isSymlink?: boolean }> {
  // Validation: source stats, symlink probe, target is a directory, same-path
  // guard, project-root guard, in-project guards, circular-move guard, and a
  // case-insensitive conflict check that only deletes when `replaceExisting`.
  const targetPath = join(targetParentPath, finalName)

  // Try fs.rename first (fast, atomic for same filesystem)
  try {
    await fsRename(sourcePath, targetPath)
    return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
  } catch (error) {
    const code = (error as { code?: string }).code

    // EXDEV error means cross-filesystem move, fallback to copy+delete
    if (code === 'EXDEV') {
      if (sourceStats.isDirectory()) {
        await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
      } else {
        await copyFile(sourcePath, targetPath)
      }

      // Delete original after successful copy; if the delete fails, roll the
      // copy back so the item is not left duplicated on both volumes.
      try {
        await rm(sourcePath, { recursive: true, force: true })
      } catch (deleteError) {
        await this.rollbackHandler.rollbackCopyOnDeleteFailure(sourcePath, targetPath, deleteError)
      }

      return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
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
- The return value is an object, not a bare path: callers need the `isSymlink` flag alongside the new path
- `replaceExisting` is opt-in — without it a name conflict throws instead of overwriting, which is what makes the renderer's confirm dialog the deciding step

