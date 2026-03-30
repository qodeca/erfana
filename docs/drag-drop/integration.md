# System Integration

> IPC security, watcher synchronization, and context menu integration

[← Back to Drag-Drop Overview](./README.md)

## Watcher Synchronization

**Problem**: File watcher triggers refresh during move operation, causing stale tree state

**Solution**: Pause watcher → execute operation → refresh tree → resume watcher

```typescript
// ProjectTree.tsx:560-586
const handleDragEnd = async (event: DragEndEvent) => {
  // Calculate target and validate...

  try {
    // Pause watcher to prevent race conditions
    await window.api.directoryWatch.pause(projectPath)

    // Execute move operation
    const newPath = await window.api.file.moveItem(sourcePath, targetParent)

    // Refresh tree from disk
    const fileTree = await window.api.file.readDirectory(projectPath)
    setFiles(fileTree)

    announceToScreenReader(`Moved ${sourceName} to ${targetName}`)
  } catch (error) {
    showGlobalToast({
      title: 'Move Failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      type: 'error'
    })
  } finally {
    // Always resume watcher
    await window.api.directoryWatch.resume(projectPath)
    setActiveId(null)
    setOverId(null)
  }
}
```

**Pattern used for**:
- Drag-drop moves
- Keyboard cut/paste operations
- Context menu cut/paste operations
- Any file mutation that triggers watcher events

### Pause Controller

Reference-counting pause/resume for nested operations:

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

  getCount(): number {
    return this.pauseCount
  }
}
```

**Benefits**:
- Supports nested operations (copy multiple items)
- Prevents premature watcher resume
- Thread-safe reference counting
- Zero configuration needed

## IPC Security

All file operations go through secure IPC handlers with input sanitization:

```typescript
// file-handlers.ts:132-145
ipcMain.handle('file:moveItem', async (_event, sourcePath: string, targetParentPath: string, newName?: string) => {
  // Sanitize new name - prevent path traversal
  let sanitizedNewName: string | undefined = newName
  if (newName) {
    sanitizedNewName = newName.replace(/[/\\]/g, '')
    if (!sanitizedNewName) {
      throw new Error('Invalid new name: cannot contain path separators')
    }
  }

  const newPath = await fileService.moveItem(sourcePath, targetParentPath, sanitizedNewName)
  return newPath
})
```

**Security measures**:
- Strip path separators (`/` and `\`) from user-provided names
- Validate all paths stay within project directory (FileService.ts:271-279)
- No direct filesystem access from renderer process
- All operations go through contextBridge API

### Path Traversal Prevention

```typescript
// FileService.ts:271-279
if (this.projectPath) {
  const normalizedSource = normalize(sourcePath)
  const normalizedTarget = normalize(targetPath)
  const normalizedProject = normalize(this.projectPath)

  if (!normalizedSource.startsWith(normalizedProject) ||
      !normalizedTarget.startsWith(normalizedProject)) {
    throw new Error('Operation outside project directory')
  }
}
```

**Validation ensures**:
- Both source and target must be within project directory
- Normalized paths prevent `../` traversal attacks
- Project boundary enforced at multiple layers

## Context Menu Integration

Cut/Copy/Paste added to file/folder context menus:

```typescript
// ProjectTree.tsx:210-235
const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
  // ... existing menu items ...

  // Separator before clipboard operations
  { type: 'separator' },

  // Cut operation
  {
    label: 'Cut',
    icon: <Scissors size={14} />,
    onClick: () => {
      clipboard.cut(node.path, node.name, node.type)
      announceToScreenReader(`Cut ${node.name}`)
    },
    shortcut: isMac ? '⌘X' : 'Ctrl+X'
  },

  // Copy operation
  {
    label: 'Copy',
    icon: <Copy size={14} />,
    onClick: () => {
      clipboard.copy(node.path, node.name, node.type)
      announceToScreenReader(`Copied ${node.name}`)
    },
    shortcut: isMac ? '⌘C' : 'Ctrl+C'
  },

  // Paste operation (only if clipboard has content)
  ...(clipboard.hasClipboard() ? [{
    label: 'Paste',
    icon: <ClipboardPaste size={14} />,
    onClick: handlePaste,
    shortcut: isMac ? '⌘V' : 'Ctrl+V'
  }] : [])
}
```

**Context-aware menu**:
- Cut/Copy always available
- Paste only shown when clipboard has content
- Keyboard shortcuts displayed in menu
- Icons for visual clarity

## Integration Points

### FileService (Backend)
- **Location**: `src/main/services/FileService.ts`
- **New Methods**: `moveItem()`, `copyItem()`, `checkNameConflict()`
- **Validation**: Project boundary checks, circular move prevention, path sanitization
- **Dependencies**: RollbackHandler, SymlinkDetector

### IPC Layer
- **Location**: `src/main/ipc/file-handlers.ts`
- **Handlers**: `file:moveItem`, `file:copyItem`, `file:checkConflict`
- **Security**: Input sanitization, error handling
- **Error propagation**: Errors serialized to renderer

### Preload Bridge
- **Location**: `src/preload/index.ts`, `src/preload/index.d.ts`
- **APIs**: `window.api.file.moveItem()`, `copyItem()`, `checkConflict()`
- **Type Safety**: Full TypeScript definitions
- **Context Bridge**: Secure IPC boundary

### ProjectTree Component
- **Location**: `src/renderer/src/components/ProjectTree/ProjectTree.tsx`
- **Responsibilities**: DndContext setup, drag handlers, keyboard shortcuts, watcher sync
- **Dependencies**: useDragDropTree, useClipboardStore, dnd-kit
- **State**: activeId, overId, expandedFolders

### Clipboard Store
- **Location**: `src/renderer/src/stores/useClipboardStore.ts`
- **State**: itemPath, operation, itemName, itemType
- **Actions**: cut, copy, paste, clear
- **Dependencies**: IFileOperations (injected via factory)

### Tree Algorithm Hook
- **Location**: `src/renderer/src/hooks/useDragDropTree.ts`
- **Functions**: flattenTree, buildTree, getProjection, isDescendant, canMoveItem
- **Purpose**: Tree manipulation logic separated from UI
- **Tests**: 379 lines of comprehensive test coverage

## Data Flow

### Mouse Drag Operation
```
User drags file
  → DndContext detects drag start
  → handleDragStart sets activeId
  → handleDragOver calculates projection, validates
  → Drop indicator shows target location
  → handleDragEnd executes:
      1. Pause watcher
      2. Call IPC moveItem handler
      3. FileService.moveItem executes
      4. Refresh tree from disk
      5. Resume watcher
      6. Clear drag state
