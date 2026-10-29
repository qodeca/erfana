# Validation & Edge Cases

> Rules, constraints, and edge case handling for drag-drop operations

[← Back to Drag-Drop Overview](./README.md)

## Validation & Constraints

### Circular Move Prevention

```typescript
// useDragDropTree.ts – isDescendant
export function isDescendant(possibleDescendant: string, possibleAncestor: string): boolean {
  // isStrictDescendant(parent, child): equal paths return false, and it handles
  // native separators on both platforms (no POSIX-only string math in the renderer)
  return isStrictDescendant(possibleAncestor, possibleDescendant)
}

// useDragDropTree.ts – canMoveItem
if (projection.parentId && isDescendant(projection.parentId, activeId)) {
  return { valid: false, reason: 'Cannot move folder into its own subfolder' }
}
```

**Example**: Cannot drag `/project/docs` into `/project/docs/guides` (circular)

### Name Conflict Detection

**Case-insensitive** comparison for cross-platform compatibility:

```typescript
// FileService.ts – checkNameConflict
async checkNameConflict(targetParentPath: string, itemName: string): Promise<boolean> {
  try {
    const entries = await readdir(targetParentPath)
    const lowerName = itemName.toLowerCase()
    return entries.some(entry => entry.toLowerCase() === lowerName)
  } catch {
    return false
  }
}
```

**Move conflicts**: a pasted cut shows the "Replace Item" confirm dialog; a drag-drop move does not ask and fails with an error toast
**Copy conflicts**: Automatic numbering (file.md → file (1).md → file (2).md)

### Project Root Protection

```typescript
// FileService.ts – moveItem (isProjectRoot compares against the session's canonical root)
if (this.isProjectRoot(sourcePath)) {
  throw new Error('Cannot move the project root directory')
}
```

Cannot drag the project root folder itself.

### Validation Summary

| Validation Rule | Check | Error Message |
|----------------|-------|--------------|
| Circular move | `isDescendant(targetPath, sourcePath)` (renderer) | "Cannot move folder into its own subfolder" (main backstop: "Cannot move a folder into its own subfolder") |
| Drop in its own folder | `isSameFolderMove(sourcePath, targetParent)` (renderer, `ProjectTree/dropTarget.ts`) | None – the drop ends quietly, no toast |
| Same location | `sourcePath === targetPath` (main) | "Source and target paths are the same" |
| Root protection | `sourcePath === projectPath` (renderer), `isProjectRoot(sourcePath)` (main) | "Cannot move project root" (renderer toast); "Cannot move the project root directory" (main) |
| Move conflict | `checkNameConflict()` | Paste: "Replace Item" dialog; drag: "An item with this name already exists" toast |
| Copy conflict | `checkNameConflict()` | Auto-numbered name |
| Copy overflow | `copyNumber > MAX_COPY_ATTEMPTS` (1000) | "Cannot create more than 1000 copies with the same name" |

## Edge Cases

### Same-Location Drop

**Problem**: Drag file and drop in same location
**Solution**: Since v0.22.0 the renderer catches this first. Hovering a file lands in that file's folder, so a drop on a sibling file of the dragged item, or on the folder it already sits in, is a no-op: `isSameFolderMove` (`src/renderer/src/components/ProjectTree/dropTarget.ts`) ends the drag quietly, with no move request, no confirm dialog and no toast, and no folder is highlighted while hovering there. Before v0.22.0 such a drop asked to move the item where it already was. Main keeps its own check as a backstop

```typescript
// FileService.ts – moveItem
if (sourcePath === targetPath) {
  throw new Error('Source and target paths are the same')
}
```

### Cross-Filesystem Copy

**Problem**: User copies file across volumes
**Solution**: Direct copy operation (no rename needed)

```typescript
// FileService.ts – copyItem (moveItem uses the same copy on an EXDEV fallback)
if (sourceStats.isDirectory()) {
  await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
} else {
  await copyFile(sourcePath, targetPath)
}
```

### Auto-Numbering Overflow

**Problem**: What if user has `file (999).md` and creates another copy?
**Solution**: Safety limit at `MAX_COPY_ATTEMPTS` (1000, exported from `FileService.ts`)

```typescript
// FileService.ts – copyItem
if (copyNumber > MAX_COPY_ATTEMPTS) {
  throw new Error(`Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`)
}
```

### Directory Not Exists

**Problem**: Target directory deleted during drag operation
**Solution**: `checkNameConflict` returns false if directory unreadable

```typescript
// FileService.ts – checkNameConflict
async checkNameConflict(targetParentPath: string, itemName: string): Promise<boolean> {
  try {
    const entries = await readdir(targetParentPath)
    // ...
  } catch {
    return false  // If directory doesn't exist or can't be read, no conflict
  }
}
```

### Symlink Handling

