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
// FileService.ts:223-232
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

**Move conflicts**: Show confirm dialog
**Copy conflicts**: Automatic numbering (file.md → file (1).md → file (2).md)

### Project Root Protection

```typescript
// FileService.ts:267-269
if (this.projectPath && sourcePath === this.projectPath) {
  throw new Error('Cannot move the project root directory')
}
```

Cannot drag the project root folder itself.

### Validation Summary

| Validation Rule | Check | Error Message |
|----------------|-------|--------------|
| Circular move | `isDescendant(targetPath, sourcePath)` | "Cannot move folder into its own subfolder" |
| Same location | `sourcePath === targetPath` | "Source and target paths are the same" |
| Root protection | `sourcePath === projectPath` | "Cannot move the project root directory" |
| Move conflict | `checkNameConflict()` | Confirm dialog shown |
| Copy conflict | `checkNameConflict()` | Auto-numbered name |
| Copy overflow | `copyNumber > MAX_COPY_ATTEMPTS` (1000) | "Cannot create more than 1000 copies with the same name" |

## Edge Cases

### Same-Location Drop

**Problem**: Drag file and drop in same location
**Solution**: Early validation check, no operation performed

```typescript
// FileService.ts:262-264
if (sourcePath === targetPath) {
  throw new Error('Source and target paths are the same')
}
```

### Cross-Filesystem Copy

**Problem**: User copies file across volumes
**Solution**: Direct copy operation (no rename needed)

```typescript
// FileService.ts:362-368
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
// FileService.ts:228-231
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
- Symlinks are copied as symlinks (not their targets)
- Symlinks moved like regular files
- Visual indicator in tree (link icon)

### Name Sanitization

**Problem**: User attempts to use invalid filename characters
**Solution**: Handled by dialog validation before reaching file operations

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
| `ENOENT` | File not found | Show error toast, reload tree |
| `EACCES` | Permission denied | Show error toast with permission details |
| `EEXIST` | File already exists | Should not happen (conflict check prevents) |
| `EXDEV` | Cross-filesystem move | Automatic fallback to copy+delete |
| `EISDIR` | Target is directory | Validation prevents this |
| `ENOTDIR` | Target is not directory | Validation prevents this |

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