```

### Keyboard Cut/Paste Operation
```
User presses Ctrl+X
  → clipboard.cut(path, name, type)
  → Visual feedback (dimmed, dashed underline)
  → User selects target folder
  → User presses Ctrl+V
  → clipboard.paste(targetPath)
  → handlePaste executes:
      1. Pause watcher
      2. Call IPC moveItem handler
      3. FileService.moveItem executes
      4. Refresh tree from disk
      5. Clear clipboard
      6. Resume watcher
```

### Context Menu Operation
```
User right-clicks file
  → Context menu appears
  → User clicks "Cut"
  → clipboard.cut(path, name, type)
  → [Same flow as keyboard cut/paste]
```

## Error Handling

Errors propagate through layers:
1. **FileService** throws Error with descriptive message
2. **IPC handler** catches and serializes error
3. **Renderer** receives error, shows toast notification
4. **Watcher** always resumes in finally block

**User-facing errors**:
- "Cannot move folder into its own subfolder"
- "File already exists at destination"
- "Permission denied"
- "Source and target paths are the same"

## Document import integration

External file drops of document formats (PDF, Office, images) route through the LiteParse import pipeline instead of the standard move/copy flow:

```
External file drop
  → useImport checks extension against cached document extension list
  → Document file? → Open DocumentImportDialog (OCR, language, screenshots, DPI)
  → DependencyDetector ran at startup? → Show dependency-missing modal if LibreOffice/ImageMagick absent
  → User confirms → import:document IPC → LiteParseConverter processes file
  → Progress streamed via import:documentProgress
  → Cancellation via import:documentCancel
```

**Key integration points**:
- `useImport` hook routes files by extension (calls `import:getDocumentExtensions` once, caches result)
- Batch drops filter document files out with a warning toast – only individual drops trigger the dialog
- `import:dependenciesReady` event fires after startup dependency detection completes
- DocumentImportDialog state managed by `useDocumentImportStore` (Zustand, session-persistent options)

See [api-services-features.md](../api-services-features.md) for LiteParseConverter and DependencyDetector APIs.

## Related Files

- **File Service**: [src/main/services/FileService.ts](/src/main/services/FileService.ts)
- **IPC Handlers**: [src/main/ipc/file-handlers.ts](/src/main/ipc/file-handlers.ts)
- **Preload**: [src/preload/index.ts](/src/preload/index.ts), [src/preload/index.d.ts](/src/preload/index.d.ts)
- **Project Tree**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](/src/renderer/src/components/ProjectTree/ProjectTree.tsx)
- **Clipboard Store**: [src/renderer/src/stores/useClipboardStore.ts](/src/renderer/src/stores/useClipboardStore.ts)
- **Tree Hook**: [src/renderer/src/hooks/useDragDropTree.ts](/src/renderer/src/hooks/useDragDropTree.ts)
- **Pause Controller**: [src/main/utils/PauseController.ts](/src/main/utils/PauseController.ts)
