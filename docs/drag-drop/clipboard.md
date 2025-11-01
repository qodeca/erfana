# Clipboard Operations

> Cut, copy, and paste operations for file reorganization

[← Back to Drag-Drop Overview](./README.md)

## Clipboard Store

State management for cut/copy/paste operations using Zustand:

```typescript
// useClipboardStore.ts:8-26
interface ClipboardStore {
  itemPath: string | null
  operation: 'cut' | 'copy' | null
  itemName: string | null
  itemType: 'file' | 'directory' | null

  cut: (path: string, name: string, type: 'file' | 'directory') => void
  copy: (path: string, name: string, type: 'file' | 'directory') => void
  paste: (targetPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
  clear: () => void
  hasClipboard: () => boolean
}
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
  height: 1px;
  background: repeating-linear-gradient(
    90deg,
    #858585,
    #858585 4px,
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
paste: async (targetPath: string) => {
  const { itemPath, operation, itemName, itemType } = get()

  if (!itemPath || !operation || !itemName || !itemType) {
    return { success: false, error: 'No item in clipboard' }
  }

  try {
    if (operation === 'cut') {
      // Move operation
      const result = await window.api.file.moveItem(itemPath, targetPath, itemName)
      clear() // Clear clipboard after cut
      return { success: true, newPath: result.path }
    } else {
      // Copy operation
      const result = await window.api.file.copyItem(itemPath, targetPath, itemName)
      // Keep clipboard for multiple paste
      return { success: true, newPath: result.path }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

## Context Menu Integration

Right-click context menu operations map directly to clipboard:

```typescript
// ProjectTree.tsx
<ContextMenu>
  <ContextMenuItem onClick={() => clipboard.cut(node.path, node.name, node.type)}>
    Cut
  </ContextMenuItem>
  <ContextMenuItem onClick={() => clipboard.copy(node.path, node.name, node.type)}>
    Copy
  </ContextMenuItem>
  <ContextMenuItem
    onClick={() => clipboard.paste(selectedFolder)}
    disabled={!clipboard.hasClipboard() || !selectedFolder}
  >
    Paste
  </ContextMenuItem>
</ContextMenu>
```

## Validation

Paste validation checks:
- Clipboard must not be empty
- Target folder must be selected
- Cannot paste folder into itself or its descendants
- Target path must exist
- User confirmation required for overwrites (move operations)

See [validation.md](./validation.md) for detailed rules.

## Related Files

- **Implementation**: [src/renderer/src/stores/useClipboardStore.ts](/src/renderer/src/stores/useClipboardStore.ts)
- **Tests**: [src/renderer/src/stores/useClipboardStore.test.ts](/src/renderer/src/stores/useClipboardStore.test.ts)
- **Context Menu**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](/src/renderer/src/components/ProjectTree/ProjectTree.tsx)