**Problem**: User drags a symlink
**Solution**: Detect symlinks and handle appropriately

```typescript
// src/main/utils/SymlinkDetector.ts
export class SymlinkDetector {
  async checkPath(filePath: string): Promise<boolean>   // lstat-based; false on error
  checkDirent(entry: Dirent): boolean                    // no I/O – used while reading directories
  toOptionalFlag(isSymlink: boolean): boolean | undefined // true → true, false → undefined (omitted from IPC results)
}
```

`FileService.moveItem` / `copyItem` call `checkPath(sourcePath)` and return `{ path, isSymlink: toOptionalFlag(isSymlink) }`; the renderer uses the flag for its "Symlink Moved / Copied" toast.

**Behavior**:
- Copy: a link to a folder is copied as a link; a link to a file is copied as the file's content (the `file:copyItem` handler in `file-handlers.ts`)
- Move: the link itself is moved (`fs.rename`), and the "Symlink Moved" warning toast says the target stays where it was
- Visual indicator in tree (link icon, `aria-label="Symlink"`)

### Name Sanitization

**Problem**: User attempts to use invalid filename characters
**Solution**: Handled by dialog validation before reaching file operations, then checked again main-side: the request schema's `entryNameField` refuses `/`, `\`, NUL, `.` and `..`, and `FileService` runs `assertValidUserFilename`

See [Dialog System](../architecture.md#dialog-system) for validation details.

### Concurrent Operations

**Problem**: User performs multiple drag operations simultaneously
**Solution**: Watcher pause/resume with reference counting

```typescript
// src/main/utils/PauseController.ts
export class PauseController {
  constructor(options?: { timeoutMs?: number; onTimeout?: () => void })
  pause(): number      // returns the new count
  resume(): boolean    // returns true once the count reaches 0
  isPaused(): boolean
  getCount(): number
  reset(): void
  dispose(): void
}
```

**Behavior**:
- Each operation increments pause count
- Watcher resumes only when count reaches 0
- A safety timeout (`timeoutMs`, restarted on every `pause()`) auto-resumes and calls `onTimeout` if `resume()` never arrives
- Prevents race conditions during nested operations

See [integration.md](./integration.md#watcher-synchronization) for details.

## Error Handling

### File System Errors

Common errors and their handling:

| Error Code | Meaning | Handling |
|-----------|---------|----------|
| `ENOENT` | File not found | Drag: error toast "Item not found" (`formatFileOperationError`); paste: the error message as thrown |
| `EACCES` / `EPERM` | Permission denied | Drag: error toast "Permission denied: cannot move item"; paste: the error message as thrown |
| `EEXIST` | File already exists | Should not happen (conflict check prevents) |
| `EXDEV` | Cross-filesystem move | Automatic fallback to copy+delete |
| `ENOTDIR` | Target is not directory | Refused before `FileService` runs: the handler requires `kind: 'directory'`, and `FileService` throws "Target must be a directory" as a backstop |

### Rollback Strategy

```typescript
// src/main/utils/RollbackHandler.ts
export class RollbackHandler {
  // Cross-filesystem move (copy + delete): if deleting the source fails, remove the
  // copy, log, and throw 'Move failed: Could not delete source file. Operation rolled back.'
  async rollbackCopyOnDeleteFailure(_sourcePath: string, targetPath: string, deleteError: unknown): Promise<void>

  // Generic clean-up of a failed operation's partial output; throws if the rollback itself fails
  async rollbackDelete(path: string, operationDescription: string): Promise<void>
}
```

**Usage**: `FileService.moveItem` calls `rollbackCopyOnDeleteFailure` in its EXDEV copy+delete path. There is no generic operation stack – each rollback is an explicit call.

## Testing

Validation and edge cases are covered by:
- **useDragDropTree.test.ts**: Validation logic (46 tests)
- **FileService.moveItem.test.ts**: Move edge cases
- **FileService.copyItem.test.ts** and **FileService.copyItem.limit.test.ts**: Copy edge cases and the `MAX_COPY_ATTEMPTS` cap
- **DirectoryWatcherService.concurrency.test.ts**: Concurrent operations

See [testing.md](./testing.md) for test coverage details.

## Related Files

- **Validation**: [src/renderer/src/hooks/useDragDropTree.ts](../../src/renderer/src/hooks/useDragDropTree.ts)
- **File Operations**: [src/main/services/FileService.ts](../../src/main/services/FileService.ts)
- **Symlink Detection**: [src/main/utils/SymlinkDetector.ts](../../src/main/utils/SymlinkDetector.ts)
- **Rollback Handler**: [src/main/utils/RollbackHandler.ts](../../src/main/utils/RollbackHandler.ts)
- **Pause Controller**: [src/main/utils/PauseController.ts](../../src/main/utils/PauseController.ts)
