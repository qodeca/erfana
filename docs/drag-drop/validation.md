# Validation & Edge Cases

> Rules, constraints, and edge case handling for drag-drop operations

[← Back to Drag-Drop Overview](./README.md)

## Validation & Constraints

### Circular Move Prevention

```typescript
// useDragDropTree.ts:91-102
export function isDescendant(possibleDescendant: string, possibleAncestor: string): boolean {
  if (possibleDescendant === possibleAncestor) {
    return false
  }

  const ancestorWithSep = possibleAncestor.endsWith('/')
    ? possibleAncestor
    : possibleAncestor + '/'

  return possibleDescendant.startsWith(ancestorWithSep)
}

// useDragDropTree.ts:186-187
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
| Copy overflow | `copyNumber > 1000` | "Too many copies with the same name" |

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
**Solution**: Safety limit at 1000 copies

```typescript
// FileService.ts:356-359
if (copyNumber > 1000) {
  throw new Error('Too many copies with the same name')
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
// SymlinkDetector.ts
export class SymlinkDetector {
  async isSymlink(path: string): Promise<boolean> {
    try {
      const stats = await lstat(path)
      return stats.isSymbolicLink()
    } catch {
      return false
    }
  }
}
```

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
// PauseController.ts
export class PauseController {
  private pauseCount = 0

  pause(): void {
    this.pauseCount++
  }

  resume(): void {
    if (this.pauseCount > 0) {
      this.pauseCount--
    }
  }

  isPaused(): boolean {
    return this.pauseCount > 0
  }
}
```

**Behavior**:
- Each operation increments pause count
- Watcher resumes only when count reaches 0
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
// RollbackHandler.ts
export class RollbackHandler {
  private operations: Array<() => Promise<void>> = []

  addRollback(operation: () => Promise<void>): void {
    this.operations.push(operation)
  }

  async rollback(): Promise<void> {
    // Execute rollback operations in reverse order
    for (const operation of this.operations.reverse()) {
      try {
        await operation()
      } catch (error) {
        console.error('Rollback operation failed:', error)
      }
    }
  }
}
```

**Usage**: Atomic file operations that rollback on partial failure.

## Testing

Validation and edge cases are covered by:
- **useDragDropTree.test.ts**: Validation logic (379 lines)
- **FileService.moveItem.test.ts**: Move edge cases (330 lines)
- **FileService.copyItem.test.ts**: Copy edge cases (290 lines)
- **DirectoryWatcherService.concurrency.test.ts**: Concurrent operations (206 lines)

See [testing.md](./testing.md) for test coverage details.

## Related Files

- **Validation**: [src/renderer/src/hooks/useDragDropTree.ts](/src/renderer/src/hooks/useDragDropTree.ts)
- **File Operations**: [src/main/services/FileService.ts](/src/main/services/FileService.ts)
- **Symlink Detection**: [src/main/utils/SymlinkDetector.ts](/src/main/utils/SymlinkDetector.ts)
- **Rollback Handler**: [src/main/utils/RollbackHandler.ts](/src/main/utils/RollbackHandler.ts)
- **Pause Controller**: [src/main/utils/PauseController.ts](/src/main/utils/PauseController.ts)
