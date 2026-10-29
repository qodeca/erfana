# System Integration

> IPC security, watcher synchronization, and context menu integration

[← Back to Drag-Drop Overview](./README.md)

## Watcher Synchronization

**Problem**: File watcher triggers refresh during move operation, causing stale tree state

**Solution**: Pause watcher → execute operation → refresh tree → resume watcher

```typescript
// ProjectTree.tsx – handleDragEnd (shape; the pause/resume pair lives in withWatcherPause.ts)
const handleDragEnd = async (event: DragEndEvent) => {
  cancelAutoExpandTimer()
  setActiveId(null)
  setOverId(null)
  // Drop on the terminal → insert the path; same-folder drop → end quietly;
  // descendant / project-root drops → "Invalid Move" toast...

  try {
    const result = await withWatcherPause(projectPath, isInternalOperation, setFileOperationLoading, async () => {
      const moveResult = await fileGateway.moveItem({ sourcePath, targetParentPath: targetParent })
      await refreshProjectTree() // refresh inside the pause
      return moveResult
    })
    refreshGitStatus()
    showGlobalToast({ title: 'Success', message: 'Item moved successfully', type: 'success' })
    // a symlink gets a 'Symlink Moved' warning toast instead
  } catch (err) {
    showGlobalToast({ title: 'Error', message: formatFileOperationError(err, 'move'), type: 'error' })
  }
}
// withWatcherPause pauses the directory watcher before the operation, marks it as
// internal, and resumes on both the success and the error path.
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
// src/main/ipc/file-handlers.ts – the 'file:moveItem' handler
registerConfinedHandle(
  FILE_CHANNELS.moveItem,
  {
    // One strict object: { sourcePath, targetParentPath, newName?, replaceExisting? }
    schema: payloadArgs(MoveItemRequestSchema),
    paths: {
      sourcePath: { arg: 0, key: 'sourcePath', mode: 'project-entry', access: 'change' },
      targetParentPath: { arg: 0, key: 'targetParentPath', mode: 'project', mustExist: true, kind: 'directory', access: 'change' }
    },
    handler: async (_ctx, [{ newName, replaceExisting }], { sourcePath, targetParentPath }) => {
      const moved = await fileService.moveItem(sourcePath.real, targetParentPath.real, newName, replaceExisting)
      // ... noteInternalChange(...) for the watcher's pause episode, then return the new path
    }
  },
  session
)
```

**Security measures**:
- `newName` is an `entryNameField` in `src/shared/ipc/file-schema.ts`: a name containing `/`, `\` or a NUL byte, or equal to `.` / `..`, is refused with "Invalid new name" (it is refused, not stripped), and `FileService` checks it again with `assertValidUserFilename`
- Both paths are resolved inside the open project by `registerConfinedHandle` (`src/main/ipc/confinement/registerConfinedHandle.ts`) before `FileService` runs
- No direct filesystem access from renderer process
- All operations go through contextBridge API

### Path Traversal Prevention

`FileService.moveItem` and `copyItem` no longer carry their own `startsWith` project checks. Confinement happens one layer up, in the IPC handler: each path in the `paths` map of `registerConfinedHandle` is resolved against the open project (links followed for `mode: 'project'`, the entry itself for `mode: 'project-entry'`), and a path outside the project is refused before `FileService` sees it. `FileService` receives the resolved `real` paths.

**Validation ensures**:
- Both source and target parent must be within project directory
- The target parent must exist and be a directory (`mustExist: true`, `kind: 'directory'`)
- Project boundary enforced at multiple layers

## Context Menu Integration

Cut, Copy and Paste are on the file and folder context menus. The command classes (`CutCommand`, `CopyCommand`, `PasteIntoDirectoryCommand`) are shown in [Clipboard operations § Context menu integration](./clipboard.md#context-menu-integration).

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
- **Validation**: circular move prevention, project-root guard, name check (`assertValidUserFilename`); project boundary checks are in the IPC layer
- **Dependencies**: RollbackHandler, SymlinkDetector

### IPC Layer
- **Location**: `src/main/ipc/file-handlers.ts`
- **Handlers**: `file:moveItem`, `file:copyItem`, `file:checkConflict`
- **Security**: zod request schemas (`src/shared/ipc/file-schema.ts`) and path confinement (`registerConfinedHandle`)
- **Error propagation**: Errors serialized to renderer

### Preload Bridge
- **Location**: `src/preload/fileBridge.ts` (assembled into `window.api` by `src/preload/index.ts`; types in `src/preload/index.d.ts`)
- **APIs**: `window.api.file.moveItem({ sourcePath, targetParentPath, newName?, replaceExisting? })`, `copyItem()`, `checkConflict()` – each takes one request object; renderer code reaches them through `fileGateway`
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
      1. Clear drag state
      2. Pause watcher
      3. Call IPC moveItem handler
      4. FileService.moveItem executes
      5. Refresh tree from disk
      6. Resume watcher
```

### Keyboard Cut/Paste Operation
```
User presses Ctrl+X
  → clipboard.cut(path, name, type)
  → Visual feedback (dimmed, dashed underline)
  → User selects target folder
  → User presses Ctrl+V
  → handlePaste: for a cut, checkConflict → "Replace Item" dialog if needed
  → executePaste executes:
      1. Pause watcher
      2. clipboard.paste(targetPath, replaceExisting) → IPC moveItem handler
      3. FileService.moveItem executes
      4. Clear clipboard (in the store, after a successful move)
      5. Refresh tree from disk
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

**Errors thrown by `FileService.moveItem`** (after a drag, the renderer passes them through `formatFileOperationError` in `src/renderer/src/utils/errorUtils.ts` before the toast):
- "Cannot move a folder into its own subfolder"
- "An item named "<name>" already exists in the target location" – the toast reads "An item with this name already exists"
- "Cannot move the project root directory"
- "Source and target paths are the same"
- "Target must be a directory"
- "Move failed: Could not delete source file. Operation rolled back." (cross-filesystem copy+delete, from `RollbackHandler`)
- After a drag, permission errors (`EACCES` / `EPERM`) become "Permission denied: cannot move item" and a missing item "Item not found"; a paste shows the error message as thrown (the clipboard store catches it and the toast shows `result.error`)
- A path outside the project is refused by the IPC confinement layer before `FileService` runs

## Document import integration

Document formats (PDF, Office, images) go through the LiteParse import pipeline. The dialog opens from the Import command (`importFile` in `useImport`), not from a drop:

```
Import command (toolbar button or a folder's "Import..." menu item)
  → importFile: native picker, one file
  → useImport checks the extension against the cached document extension list
  → Document file? → Open DocumentImportDialog (OCR, language, screenshots, DPI)
  → Office file and LibreOffice absent or unsafe? → prompt pointing to Settings → Import tools
  → User confirms → import:document IPC → LiteParseConverter processes file
  → Progress streamed via import:documentProgress
  → Cancellation via import:documentCancel
```

**Key integration points**:
- `useImport` hook routes files by extension (calls `import:getDocumentExtensions` once, caches result)
- An external drop added with Import goes through `processFiles`, which skips document files with a warning toast ("Document files skipped", or "Document files not supported in batch" when nothing else is left); Move and Copy do not filter by type
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
