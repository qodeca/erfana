# System Integration

> IPC security, watcher synchronization, and context menu integration

[← Back to Drag-Drop Overview](./README.md)

## Watcher Synchronization

**Problem**: File watcher triggers refresh during move operation, causing stale tree state

**Solution**: Pause watcher → execute operation → refresh tree → resume watcher

```typescript
// ProjectTree.tsx – handleDragEnd (shape; the pause/resume pair lives in withWatcherPause.ts)
const handleDragEnd = async (event: DragEndEvent) => {
  // Calculate target and validate...

  const result = await withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, async () => {
    // Execute move operation
    return window.api.file.moveItem(sourcePath, targetParent)
  })
  // withWatcherPause pauses the directory watcher before `op`, marks the mutation as
  // internal, and always resumes in its own finally block.

  // Refresh tree from disk, then report through the toast service – there is no
  // screen-reader announcer (see visual-feedback.md § Accessibility)
  await refreshProjectTree()
  showGlobalToast({ title: 'Success', message: 'Moved 1 file', type: 'success' })
  // failures: showGlobalToast({ title: 'Move failed', message: error.message, type: 'error' })

  setActiveId(null)
  setOverId(null)
}
```

**Pattern used for**:
- Drag-drop moves
- Keyboard cut/paste operations
- Context menu cut/paste operations
- Any file mutation that triggers watcher events

### Pause Controller

Reference-counting pause/resume for nested operations, with a safety timeout so a missed `resume()` cannot leave the watcher paused forever (#103):

```typescript
// src/main/utils/PauseController.ts
export interface PauseControllerOptions {
  timeoutMs?: number        // auto-resume if resume() is not called within this window
  onTimeout?: () => void    // invoked when the safety timeout fires
}

export class PauseController {
  constructor(options?: PauseControllerOptions)
  pause(): number           // increments the count, (re)starts the safety timer; returns the new count
  resume(): boolean         // decrements (floored at 0); returns true when fully resumed
  isPaused(): boolean
  getCount(): number
  reset(): void             // force count to 0 and clear the timer
  dispose(): void           // clear any pending timer
}
```

`DirectoryWatcherService` constructs one per watched directory with `{ timeoutMs: PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS, onTimeout: () => this.handlePauseTimeout(dirPath) }`.

**Benefits**:
- Supports nested operations (copy multiple items)
- Prevents premature watcher resume
- Safety timeout recovers from a missed `resume()` (uncaught exception mid-operation)
- Single-threaded main-process counter – no locking needed

## IPC Security

All file operations go through secure IPC handlers with input sanitization:

```typescript
// src/main/ipc/file-handlers.ts – the 'file:moveItem' handler (registered via registerHandle)
registerHandle('file:moveItem', async (_event, sourcePath: string, targetParentPath: string, newName?: string, replaceExisting?: boolean) => {
  // Validate inputs: sourcePath / targetParentPath must be non-empty strings,
  // newName a string if present, replaceExisting a boolean if present

  // Sanitize new name - prevent path traversal
  let sanitizedNewName: string | undefined = newName
  if (newName) {
    sanitizedNewName = newName.replace(/[/\\]/g, '')
    if (!sanitizedNewName) {
      throw new Error('Invalid new name')
    }
  }
  // ... fileService.moveItem(sourcePath, targetParentPath, sanitizedNewName, replaceExisting)
})
```

**Security measures**:
- Strip path separators (`/` and `\`) from user-provided names
- Validate all paths stay within project directory (`FileService.moveItem` / `copyItem` guards, below)
- No direct filesystem access from renderer process
- All operations go through contextBridge API

### Path Traversal Prevention

```typescript
// src/main/services/FileService.ts – moveItem guards (copyItem has the same pair with "copy" wording)
if (this.projectPath && !sourcePath.startsWith(this.projectPath)) {
  throw new Error('Cannot move items outside the project directory')
}
if (this.projectPath && !targetParentPath.startsWith(this.projectPath)) {
  throw new Error('Cannot move items to outside the project directory')
}
```

**Validation ensures**:
- Both source and target parent must be within project directory
- The check is a plain `startsWith` on the paths as received – there is no `path.normalize()` step here, so it is a boundary check rather than a `../` canonicaliser. Real filesystem confinement (with `realpath`) lives main-side in `ExternalFileService`; see [CLAUDE.md § Renderer path handling](../../CLAUDE.md)
- Project boundary enforced at multiple layers

## Context Menu Integration

Cut/Copy/Paste added to file/folder context menus:

```typescript
// src/renderer/src/components/ProjectTree/context-menu/commands.tsx
export class CutCommand extends CommandBase {
  label = 'Cut'
  icon = <Scissors size={14} strokeWidth={2} />
  execute(): void {
    this.ctx.clipboard.cut(this.node.path, this.node.name, this.node.type)
    this.ctx.toast({ type: 'info', title: 'Cut', message: `"${this.node.name}" ready to move` })
  }
}

export class CopyCommand extends CommandBase {
  label = 'Copy'
  icon = <Copy size={14} strokeWidth={2} />
  // same shape; toast title 'Copied'
}

export class PasteIntoDirectoryCommand extends CommandBase {
  label = 'Paste'
  icon = <ClipboardIcon size={14} strokeWidth={2} />   // lucide `Clipboard`
  // directory nodes only; conflict pre-check + "Replace item?" confirm for cut,
  // then clipboard.paste(targetPath, replaceExisting) inside ctx.withWatcherPause
}
```

The menu is assembled by `ContextMenuFactory` (`context-menu/`) from these command classes; `ProjectTree.tsx` supplies the `MenuContext` (`clipboard`, `toast`, `dialogs`, `withWatcherPause`, `refreshProjectTree`, …).

**Context-aware menu**:
- Cut/Copy always available
- Paste offered on directory nodes when the clipboard has content
- Feedback is a toast, not a screen-reader announcement
- Icons for visual clarity; the commands carry no `shortcut` label – the keyboard shortcuts are handled by the tree's keydown handler in `ProjectTree.tsx`

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
- **Tests**: `useDragDropTree.test.ts` – 46 tests (see [testing.md](./testing.md))

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

**User-facing errors** (verbatim from `FileService.moveItem`):
- "Cannot move a folder into its own subfolder"
- "An item named "<name>" already exists in the target location"
- "Cannot move items outside the project directory" / "Cannot move items to outside the project directory"
- "Cannot move the project root directory"
- "Source and target paths are the same"
- "Move failed: Could not delete source file. Operation rolled back." (cross-filesystem copy+delete, from `RollbackHandler`)
- Permission errors surface as the raw Node `EACCES` message

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

- **File Service**: [src/main/services/FileService.ts](../../src/main/services/FileService.ts)
- **IPC Handlers**: [src/main/ipc/file-handlers.ts](../../src/main/ipc/file-handlers.ts)
- **Preload**: [src/preload/index.ts](../../src/preload/index.ts), [src/preload/index.d.ts](../../src/preload/index.d.ts)
- **Project Tree**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](../../src/renderer/src/components/ProjectTree/ProjectTree.tsx)
- **Clipboard Store**: [src/renderer/src/stores/useClipboardStore.ts](../../src/renderer/src/stores/useClipboardStore.ts)
- **Tree Hook**: [src/renderer/src/hooks/useDragDropTree.ts](../../src/renderer/src/hooks/useDragDropTree.ts)
- **Pause Controller**: [src/main/utils/PauseController.ts](../../src/main/utils/PauseController.ts)
