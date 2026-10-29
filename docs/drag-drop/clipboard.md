# Clipboard Operations

> Cut, copy, and paste operations for file reorganization

[← Back to Drag-Drop Overview](./README.md)

## Clipboard Store

State management for cut/copy/paste operations using Zustand:

```typescript
// useClipboardStore.ts – ClipboardStore
interface ClipboardStore {
  itemPath: string | null
  operation: ClipboardOperation | null   // 'cut' | 'copy'
  itemName: string | null
  itemType: 'file' | 'directory' | null

  cut: (path: string, name: string, type: 'file' | 'directory') => void
  copy: (path: string, name: string, type: 'file' | 'directory') => void
  paste: (targetPath: string, replaceExisting?: boolean) => Promise<{ success: boolean; newPath?: string; isSymlink?: boolean; error?: string }>
  clear: () => void
  hasClipboard: () => boolean
  getOperation: () => ClipboardOperation | null
}

// Built by createClipboardStore(fileOps: IFileOperations) so file operations are injected for tests
```

**Key behavior**:
- Cut operation moves file and clears clipboard
- Copy operation copies file but keeps clipboard (allows multiple paste)
- Clipboard state survives component re-renders
- Visual feedback via `data-clipboard-cut` attribute

## Keyboard Shortcuts

| Shortcut | Action | Implementation |
|----------|--------|---------------|
| `Ctrl+X` / `Cmd+X` | Cut | Marks item for move, dims visually |
| `Ctrl+C` / `Cmd+C` | Copy | Marks item for copy |
| `Ctrl+V` / `Cmd+V` | Paste | Executes move or copy to selected folder |

**Cut Visual Feedback**:
```css
/* ProjectTree.css */
.project-tree-item[data-clipboard-cut="true"] {
  opacity: 0.6;
  position: relative;
}

.project-tree-item[data-clipboard-cut="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--border-width);
  background: repeating-linear-gradient(
    90deg,
    var(--color-text-secondary),
    var(--color-text-secondary) 4px,
    transparent 4px,
    transparent 8px
  );
}
```

## Implementation Details

### Cut Operation
```typescript
// useClipboardStore.ts
cut: (path: string, name: string, type: 'file' | 'directory') => {
  set({
    itemPath: path,
    operation: 'cut',
    itemName: name,
    itemType: type
  })
}
```

### Copy Operation
```typescript
// useClipboardStore.ts
copy: (path: string, name: string, type: 'file' | 'directory') => {
  set({
    itemPath: path,
    operation: 'copy',
    itemName: name,
    itemType: type
  })
}
```

### Paste Operation
```typescript
// useClipboardStore.ts
paste: async (targetPath: string, replaceExisting?: boolean) => {
  const state = get()

  if (!state.itemPath || !state.operation) {
    return { success: false, error: 'No item in clipboard' }
  }

  try {
    let result: { path: string; isSymlink?: boolean }
    if (state.operation === 'cut') {
      // Move through the injected file operations, then clear the clipboard
      result = await fileOps.moveItem({ sourcePath: state.itemPath, targetParentPath: targetPath, replaceExisting })
      set({ itemPath: null, operation: null, itemName: null, itemType: null })
    } else {
      // Copy; the clipboard is kept for multiple pastes
      result = await fileOps.copyItem({ sourcePath: state.itemPath, targetParentPath: targetPath })
    }
    return { success: true, newPath: result.path, isSymlink: result.isSymlink }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
```

## Context Menu Integration

Right-click context menu operations are command classes in `src/renderer/src/components/ProjectTree/context-menu/commands.tsx`, assembled by `ContextMenuFactory`:

```typescript
// context-menu/commands.tsx
export class CutCommand extends CommandBase {
  label = 'Cut'
  icon = <Scissors size={14} strokeWidth={2} />
  execute(): void {
    this.ctx.clipboard.cut(this.node.path, this.node.name, this.node.type)
    this.ctx.toast({ type: 'info', title: 'Cut', message: `"${this.node.name}" ready to move` })
  }
}

export class CopyCommand extends CommandBase { /* same shape; toast title 'Copied' */ }

export class PasteIntoDirectoryCommand extends CommandBase {
  label = 'Paste'
  // Only offered on directory nodes. For a cut, checks `api.checkConflict` first and asks
  // "Replace Item" via `dialogs.showConfirm`; then runs `clipboard.paste(targetPath, replaceExisting)`
  // inside `ctx.withWatcherPause` and refreshes the project tree on success.
}
```

## Validation

Paste validation checks:
- Clipboard must not be empty (`hasClipboard()`)
- A target folder must be selected – otherwise the toast "Select a folder to paste into"
- Cannot move a folder into itself or its descendants (main: "Cannot move a folder into its own subfolder")
- The target must be an existing folder inside the project (`file:moveItem` / `file:copyItem` resolve it with `mustExist: true, kind: 'directory'`)
- User confirmation required for overwrites (cut only; a copy auto-numbers instead)

See [validation.md](./validation.md) for detailed rules.

## Related Files

- **Implementation**: [src/renderer/src/stores/useClipboardStore.ts](../../src/renderer/src/stores/useClipboardStore.ts)
- **Tests**: [src/renderer/src/stores/useClipboardStore.test.ts](../../src/renderer/src/stores/useClipboardStore.test.ts)
- **Context Menu**: [src/renderer/src/components/ProjectTree/context-menu/commands.tsx](../../src/renderer/src/components/ProjectTree/context-menu/commands.tsx) (`CutCommand`, `CopyCommand`, `PasteIntoDirectoryCommand`)
