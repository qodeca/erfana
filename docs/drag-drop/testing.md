# Testing Strategy

> Test coverage and testing scenarios for drag-drop operations

[← Back to Drag-Drop Overview](./README.md)

## Testing Strategy

### Unit Tests (Pending Implementation)

**FileService.moveItem.test.ts** (15 tests):
- ✓ Same filesystem move (fs.rename)
- ✓ Cross-filesystem move (EXDEV fallback)
- ✓ Circular move prevention
- ✓ Project root protection
- ✓ Same-location prevention
- ✓ Name sanitization
- ✓ Directory move with children
- ✓ File move preserves timestamps
- ✓ Error handling for missing source
- ✓ Error handling for invalid target
- ✓ Path traversal prevention
- ✓ Outside-project boundary checks
- ✓ Rename during move
- ✓ Directory permissions errors
- ✓ File permissions errors

**FileService.copyItem.test.ts** (12 tests):
- ✓ Simple file copy
- ✓ Directory copy with children
- ✓ Auto-numbering (1), (2), (3)
- ✓ Auto-numbering preserves extension
- ✓ Copy to same location creates (1)
- ✓ Copy preserves timestamps
- ✓ Overflow safety (1000 limit)
- ✓ Outside-project boundary checks
- ✓ Name sanitization
- ✓ Error handling for missing source
- ✓ Error handling for invalid target
- ✓ Directory permissions errors

**useDragDropTree.test.ts** (10 tests):
- ✓ flattenTree preserves hierarchy metadata
- ✓ buildTree reconstructs from flattened
- ✓ getProjection calculates correct depth
- ✓ getProjection handles root level
- ✓ getProjection handles deeper nesting
- ✓ getProjection handles shallower nesting
- ✓ isDescendant detects circular moves
- ✓ isDescendant handles edge cases
- ✓ canMoveItem validates all constraints
- ✓ canMoveItem prevents project root move

**useClipboardStore.test.ts** (8 tests):
- ✓ cut() sets clipboard state
- ✓ copy() sets clipboard state
- ✓ paste() with cut clears clipboard
- ✓ paste() with copy keeps clipboard
- ✓ hasClipboard() detection
- ✓ clear() resets state
- ✓ paste() calls correct API (move vs copy)
- ✓ paste() handles errors

**ProjectTree.dragdrop.test.tsx** (12 integration tests):
- ✓ Drag file to folder shows drop indicator
- ✓ Drag folder to folder shows drop indicator
- ✓ Drop executes move operation
- ✓ Invalid drop shows error toast
- ✓ Keyboard cut (Ctrl+X) sets clipboard
- ✓ Keyboard copy (Ctrl+C) sets clipboard
- ✓ Keyboard paste (Ctrl+V) executes operation
- ✓ Context menu cut/copy/paste
- ✓ Watcher pauses during operation
- ✓ Tree refreshes after operation
- ✓ ARIA announcements for all operations
- ✓ Visual feedback (opacity, outlines, indicators)

### Manual Testing Scenarios (Pending)

**Drag-drop operations**:
1. Drag file to folder (should move file into folder)
2. Drag folder to folder (should move folder into folder)
3. Drag folder into its own subfolder (should show error)
4. Drag item and drop in same location (should do nothing)
5. Drag item while watcher is active (should pause/resume correctly)
6. Drag file to root level (horizontal drag left)
7. Drag file to nested level (horizontal drag right)

**Keyboard shortcuts**:
1. Select file → Ctrl+X → Select folder → Ctrl+V (should move)
2. Select file → Ctrl+C → Select folder → Ctrl+V twice (should copy twice with numbering)
3. Select folder → Ctrl+X → Select its parent → Ctrl+V (should move out)
4. No selection → Ctrl+X (should do nothing)
5. Cut item → switch selection → Ctrl+V (should paste at new location)

**Conflict resolution**:
1. Copy file where name exists (should auto-number)
2. Move file where name exists (should show confirm dialog)
3. Cancel confirm dialog (should abort operation)
4. Confirm overwrite (should replace file)
5. Copy 1000 times (should hit overflow limit)

**Cross-platform**:
1. Move file on same volume (should use fs.rename)
2. Move file across volumes (should use copy+delete fallback)
3. Case-insensitive conflict (README.md vs readme.md on macOS)

